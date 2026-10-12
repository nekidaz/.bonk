//! Session auth (`type: "session"`): sign in once, keep the tokens, renew them by themselves.
//!
//! The sign-in is a Runner scenario (`.bonk/scenarios.json`); the tokens are read from the
//! responses of its steps (`SessionConfig::access` and `refresh`). A session lives in the OS
//! keychain, one per workspace, environment and sign-in setup, never in workspace files.
//! The engine side (running the scenario and the renewal request) is in `runner.rs`; this
//! module is the data: what is stored, how long it lives and how to read it out of a response.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::oauth::TokenStore;
use crate::domain::http::{SessionConfig, TokenSource};

/// What the keychain holds for one session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub access: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<String>,
    /// Unix seconds; `None` when the token carries no lifetime.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_exp: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_exp: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<String>,
    #[serde(default)]
    pub obtained_at: u64,
}

/// What the UI may see: never a token, only a recognisable edge of the access one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// `eyJhbGciOi…k9Pq2`
    pub access_preview: String,
    pub has_refresh: bool,
    pub access_exp: Option<u64>,
    pub refresh_exp: Option<u64>,
    pub who: Option<String>,
    pub obtained_at: u64,
}

impl Record {
    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            access_preview: preview(&self.access),
            has_refresh: self.refresh.is_some(),
            access_exp: self.access_exp,
            refresh_exp: self.refresh_exp,
            who: self.who.clone(),
            obtained_at: self.obtained_at,
        }
    }

    /// Good for a send now, with `lead` seconds to spare.
    pub fn access_fresh(&self, now: u64, lead: u64) -> bool {
        self.access_exp.is_none_or(|exp| now + lead < exp)
    }

    /// The refresh token can still be traded.
    pub fn refresh_usable(&self, now: u64) -> bool {
        self.refresh.is_some() && self.refresh_exp.is_none_or(|exp| now < exp)
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl SessionConfig {
    pub fn lead(&self) -> u64 {
        self.lead_secs.unwrap_or(60)
    }

    pub fn retries_on_401(&self) -> bool {
        self.retry_on_401 != Some(false)
    }

    pub fn auto_refreshes(&self) -> bool {
        self.auto_refresh != Some(false)
    }

    pub fn renew_access_path(&self) -> &str {
        match self.renew_access.trim() {
            "" => "body.access_token",
            path => path,
        }
    }

    /// A refresh needs the request that trades it and a refresh token from the login.
    pub fn can_renew(&self) -> bool {
        !self.renew_request.trim().is_empty() && !self.refresh.request.trim().is_empty()
    }

    /// The configuration is complete enough to sign in.
    pub fn check(&self) -> Result<(), String> {
        if self.login.trim().is_empty() {
            return Err("session: choose the scenario that signs in".into());
        }
        if self.access.request.trim().is_empty() || self.access.path.trim().is_empty() {
            return Err("session: say which response holds the access token".into());
        }
        Ok(())
    }

    /// Workspace-relative paths whose requests never carry the session: the sign-in itself
    /// (`login_paths`, from the scenario), the renewal and what the person excluded.
    pub fn leaves_out(&self, node_id: &str, login_paths: &[String]) -> bool {
        let rel = |id: &str| id.strip_prefix("fs:").unwrap_or(id).to_string();
        let under = |path: &str| {
            let path = rel(path);
            let path = path.trim_end_matches('/');
            !path.is_empty()
                && (rel(node_id) == path || rel(node_id).starts_with(&format!("{path}/")))
        };
        login_paths.iter().any(|p| under(p))
            || self.exclude.iter().any(|p| under(p))
            || (!self.renew_request.is_empty() && under(&self.renew_request))
            || [&self.access, &self.refresh, &self.who]
                .iter()
                .any(|source| !source.request.is_empty() && under(&source.request))
    }
}

/// Keychain account of the session for this workspace, environment and sign-in setup:
/// another environment is another session, and so is another scenario or token source.
pub fn account(workspace_root: &str, environment: &str, config: &SessionConfig) -> String {
    let parts = [
        workspace_root.trim(),
        environment.trim(),
        config.login.trim(),
        config.access.request.trim(),
        config.access.path.trim(),
        config.renew_request.trim(),
    ];
    let digest = Sha256::digest(parts.join("\n").as_bytes());
    let hex: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    format!("session:{hex}")
}

pub fn stored(account: &str, store: &dyn TokenStore) -> Option<Record> {
    serde_json::from_str(&store.get(account)?).ok()
}

pub fn save(account: &str, store: &dyn TokenStore, record: &Record) -> Result<(), String> {
    let json = serde_json::to_string(record).map_err(|e| e.to_string())?;
    store.set(account, &json)
}

pub fn forget(account: &str, store: &dyn TokenStore) -> Result<(), String> {
    store.delete(account)
}

/// The value at `path` of a JSON body: `body.data.tokens[0].access` (the `body.` prefix is
/// optional). Strings come back as they are, numbers as text; anything else is not a value.
pub fn extract(body: &str, path: &str) -> Option<String> {
    let json: Value = serde_json::from_str(body).ok()?;
    let path = path.trim();
    let path = path.strip_prefix("body.").unwrap_or(path);
    let mut here = &json;
    for part in path.split('.').filter(|p| !p.is_empty()) {
        let (key, indexes) = match part.find('[') {
            Some(at) => (&part[..at], &part[at..]),
            None => (part, ""),
        };
        if !key.is_empty() {
            here = here.get(key)?;
        }
        for index in indexes.split('[').filter(|i| !i.is_empty()) {
            here = here.get(index.trim_end_matches(']').parse::<usize>().ok()?)?;
        }
    }
    match here {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// The `exp` of a JWT, in unix seconds.
pub fn jwt_exp(token: &str) -> Option<u64> {
    let mut parts = token.split('.');
    let payload = parts.nth(1)?;
    parts.next()?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let json: Value = serde_json::from_slice(&bytes).ok()?;
    json.get("exp")?.as_u64()
}

/// When `token` dies: its JWT `exp`, else `ttl` seconds from `now`.
fn expiry(token: &str, ttl: Option<u64>, now: u64) -> Option<u64> {
    jwt_exp(token).or_else(|| ttl.map(|secs| now + secs))
}

fn ttl_of(body: &str, source: &TokenSource) -> Option<u64> {
    extract(body, &source.ttl_path)?.parse().ok()
}

/// One response of the sign-in, as the rows of the scenario give it.
pub struct Caught<'a> {
    pub node_id: &'a str,
    pub body: &'a str,
}

/// The last response of request `source.request`.
fn body_of<'a>(rows: &[Caught<'a>], source: &TokenSource) -> Option<&'a str> {
    rows.iter()
        .rev()
        .find(|row| row.node_id == source.request)
        .map(|row| row.body)
}

/// A session out of the responses of a finished sign-in.
pub fn catch(config: &SessionConfig, rows: &[Caught<'_>], now: u64) -> Result<Record, String> {
    config.check()?;
    let find = |source: &TokenSource, what: &str| -> Result<String, String> {
        let body = body_of(rows, source)
            .ok_or_else(|| format!("session: the sign-in never ran the request for the {what}"))?;
        extract(body, &source.path)
            .ok_or_else(|| format!("session: no {} in the response for the {what}", source.path))
    };
    let access = find(&config.access, "access token")?;
    let access_ttl = body_of(rows, &config.access).and_then(|b| ttl_of(b, &config.access));
    let (refresh, refresh_exp) = if config.refresh.request.trim().is_empty() {
        (None, None)
    } else {
        let token = find(&config.refresh, "refresh token")?;
        let ttl = body_of(rows, &config.refresh).and_then(|b| ttl_of(b, &config.refresh));
        let exp = expiry(&token, ttl, now);
        (Some(token), exp)
    };
    let who = (!config.who.request.trim().is_empty())
        .then(|| body_of(rows, &config.who).and_then(|body| extract(body, &config.who.path)))
        .flatten();
    Ok(Record {
        access_exp: expiry(&access, access_ttl, now),
        access,
        refresh,
        refresh_exp,
        who,
        obtained_at: now,
    })
}

/// `record` after a renewal answered with `body`: the new access token (and a rotated
/// refresh token when the answer has one).
pub fn renewed(
    config: &SessionConfig,
    record: &Record,
    body: &str,
    now: u64,
) -> Result<Record, String> {
    let path = config.renew_access_path();
    let access =
        extract(body, path).ok_or_else(|| format!("session: the renewal answer has no {path}"))?;
    let ttl = ttl_of(
        body,
        &TokenSource {
            ttl_path: config.access.ttl_path.clone(),
            ..TokenSource::default()
        },
    );
    let mut next = Record {
        access_exp: expiry(&access, ttl, now),
        access,
        obtained_at: now,
        ..record.clone()
    };
    if !config.renew_refresh.trim().is_empty() {
        if let Some(token) = extract(body, &config.renew_refresh) {
            next.refresh_exp = expiry(&token, None, now).or(record.refresh_exp);
            next.refresh = Some(token);
        }
    }
    Ok(next)
}

/// `eyJhbGciOi…k9Pq2`: the head and the tail, enough to tell tokens apart.
pub fn preview(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() <= 20 {
        return "•".repeat(chars.len());
    }
    let head: String = chars[..10].iter().collect();
    let tail: String = chars[chars.len() - 5..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::oauth::MemoryStore;

    fn jwt(exp: u64) -> String {
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{exp}}}"#));
        format!("eyJhbGciOiJIUzI1NiJ9.{payload}.sig")
    }

    fn config() -> SessionConfig {
        SessionConfig {
            login: "Auth · OTP".into(),
            access: TokenSource {
                request: "fs:Auth/Verify OTP.bonk.json".into(),
                path: "body.access_token".into(),
                ..TokenSource::default()
            },
            refresh: TokenSource {
                request: "fs:Auth/Verify OTP.bonk.json".into(),
                path: "body.refresh_token".into(),
                ttl_path: "body.refresh_expires_in".into(),
            },
            renew_request: "fs:Auth/Refresh token.bonk.json".into(),
            ..SessionConfig::default()
        }
    }

    #[test]
    fn extract_walks_objects_arrays_and_numbers() {
        let body = r#"{"data":{"tokens":[{"a":"x"},{"a":"y"}]},"n":900,"empty":"","t":true}"#;
        assert_eq!(extract(body, "body.data.tokens[1].a").as_deref(), Some("y"));
        assert_eq!(extract(body, "data.tokens[0].a").as_deref(), Some("x"));
        assert_eq!(extract(body, "body.n").as_deref(), Some("900"));
        assert_eq!(extract(body, "body.empty"), None);
        assert_eq!(extract(body, "body.t"), None);
        assert_eq!(extract(body, "body.data.tokens[5].a"), None);
        assert_eq!(extract("not json", "body.a"), None);
    }

    #[test]
    fn jwt_lifetime_wins_over_a_ttl_field() {
        let body = format!(
            r#"{{"access_token":"{}","refresh_token":"opaque","refresh_expires_in":2592000}}"#,
            jwt(5_000)
        );
        let rows = [Caught {
            node_id: "fs:Auth/Verify OTP.bonk.json",
            body: &body,
        }];
        let record = catch(&config(), &rows, 1_000).unwrap();
        assert_eq!(record.access_exp, Some(5_000));
        assert_eq!(record.refresh.as_deref(), Some("opaque"));
        assert_eq!(record.refresh_exp, Some(1_000 + 2_592_000));
        assert!(record.access_fresh(1_000, 60));
        assert!(!record.access_fresh(4_950, 60));
        assert!(record.refresh_usable(4_950));
    }

    #[test]
    fn catching_names_what_is_missing() {
        let rows = [Caught {
            node_id: "fs:Auth/Verify OTP.bonk.json",
            body: r#"{"refresh_token":"r"}"#,
        }];
        let err = catch(&config(), &rows, 0).unwrap_err();
        assert!(err.contains("body.access_token"), "{err}");
        let err = catch(&config(), &[], 0).unwrap_err();
        assert!(err.contains("never ran"), "{err}");
        assert!(catch(&SessionConfig::default(), &[], 0).is_err());
    }

    #[test]
    fn a_renewal_keeps_the_refresh_token_unless_the_answer_rotates_it() {
        let now = 100;
        let old = Record {
            access: "old".into(),
            refresh: Some("r1".into()),
            access_exp: Some(50),
            refresh_exp: Some(9_999),
            who: Some("+7".into()),
            obtained_at: 0,
        };
        let mut cfg = config();
        let next = renewed(&cfg, &old, r#"{"access_token":"new"}"#, now).unwrap();
        assert_eq!(next.access, "new");
        assert_eq!(next.refresh.as_deref(), Some("r1"));
        assert_eq!(next.who.as_deref(), Some("+7"));
        assert_eq!(next.obtained_at, now);
        cfg.renew_refresh = "body.refresh_token".into();
        let next = renewed(
            &cfg,
            &old,
            r#"{"access_token":"new","refresh_token":"r2"}"#,
            now,
        )
        .unwrap();
        assert_eq!(next.refresh.as_deref(), Some("r2"));
        assert!(renewed(&cfg, &old, "{}", now).is_err());
    }

    #[test]
    fn the_account_follows_the_environment_not_the_tokens() {
        let a = account("/ws", "Staging", &config());
        assert_eq!(a, account("/ws", "Staging", &config()));
        assert_ne!(a, account("/ws", "Production", &config()));
        assert_ne!(a, account("/other", "Staging", &config()));
        assert!(a.starts_with("session:"));
    }

    #[test]
    fn the_login_folder_and_the_renewal_never_carry_the_session() {
        let mut cfg = config();
        cfg.exclude = vec!["Webhooks".into()];
        let login = vec!["Auth".to_string()];
        assert!(cfg.leaves_out("fs:Auth/Login.bonk.json", &login));
        assert!(cfg.leaves_out("fs:Auth/Refresh token.bonk.json", &[]));
        assert!(cfg.leaves_out("fs:Webhooks/Hook.bonk.json", &login));
        assert!(!cfg.leaves_out("fs:Payments/List.bonk.json", &login));
        assert!(!cfg.leaves_out("fs:AuthX/List.bonk.json", &login));
    }

    #[test]
    fn a_stored_session_round_trips_and_forgets() {
        let store = MemoryStore::default();
        let key = account("/ws", "Staging", &config());
        assert!(stored(&key, &store).is_none());
        let record = Record {
            access: "a".into(),
            refresh: None,
            access_exp: None,
            refresh_exp: None,
            who: None,
            obtained_at: 1,
        };
        save(&key, &store, &record).unwrap();
        assert_eq!(stored(&key, &store), Some(record));
        forget(&key, &store).unwrap();
        assert!(stored(&key, &store).is_none());
    }

    #[test]
    fn the_preview_hides_short_tokens_and_the_middle_of_long_ones() {
        assert_eq!(preview("short"), "•••••");
        assert_eq!(
            preview("eyJhbGciOiJIUzI1NiJ9.payload.k9Pq2"),
            "eyJhbGciOi…k9Pq2"
        );
    }
}
