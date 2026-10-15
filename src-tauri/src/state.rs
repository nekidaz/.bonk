use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use bonk_core::conn::GrpcConn;
use bonk_core::domain::http::{pick_client_cert, ClientCert, ProxySettings, RequestSettings};
use bonk_core::infra::cookie_jar::{jar_path, CookieJar, JarProvider};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct HttpClientKey {
    timeout_ms: u64,
    follow_redirects: bool,
    validate_tls: bool,
    proxy: ProxySettings,
    ca_paths: Vec<String>,
    trust_system_cas: bool,
    /// The identity picked for the request host (certs are per-host, a client holds one).
    client_cert: Option<ClientCert>,
    cookie_jar: String,
    cookies_save: bool,
    cookies_send: bool,
    cookies_exclude: Vec<String>,
}

impl HttpClientKey {
    fn new(settings: &RequestSettings, host: &str) -> Self {
        Self {
            timeout_ms: settings.timeout_ms,
            follow_redirects: settings.follow_redirects,
            validate_tls: settings.validate_tls,
            proxy: settings.proxy.clone(),
            ca_paths: settings.ca_paths.clone(),
            trust_system_cas: settings.trust_system_cas,
            client_cert: pick_client_cert(&settings.client_certs, host).cloned(),
            cookie_jar: settings.cookie_jar.clone(),
            cookies_save: settings.cookies_save,
            cookies_send: settings.cookies_send,
            cookies_exclude: settings.cookies_exclude.clone(),
        }
    }
}

pub struct AppState {
    http_clients: Mutex<HashMap<HttpClientKey, reqwest::Client>>,
    /// Open cookie jars by workspace root ('' = the app-wide jar).
    cookie_jars: Mutex<HashMap<String, Arc<CookieJar>>>,
    pub conns: Mutex<HashMap<String, GrpcConn>>,
    pub cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// Open client/bidi gRPC streams by request id; removing one half-closes it.
    pub grpc_streams: Mutex<HashMap<String, bonk_core::application::grpc_native::StreamSender>>,
    /// Collection Runner runs in progress by run id (pause / stop).
    pub runs: Mutex<HashMap<String, Arc<bonk_core::application::runner::RunControl>>>,
    /// Forms a run waits on, by input id: the run that asked and where the answer goes.
    pub inputs: Mutex<
        HashMap<
            String,
            (
                String,
                oneshot::Sender<bonk_core::application::runner::InputAnswer>,
            ),
        >,
    >,
    /// OAuth browser logins waiting for their redirect, by flow id.
    pub oauth_logins: Mutex<HashMap<String, Arc<crate::commands::oauth::Login>>>,
    /// Watches the open workspace folder for outside changes; replacing it stops the old one.
    pub workspace_watcher: Mutex<Option<crate::commands::workspace::Watcher>>,
}

fn default_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    // `bonk/<version> (<os>)`, the value the Headers tab previews as auto (S12).
    let os = match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    };
    let agent = format!("bonk/{} ({os})", env!("CARGO_PKG_VERSION"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(&agent).unwrap_or(HeaderValue::from_static("bonk")),
    );
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers
}

fn build_http_client(
    key: &HttpClientKey,
    settings: &RequestSettings,
    jar: Option<Arc<CookieJar>>,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .default_headers(default_headers())
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true);
    if let Some(jar) = jar.filter(|_| settings.cookies_save || settings.cookies_send) {
        builder = builder.cookie_provider(Arc::new(JarProvider {
            jar,
            save: settings.cookies_save,
            send: settings.cookies_send,
            exclude: settings.cookies_exclude.clone(),
        }));
    }
    builder = bonk_core::application::http_client::configure(
        builder,
        settings,
        key.client_cert.as_ref(),
    )?;
    builder
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

impl AppState {
    /// The cookie jar of workspace root `workspace`, opened from `data_dir/cookies/` once.
    pub fn cookie_jar(&self, data_dir: &Path, workspace: &str) -> Result<Arc<CookieJar>, String> {
        let mut jars = self
            .cookie_jars
            .lock()
            .map_err(|_| "cookie jar lock poisoned".to_string())?;
        if let Some(jar) = jars.get(workspace) {
            return Ok(jar.clone());
        }
        let jar = Arc::new(CookieJar::open(jar_path(data_dir, workspace))?);
        jars.insert(workspace.to_string(), jar.clone());
        Ok(jar)
    }

    /// Client for a request to `url`; its host selects the mTLS identity, `jar` (the
    /// workspace's, from `settings.cookie_jar`) stores and sends its cookies.
    pub fn http_client(
        &self,
        settings: &RequestSettings,
        url: &str,
        jar: Option<Arc<CookieJar>>,
    ) -> Result<reqwest::Client, String> {
        let host = reqwest::Url::parse(&bonk_core::domain::url::normalize_url(url))
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default();
        let key = HttpClientKey::new(settings, &host);
        let mut clients = self
            .http_clients
            .lock()
            .map_err(|_| "http client cache lock poisoned".to_string())?;
        if let Some(client) = clients.get(&key) {
            return Ok(client.clone());
        }
        let client = build_http_client(&key, settings, jar)?;
        clients.insert(key, client.clone());
        Ok(client)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            http_clients: Mutex::new(HashMap::new()),
            cookie_jars: Mutex::new(HashMap::new()),
            conns: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            grpc_streams: Mutex::new(HashMap::new()),
            runs: Mutex::new(HashMap::new()),
            inputs: Mutex::new(HashMap::new()),
            oauth_logins: Mutex::new(HashMap::new()),
            workspace_watcher: Mutex::new(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bonk_core::domain::http::ProxyMode;

    fn build(s: &RequestSettings) -> Result<reqwest::Client, String> {
        build_http_client(&HttpClientKey::new(s, ""), s, None)
    }

    fn with_proxy(mode: ProxyMode, url: &str) -> RequestSettings {
        RequestSettings {
            proxy: ProxySettings {
                mode,
                url: url.into(),
                bypass: "localhost, .internal".into(),
                ..ProxySettings::default()
            },
            ..RequestSettings::default()
        }
    }

    #[test]
    fn proxy_modes_map_to_builder() {
        assert!(build(&with_proxy(ProxyMode::System, "")).is_ok());
        assert!(build(&with_proxy(ProxyMode::None, "")).is_ok());
        assert!(build(&with_proxy(ProxyMode::Manual, "http://127.0.0.1:8080")).is_ok());
        assert!(build(&with_proxy(ProxyMode::Manual, "socks5://127.0.0.1:1080")).is_ok());
    }

    #[test]
    fn manual_proxy_rejects_bad_urls() {
        assert!(build(&with_proxy(ProxyMode::Manual, "")).is_err());
        assert!(build(&with_proxy(ProxyMode::Manual, "not a url")).is_err());
    }

    #[test]
    fn missing_cert_files_are_errors_not_panics() {
        let ca = RequestSettings {
            ca_paths: vec!["/nonexistent/ca.pem".into()],
            ..RequestSettings::default()
        };
        assert!(build(&ca).unwrap_err().contains("CA certificate"));
        let cert = RequestSettings {
            client_certs: vec![ClientCert {
                host: String::new(),
                cert_path: "/nonexistent/c.pem".into(),
                key_path: "/nonexistent/k.pem".into(),
                p12_path: None,
                p12_password: None,
            }],
            ..RequestSettings::default()
        };
        assert!(build(&cert).unwrap_err().contains("client certificate"));
    }

    #[test]
    fn client_key_distinguishes_proxy_and_certs() {
        let a = RequestSettings::default();
        let b = with_proxy(ProxyMode::None, "");
        let c = RequestSettings {
            ca_paths: vec!["x.pem".into()],
            ..RequestSettings::default()
        };
        assert_ne!(HttpClientKey::new(&a, ""), HttpClientKey::new(&b, ""));
        assert_ne!(HttpClientKey::new(&a, ""), HttpClientKey::new(&c, ""));
    }
}
