use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

use bonk_core::conn::GrpcConn;
use bonk_core::domain::http::RequestSettings;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct HttpClientKey {
    timeout_ms: u64,
    follow_redirects: bool,
    validate_tls: bool,
}

impl From<&RequestSettings> for HttpClientKey {
    fn from(settings: &RequestSettings) -> Self {
        Self {
            timeout_ms: settings.timeout_ms,
            follow_redirects: settings.follow_redirects,
            validate_tls: settings.validate_tls,
        }
    }
}

pub struct AppState {
    http_clients: Mutex<HashMap<HttpClientKey, reqwest::Client>>,
    pub conns: Mutex<HashMap<String, GrpcConn>>,
    pub cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

fn default_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Bonk/0.1"));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers
}

fn build_http_client(settings: &RequestSettings) -> Result<reqwest::Client, String> {
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
    builder
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

impl AppState {
    pub fn http_client(&self, settings: &RequestSettings) -> Result<reqwest::Client, String> {
        let key = HttpClientKey::from(settings);
        let mut clients = self
            .http_clients
            .lock()
            .map_err(|_| "http client cache lock poisoned".to_string())?;
        if let Some(client) = clients.get(&key) {
            return Ok(client.clone());
        }
        let client = build_http_client(settings)?;
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
        }
    }
}
