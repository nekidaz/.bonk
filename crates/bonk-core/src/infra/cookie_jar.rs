//! A workspace's cookie jar: `Set-Cookie` from responses goes in, matching cookies go out
//! with the next requests (domain, path, Secure and expiry are honoured by `cookie_store`).
//! Persistent cookies are saved as a JSON array; session cookies live until bonk closes.

use crate::domain::http::{cookie_host_excluded, CookieChange, CookieInfo, ResponseCookie};
use cookie_store::{Cookie, CookieDomain, CookieExpiration, CookieStore};
use reqwest::header::HeaderValue;
use reqwest::Url;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub struct CookieJar {
    path: PathBuf,
    store: RwLock<CookieStore>,
    /// Changed since the last save.
    dirty: AtomicBool,
    /// Save session cookies too (Settings → Cookies «Хранить между запусками»).
    keep_session: AtomicBool,
}

impl CookieJar {
    /// The jar saved at `path`; empty when the file does not exist yet.
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let store = match std::fs::read(&path) {
            Ok(bytes) => {
                let cookies: Vec<Cookie<'static>> = serde_json::from_slice(&bytes)
                    .map_err(|e| format!("cookie jar «{}»: {e}", path.display()))?;
                // `true`: keep expired cookies, the jar lists them greyed until deleted.
                CookieStore::from_cookies(cookies.into_iter().map(Ok::<_, String>), true)?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => CookieStore::default(),
            Err(e) => return Err(format!("cookie jar «{}»: {e}", path.display())),
        };
        Ok(Self {
            path,
            store: RwLock::new(store),
            dirty: AtomicBool::new(false),
            keep_session: AtomicBool::new(false),
        })
    }

    /// A run-local jar; it never reads or writes the app's cookie file.
    pub fn memory() -> Self {
        Self {
            path: PathBuf::new(),
            store: RwLock::new(CookieStore::default()),
            dirty: AtomicBool::new(false),
            keep_session: AtomicBool::new(false),
        }
    }

    /// Seed an isolated run from the app's cookies without changing the app's jar.
    pub fn fork(&self) -> Self {
        Self {
            store: RwLock::new(self.read().clone()),
            ..Self::memory()
        }
    }

    pub fn clear_for_url(&self, url: &str) {
        if let Ok(url) = Url::parse(url) {
            if let Some(host) = url.host_str() {
                self.clear(Some(host));
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    // A panic while holding the lock can't leave the store half-written, so a
    // poisoned lock is still safe to use.
    fn read(&self) -> RwLockReadGuard<'_, CookieStore> {
        self.store.read().unwrap_or_else(|e| e.into_inner())
    }

    fn write(&self) -> RwLockWriteGuard<'_, CookieStore> {
        self.dirty.store(true, Ordering::Relaxed);
        self.store.write().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether the next save keeps session cookies; a change re-saves the file.
    pub fn set_keep_session(&self, keep: bool) {
        if self.keep_session.swap(keep, Ordering::Relaxed) != keep {
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Write persistent cookies (expired ones too, and session ones when kept) to disk,
    /// if anything changed.
    pub fn save(&self) -> Result<(), String> {
        if self.path.as_os_str().is_empty() || !self.dirty.swap(false, Ordering::Relaxed) {
            return Ok(());
        }
        let json = {
            let store = self.read();
            let keep_session = self.keep_session.load(Ordering::Relaxed);
            let cookies: Vec<&Cookie<'static>> = store
                .iter_any()
                .filter(|c| keep_session || c.is_persistent())
                .collect();
            serde_json::to_vec_pretty(&cookies).map_err(|e| e.to_string())?
        };
        write_private(&self.path, &json).map_err(|e| {
            // Keep the changes pending so the next save retries them.
            self.dirty.store(true, Ordering::Relaxed);
            format!("cookie jar «{}»: {e}", self.path.display())
        })
    }

    /// Every cookie, expired ones included, sorted by domain, path and name.
    pub fn list(&self) -> Vec<CookieInfo> {
        let mut out: Vec<CookieInfo> = self.read().iter_any().map(cookie_info).collect();
        out.sort_by(|a, b| (&a.domain, &a.path, &a.name).cmp(&(&b.domain, &b.path, &b.name)));
        out
    }

    /// What a script sees as `pm.cookies` for `url`: the jar as `response` left it,
    /// cookies that would go to that URL. Mirrors `cookiesFor` in entities/cookies.
    pub fn script_cookies(&self, url: &str, response: &[ResponseCookie]) -> Vec<(String, String)> {
        let Ok(url) = Url::parse(url) else {
            return Vec::new();
        };
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let same = |a: &CookieInfo, b: &CookieInfo| {
            a.name == b.name && a.domain == b.domain && a.path == b.path
        };
        let mut jar = self.list();
        for r in response {
            if let Some(
                change @ (CookieChange::New | CookieChange::Updated | CookieChange::Deleted),
            ) = r.change
            {
                jar.retain(|c| !same(c, &r.cookie));
                if change != CookieChange::Deleted {
                    jar.push(r.cookie.clone());
                }
            }
        }
        let path_fits = |p: &str| {
            let dir = if p.ends_with('/') {
                p.to_string()
            } else {
                format!("{p}/")
            };
            p == "/" || url.path() == p || url.path().starts_with(&dir)
        };
        jar.into_iter()
            .filter(|c| {
                let domain_fits =
                    host == c.domain || (!c.host_only && host.ends_with(&format!(".{}", c.domain)));
                !c.expired
                    && domain_fits
                    && path_fits(&c.path)
                    && (!c.secure || url.scheme() == "https")
            })
            .map(|c| (c.name, c.value))
            .collect()
    }

    /// Add (or replace: same name, domain and path) a cookie from a `Set-Cookie` value,
    /// as if `url` had answered with it.
    pub fn add(&self, set_cookie: &str, url: &str) -> Result<(), String> {
        let url = Url::parse(url).map_err(|e| format!("cookie URL «{url}»: {e}"))?;
        let cookie = Cookie::parse(set_cookie.to_string(), &url)
            .map_err(|e| format!("cookie «{set_cookie}»: {e}"))?;
        self.write()
            .insert(cookie.into_owned(), &url)
            .map(|_| ())
            .map_err(|e| format!("cookie «{set_cookie}»: {e}"))
    }

    /// Remove one cookie; `false` when there was no such cookie.
    pub fn remove(&self, domain: &str, path: &str, name: &str) -> bool {
        self.write().remove(domain, path, name).is_some()
    }

    /// How many cookies a request to `url` would carry now.
    pub fn sends_to(&self, url: &str) -> usize {
        Url::parse(url).map_or(0, |u| self.read().get_request_values(&u).count())
    }

    /// The `Set-Cookie` values a response from `url` carried and what each did to the jar,
    /// given the jar as it was before the request (`before`). `saved` = saving was on.
    pub fn response_cookies(
        set_cookies: &[String],
        url: &str,
        before: &[CookieInfo],
        saved: bool,
    ) -> Vec<ResponseCookie> {
        let Ok(url) = Url::parse(url) else {
            return Vec::new();
        };
        set_cookies
            .iter()
            .filter_map(|raw| {
                let (cookie, change) = match Cookie::parse(raw.as_str(), &url) {
                    Ok(c) => {
                        let info = cookie_info(&c.into_owned());
                        let change = if info.expired {
                            CookieChange::Deleted
                        } else if before.iter().any(|b| {
                            (&b.domain, &b.path, &b.name) == (&info.domain, &info.path, &info.name)
                        }) {
                            CookieChange::Updated
                        } else {
                            CookieChange::New
                        };
                        (info, change)
                    }
                    Err(_) => (raw_cookie_info(raw, &url)?, CookieChange::Rejected),
                };
                Some(ResponseCookie {
                    cookie,
                    change: saved.then_some(change),
                })
            })
            .collect()
    }

    /// Remove every cookie of `domain`, or all cookies when `None`.
    pub fn clear(&self, domain: Option<&str>) {
        let mut store = self.write();
        let Some(domain) = domain else {
            store.clear();
            return;
        };
        let doomed: Vec<(String, String)> = store
            .iter_any()
            .filter(|c| domain_of(c) == domain)
            .map(|c| (c.path.to_string(), c.name().to_string()))
            .collect();
        for (path, name) in doomed {
            store.remove(domain, &path, &name);
        }
    }
}

/// Write `bytes` to `path` readable by the owner only (session tokens live there), via
/// write-then-rename so a crash mid-write never leaves a truncated jar.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut dirs = std::fs::DirBuilder::new();
    dirs.recursive(true);
    let mut file = std::fs::OpenOptions::new();
    file.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        dirs.mode(0o700);
        file.mode(0o600);
    }
    if let Some(dir) = path.parent() {
        dirs.create(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    // A leftover from a crash may have other permissions; `mode` applies only on create.
    let _ = std::fs::remove_file(&tmp);
    file.open(&tmp)?.write_all(bytes)?;
    std::fs::rename(&tmp, path)
}

/// Where the jar of workspace root `workspace` ('' = the app-wide jar) lives under `data_dir`.
/// The root is canonicalized first, so the app and bonk-mcp (which canonicalizes its
/// `--workspace`) name the same file even through a symlink.
pub fn jar_path(data_dir: &Path, workspace: &str) -> PathBuf {
    let root = workspace.trim();
    let root = if root.is_empty() {
        String::new()
    } else {
        std::fs::canonicalize(root)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| root.to_string())
    };
    data_dir.join("cookies").join(jar_file_name(&root))
}

/// File name of the jar for workspace root `workspace` (empty = the app-wide jar):
/// `<folder>-<hash of the full path>.json`, so two `api` folders don't share one.
pub fn jar_file_name(workspace: &str) -> String {
    let root = workspace.trim().trim_end_matches(['/', '\\']);
    if root.is_empty() {
        return "default.json".to_string();
    }
    let folder = root.rsplit(['/', '\\']).next().unwrap_or(root);
    let slug: String = folder
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    // FNV-1a: stable across Rust releases, unlike std's DefaultHasher.
    let hash = root.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    });
    format!("{}-{:08x}.json", slug.trim_matches('-'), hash as u32)
}

fn domain_of(c: &Cookie<'_>) -> String {
    c.domain
        .as_cow()
        .map(|d| d.into_owned())
        .unwrap_or_default()
}

/// A `Set-Cookie` the jar refused, described from its own attributes.
fn raw_cookie_info(raw: &str, url: &Url) -> Option<CookieInfo> {
    let c = cookie_store::RawCookie::parse(raw).ok()?;
    Some(CookieInfo {
        name: c.name().to_string(),
        value: c.value().to_string(),
        domain: c
            .domain()
            .map(|d| d.trim_start_matches('.').to_string())
            .or_else(|| url.host_str().map(str::to_string))
            .unwrap_or_default(),
        host_only: c.domain().is_none(),
        path: c.path().unwrap_or("/").to_string(),
        expires_ms: None,
        expired: false,
        http_only: c.http_only().unwrap_or(false),
        secure: c.secure().unwrap_or(false),
        same_site: c.same_site().map(|s| s.to_string()),
        raw: raw.to_string(),
    })
}

fn cookie_info(c: &Cookie<'static>) -> CookieInfo {
    CookieInfo {
        name: c.name().to_string(),
        value: c.value().to_string(),
        domain: domain_of(c),
        host_only: matches!(c.domain, CookieDomain::HostOnly(_)),
        path: c.path.to_string(),
        expires_ms: match &c.expires {
            CookieExpiration::AtUtc(t) => Some((t.unix_timestamp_nanos() / 1_000_000) as i64),
            CookieExpiration::SessionEnd => None,
        },
        expired: c.is_expired(),
        http_only: c.http_only().unwrap_or(false),
        secure: c.secure().unwrap_or(false),
        same_site: c.same_site().map(|s| s.to_string()),
        raw: c.to_string(),
    }
}

/// What a reqwest client sees: the jar plus the save/send switches and the excluded
/// domains of its settings.
pub struct JarProvider {
    pub jar: Arc<CookieJar>,
    pub save: bool,
    pub send: bool,
    pub exclude: Vec<String>,
}

impl JarProvider {
    fn excluded(&self, url: &Url) -> bool {
        url.host_str()
            .is_some_and(|h| cookie_host_excluded(h, &self.exclude))
    }
}

impl reqwest::cookie::CookieStore for JarProvider {
    fn set_cookies(&self, headers: &mut dyn Iterator<Item = &HeaderValue>, url: &Url) {
        if !self.save || self.excluded(url) {
            return;
        }
        // A `Domain=` pointing at an excluded domain is dropped too.
        let cookies = headers.filter_map(|h| {
            let s = h.to_str().ok()?;
            let c = cookie_store::RawCookie::parse(s.to_string()).ok()?;
            let foreign = c
                .domain()
                .is_some_and(|d| cookie_host_excluded(d.trim_start_matches('.'), &self.exclude));
            (!foreign).then_some(c)
        });
        self.jar.write().store_response_cookies(cookies, url);
    }

    fn cookies(&self, url: &Url) -> Option<HeaderValue> {
        if !self.send || self.excluded(url) {
            return None;
        }
        let value = self
            .jar
            .read()
            .get_request_values(url)
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ");
        if value.is_empty() {
            return None;
        }
        HeaderValue::from_str(&value).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::cookie::CookieStore as _;

    fn jar_in(dir: &Path) -> Arc<CookieJar> {
        Arc::new(CookieJar::open(dir.join("jar.json")).unwrap())
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bonk-jar-{tag}-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn script_cookies_follow_domain_path_and_secure() {
        let dir = tmp_dir("script");
        let jar = jar_in(&dir);
        jar.add("sid=1; Path=/api", "https://a.test/").unwrap();
        jar.add("wide=2; Domain=a.test", "https://a.test/").unwrap();
        jar.add("tls=3; Secure", "https://a.test/").unwrap();
        let names = |url: &str| -> Vec<String> {
            let mut n: Vec<_> = jar
                .script_cookies(url, &[])
                .into_iter()
                .map(|c| c.0)
                .collect();
            n.sort();
            n
        };
        assert_eq!(names("https://a.test/api/x"), ["sid", "tls", "wide"]);
        assert_eq!(names("http://sub.a.test/"), ["wide"]);
        assert_eq!(names("https://a.test/apix"), ["tls", "wide"]);
        std::fs::remove_dir_all(dir).ok();
    }

    fn provider(jar: &Arc<CookieJar>, save: bool, send: bool) -> JarProvider {
        JarProvider {
            jar: jar.clone(),
            save,
            send,
            exclude: Vec::new(),
        }
    }

    fn respond(p: &JarProvider, from: &str, set_cookies: &[&str]) {
        let values: Vec<HeaderValue> = set_cookies
            .iter()
            .map(|s| HeaderValue::from_str(s).unwrap())
            .collect();
        p.set_cookies(&mut values.iter(), &url(from));
    }

    fn sent(p: &JarProvider, to: &str) -> Option<String> {
        p.cookies(&url(to)).map(|v| v.to_str().unwrap().to_string())
    }

    #[test]
    fn set_cookie_comes_back_on_matching_requests_only() {
        let dir = tmp_dir("match");
        let p = provider(&jar_in(&dir), true, true);
        respond(
            &p,
            "https://api.example.com/login",
            &[
                "sid=abc; Path=/; HttpOnly",
                "scoped=1; Path=/v1",
                "wide=1; Domain=example.com; Path=/",
                "tls=1; Path=/; Secure",
            ],
        );
        let mut got: Vec<String> = sent(&p, "https://api.example.com/v1/x")
            .unwrap()
            .split("; ")
            .map(str::to_string)
            .collect();
        got.sort();
        assert_eq!(got, ["scoped=1", "sid=abc", "tls=1", "wide=1"]);
        // Other path, plain http: no /v1 cookie and no Secure one.
        let mut got: Vec<String> = sent(&p, "http://api.example.com/")
            .unwrap()
            .split("; ")
            .map(str::to_string)
            .collect();
        got.sort();
        assert_eq!(got, ["sid=abc", "wide=1"]);
        // Sibling host gets only the Domain= cookie; unrelated host nothing.
        assert_eq!(
            sent(&p, "https://www.example.com/").as_deref(),
            Some("wide=1")
        );
        assert_eq!(sent(&p, "https://other.org/"), None);
    }

    #[test]
    fn save_and_send_switches() {
        let dir = tmp_dir("switch");
        let jar = jar_in(&dir);
        respond(&provider(&jar, false, true), "https://a.kz/", &["x=1"]);
        assert!(jar.list().is_empty(), "save off: nothing stored");
        respond(&provider(&jar, true, true), "https://a.kz/", &["x=1"]);
        assert_eq!(sent(&provider(&jar, true, false), "https://a.kz/"), None);
        assert_eq!(
            sent(&provider(&jar, true, true), "https://a.kz/").as_deref(),
            Some("x=1")
        );
    }

    #[test]
    fn excluded_domains_are_neither_stored_nor_sent() {
        let dir = tmp_dir("exclude");
        let jar = jar_in(&dir);
        let p = JarProvider {
            exclude: vec!["*.tracker.io".into()],
            ..provider(&jar, true, true)
        };
        respond(&p, "https://ad.tracker.io/", &["t=1"]);
        respond(&p, "https://a.kz/", &["ok=1", "spy=1; Domain=tracker.io"]);
        let names: Vec<String> = jar.list().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["ok"]);
        jar.add("t=1", "https://ad.tracker.io/").unwrap();
        assert_eq!(sent(&p, "https://ad.tracker.io/"), None);
    }

    #[test]
    fn keep_session_saves_session_cookies_too() {
        let dir = tmp_dir("keep");
        let jar = jar_in(&dir);
        jar.set_keep_session(true);
        jar.add("session=1", "https://a.kz/").unwrap();
        jar.save().unwrap();
        assert_eq!(jar_in(&dir).list().len(), 1);
        // Switching it off re-saves without them.
        jar.set_keep_session(false);
        jar.save().unwrap();
        assert!(jar_in(&dir).list().is_empty());
    }

    #[test]
    fn persistent_cookies_survive_reopen_session_ones_do_not() {
        let dir = tmp_dir("persist");
        let jar = jar_in(&dir);
        respond(
            &provider(&jar, true, true),
            "https://a.kz/",
            &["keep=1; Max-Age=3600", "session=1"],
        );
        jar.save().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("jar.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "jar holds session tokens: owner-only");
        }
        let names: Vec<String> = jar_in(&dir).list().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["keep"]);
    }

    #[test]
    fn list_add_remove_clear() {
        let dir = tmp_dir("edit");
        let jar = jar_in(&dir);
        jar.add(
            "a=1; Path=/; Secure; HttpOnly; SameSite=Lax",
            "https://a.kz/",
        )
        .unwrap();
        jar.add("b=2; Domain=b.kz; Path=/v1", "https://api.b.kz/")
            .unwrap();
        jar.add("c=3", "https://b.kz/").unwrap();
        // Same name+domain+path replaces.
        jar.add("a=9; Path=/", "https://a.kz/").unwrap();

        let list = jar.list();
        let a = &list[0];
        assert_eq!(
            (a.name.as_str(), a.value.as_str(), a.domain.as_str()),
            ("a", "9", "a.kz")
        );
        assert!(a.host_only && a.expires_ms.is_none() && !a.expired);
        let b = &list[2]; // sorted: b.kz "/" (c) comes before b.kz "/v1" (b)
        assert_eq!(
            (b.domain.as_str(), b.path.as_str(), b.host_only),
            ("b.kz", "/v1", false)
        );
        assert_eq!(list.len(), 3);

        assert!(jar.remove("a.kz", "/", "a"));
        assert!(!jar.remove("a.kz", "/", "a"));
        jar.clear(Some("b.kz"));
        assert!(jar.list().is_empty());

        jar.add("z=1", "https://z.kz/").unwrap();
        jar.clear(None);
        assert!(jar.list().is_empty());
        assert!(jar.add("junk", "not a url").is_err());
    }

    #[test]
    fn flags_and_raw_are_listed() {
        let dir = tmp_dir("flags");
        let jar = jar_in(&dir);
        jar.add(
            "sid=s1; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60",
            "https://a.kz/",
        )
        .unwrap();
        let c = &jar.list()[0];
        assert!(c.secure && c.http_only && c.expires_ms.is_some());
        assert_eq!(c.same_site.as_deref(), Some("Strict"));
        assert!(c.raw.starts_with("sid=s1"), "{}", c.raw);
    }

    /// Through a real reqwest client: a login that sets a cookie on a 302 is followed with
    /// the cookie, and a hand-written `Cookie` header beats the jar.
    #[test]
    fn reqwest_client_round_trip() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            tokio::spawn(async move {
                loop {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap();
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let cookie = req
                        .lines()
                        .find_map(|l| l.strip_prefix("cookie: "))
                        .unwrap_or("-")
                        .to_string();
                    let resp = if req.starts_with("GET /login") {
                        "HTTP/1.1 302 Found\r\nLocation: /me\r\nSet-Cookie: sid=42; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                    } else {
                        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{cookie}", cookie.len())
                    };
                    sock.write_all(resp.as_bytes()).await.unwrap();
                }
            });
            let dir = tmp_dir("reqwest");
            let jar = jar_in(&dir);
            let client = reqwest::Client::builder()
                .cookie_provider(Arc::new(provider(&jar, true, true)))
                .build()
                .unwrap();
            let me = client.get(format!("{base}/login")).send().await.unwrap();
            assert_eq!(me.text().await.unwrap(), "sid=42", "redirect carries the new cookie");
            let manual = client
                .get(format!("{base}/me"))
                .header("Cookie", "mine=1")
                .send()
                .await
                .unwrap();
            assert_eq!(manual.text().await.unwrap(), "mine=1");
            assert_eq!(jar.list()[0].domain, "127.0.0.1");
        });
    }

    #[test]
    fn response_cookies_report_their_effect() {
        let dir = tmp_dir("resp");
        let jar = jar_in(&dir);
        jar.add("sid=old; Path=/", "https://api.a.kz/").unwrap();
        jar.add("gone=1; Path=/", "https://api.a.kz/").unwrap();
        let before = jar.list();
        let set: Vec<String> = [
            "sid=new; Path=/",
            "csrf=1; Path=/",
            "gone=; Path=/; Max-Age=0",
            "evil=1; Domain=other.org",
        ]
        .map(String::from)
        .to_vec();
        let got = CookieJar::response_cookies(&set, "https://api.a.kz/x", &before, true);
        let changes: Vec<(&str, Option<CookieChange>)> = got
            .iter()
            .map(|c| (c.cookie.name.as_str(), c.change))
            .collect();
        assert_eq!(
            changes,
            [
                ("sid", Some(CookieChange::Updated)),
                ("csrf", Some(CookieChange::New)),
                ("gone", Some(CookieChange::Deleted)),
                ("evil", Some(CookieChange::Rejected)),
            ]
        );
        assert_eq!(got[3].cookie.domain, "other.org");
        let off = CookieJar::response_cookies(&set[..1], "https://api.a.kz/", &before, false);
        assert_eq!(off[0].change, None);
        assert_eq!(jar.sends_to("https://api.a.kz/"), 2);
        assert_eq!(jar.sends_to("https://b.kz/"), 0);
    }

    #[test]
    fn jar_file_names() {
        assert_eq!(jar_file_name(""), "default.json");
        let a = jar_file_name("/Users/me/Acme Payments/");
        assert!(
            a.starts_with("acme-payments-") && a.ends_with(".json"),
            "{a}"
        );
        assert_eq!(a, jar_file_name("/Users/me/Acme Payments"));
        assert_ne!(a, jar_file_name("/Users/other/Acme Payments"));
    }

    #[cfg(unix)]
    #[test]
    fn jar_path_is_the_same_through_a_symlink() {
        let dir = tmp_dir("link");
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, dir.join("link")).unwrap();
        let data = Path::new("/data");
        let via = |p: &Path| jar_path(data, &p.to_string_lossy());
        assert_eq!(via(&real), via(&dir.join("link")));
        assert_eq!(jar_path(data, ""), data.join("cookies/default.json"));
    }

    #[test]
    fn broken_jar_file_is_an_error_not_an_empty_jar() {
        let dir = tmp_dir("broken");
        std::fs::write(dir.join("jar.json"), "{nope").unwrap();
        assert!(CookieJar::open(dir.join("jar.json")).is_err());
    }
}
