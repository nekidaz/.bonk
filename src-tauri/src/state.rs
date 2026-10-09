use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

use bonk_core::conn::GrpcConn;
use bonk_core::domain::http::{
    pick_client_cert, ClientCert, ProxyMode, ProxySettings, RequestSettings,
};

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
        }
    }
}

pub struct AppState {
    http_clients: Mutex<HashMap<HttpClientKey, reqwest::Client>>,
    pub conns: Mutex<HashMap<String, GrpcConn>>,
    pub cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// Open client/bidi gRPC streams by request id; removing one half-closes it.
    pub grpc_streams:
        Mutex<HashMap<String, bonk_core::application::grpc_native::StreamSender>>,
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

fn apply_proxy(
    builder: reqwest::ClientBuilder,
    proxy: &ProxySettings,
) -> Result<reqwest::ClientBuilder, String> {
    match proxy.mode {
        ProxyMode::System => Ok(builder),
        ProxyMode::None => Ok(builder.no_proxy()),
        ProxyMode::Manual => {
            let url = proxy.url.trim();
            if url.is_empty() {
                return Err("proxy: URL is empty".to_string());
            }
            // Bare `host:port` (what the settings field suggests) means http://.
            let url = if url.contains("://") {
                url.to_string()
            } else {
                format!("http://{url}")
            };
            let mut p = reqwest::Proxy::all(&url)
                .map_err(|e| format!("proxy: invalid URL «{url}»: {e}"))?;
            if !proxy.username.is_empty() {
                p = p.basic_auth(&proxy.username, &proxy.password);
            }
            Ok(builder.proxy(p.no_proxy(reqwest::NoProxy::from_string(proxy.bypass.trim()))))
        }
    }
}

fn read_pem(path: &str, what: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{what} «{path}»: {e}"))
}

fn apply_tls_files(
    mut builder: reqwest::ClientBuilder,
    ca_paths: &[String],
    trust_system_cas: bool,
    client_cert: Option<&ClientCert>,
) -> Result<reqwest::ClientBuilder, String> {
    let mut roots = Vec::new();
    for path in ca_paths {
        let pem = read_pem(path, "CA certificate")?;
        roots.extend(
            reqwest::Certificate::from_pem_bundle(&pem)
                .map_err(|e| format!("CA certificate «{path}»: {e}"))?,
        );
    }
    // `merge` adds to the system roots, `only` replaces them.
    if trust_system_cas {
        if !roots.is_empty() {
            builder = builder.tls_certs_merge(roots);
        }
    } else {
        builder = builder.tls_certs_only(roots);
    }
    if let Some(c) = client_cert {
        let mut pem = read_pem(&c.cert_path, "client certificate")?;
        pem.push(b'\n');
        pem.extend(read_pem(&c.key_path, "client key")?);
        let id = reqwest::Identity::from_pem(&pem)
            .map_err(|e| format!("client certificate «{}»: {e}", c.cert_path))?;
        builder = builder.identity(id);
    }
    Ok(builder)
}

fn build_http_client(
    key: &HttpClientKey,
    settings: &RequestSettings,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .default_headers(default_headers())
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true)
        .danger_accept_invalid_certs(!settings.validate_tls);
    if settings.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(settings.timeout_ms));
    }
    if !settings.follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    builder = apply_proxy(builder, &settings.proxy)?;
    builder = apply_tls_files(
        builder,
        &settings.ca_paths,
        settings.trust_system_cas,
        key.client_cert.as_ref(),
    )?;
    builder
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

impl AppState {
    /// Client for a request to `url`; its host selects the mTLS identity.
    pub fn http_client(
        &self,
        settings: &RequestSettings,
        url: &str,
    ) -> Result<reqwest::Client, String> {
        let host = reqwest::Url::parse(url)
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
        let client = build_http_client(&key, settings)?;
        clients.insert(key, client.clone());
        Ok(client)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            http_clients: Mutex::new(HashMap::new()),
            conns: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            grpc_streams: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(s: &RequestSettings) -> Result<reqwest::Client, String> {
        build_http_client(&HttpClientKey::new(s, ""), s)
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
