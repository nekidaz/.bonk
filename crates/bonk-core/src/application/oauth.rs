//! OAuth 2.0 (`type: "oauth2"` auth): get, refresh, store and revoke access tokens.
//!
//! Tokens live in the OS keychain, never in workspace files. The key is a hash of the
//! resolved client settings (grant, token URL, client, scope, audience, user): an
//! environment with its own `{{auth_host}}` / `{{client_id}}` gets its own token, and
//! renaming or moving a folder keeps it.
//!
//! HTTP goes through the caller's `send` (the app's client, the runner's transport), so
//! proxy, TLS and certificate settings apply to token requests too.

use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

use super::app_vars::{keychain_secret, KEYCHAIN_SERVICE};
use crate::domain::http::{AuthConfig, HttpRequest, HttpResponse, OAuthConfig};
use crate::domain::request_prep::{resolve_oauth, Scope};

/// A token this close to `expires_at` (seconds) counts as expired: it would die in flight.
const EXPIRY_SKEW: u64 = 30;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub access_token: String,
    #[serde(default)]
    pub token_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Unix seconds; `None` when the server sent no `expires_in`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub obtained_at: u64,
}

impl Token {
    pub fn expired(&self, now: u64) -> bool {
        self.expires_at.is_some_and(|at| now + EXPIRY_SKEW >= at)
    }

    /// What the UI may see: everything but the refresh token itself.
    pub fn info(&self) -> TokenInfo {
        TokenInfo {
            access_token: self.access_token.clone(),
            token_type: self.token_type.clone(),
            has_refresh: self.refresh_token.is_some(),
            expires_at: self.expires_at,
            scope: self.scope.clone(),
            obtained_at: self.obtained_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub access_token: String,
    pub token_type: String,
    pub has_refresh: bool,
    pub expires_at: Option<u64>,
    pub scope: String,
    pub obtained_at: u64,
}

/// A token ready for a send.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ensured {
    pub token: TokenInfo,
    /// Just obtained for this send (the stored one had expired, or `force`).
    pub renewed: bool,
    /// When the replaced token expired, for "expired at 13:04".
    pub previous_expires_at: Option<u64>,
}

/// Serialized for the UI as `{ kind: "provider" | "login" | "other", … }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OAuthError {
    /// The authorization server said no (`status` 0: it said so through the redirect).
    Provider {
        status: u16,
        url: String,
        error: String,
        description: String,
        body: String,
    },
    /// No usable token, and getting one needs the user (code grant, auto-refresh off).
    Login {
        reason: String,
    },
    Other {
        message: String,
    },
}

impl fmt::Display for OAuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Provider {
                status,
                error,
                description,
                ..
            } => {
                let error = if error.is_empty() { "error" } else { error };
                write!(f, "OAuth: {error}")?;
                if !description.is_empty() {
                    write!(f, ": {description}")?;
                }
                if *status != 0 {
                    write!(f, " (HTTP {status})")?;
                }
                Ok(())
            }
            Self::Login { reason } => write!(
                f,
                "OAuth: {reason} — get a token on the request's Authorization tab"
            ),
            Self::Other { message } => f.write_str(message),
        }
    }
}

impl From<String> for OAuthError {
    fn from(message: String) -> Self {
        Self::Other { message }
    }
}

fn other(message: impl Into<String>) -> OAuthError {
    OAuthError::Other {
        message: message.into(),
    }
}

/// Where tokens are kept: the keychain in the apps, memory in tests.
pub trait TokenStore: Sync {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

pub struct Keychain;

impl TokenStore for Keychain {
    fn get(&self, key: &str) -> Option<String> {
        keychain_secret(key)
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, key)
            .and_then(|entry| entry.set_password(value))
            .map_err(|e| format!("keychain: {e}"))
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match keyring::Entry::new(KEYCHAIN_SERVICE, key).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain: {e}")),
        }
    }
}

#[derive(Default)]
pub struct MemoryStore(Mutex<BTreeMap<String, String>>);

impl TokenStore for MemoryStore {
    fn get(&self, key: &str) -> Option<String> {
        self.0.lock().ok()?.get(key).cloned()
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        let mut map = self.0.lock().map_err(|e| e.to_string())?;
        map.insert(key.into(), value.into());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        let mut map = self.0.lock().map_err(|e| e.to_string())?;
        map.remove(key);
        Ok(())
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn grant(oauth: &OAuthConfig) -> &str {
    match oauth.grant.as_str() {
        "" => "authorization_code",
        other => other,
    }
}

/// Keychain account of the token for these (resolved) settings.
pub fn token_key(oauth: &OAuthConfig) -> String {
    let parts = [
        grant(oauth),
        oauth.token_url.trim(),
        oauth.client_id.trim(),
        oauth.scope.trim(),
        oauth.audience.trim(),
        oauth.username.trim(),
    ];
    let digest = Sha256::digest(parts.join("\n").as_bytes());
    let hex: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    format!("oauth:{hex}")
}

pub fn stored(oauth: &OAuthConfig, store: &dyn TokenStore) -> Option<Token> {
    let saved = store.get(&token_key(oauth))?;
    serde_json::from_str(&saved).ok()
}

pub fn forget(oauth: &OAuthConfig, store: &dyn TokenStore) -> Result<(), String> {
    store.delete(&token_key(oauth))
}

fn save(oauth: &OAuthConfig, store: &dyn TokenStore, token: &Token) -> Result<(), OAuthError> {
    let json = serde_json::to_string(token).map_err(|e| e.to_string())?;
    Ok(store.set(&token_key(oauth), &json)?)
}

/// For an outgoing `oauth2` auth: resolve its settings, make sure a valid token is stored
/// (refreshing or re-fetching it when needed) and put it into `bearer_token`, which
/// `request_prep` then sends as `Authorization: Bearer`. `None` for other auth types.
pub async fn prepare_auth<F, Fut>(
    auth: Option<&mut AuthConfig>,
    scope: &Scope,
    store: &dyn TokenStore,
    send: F,
    force: bool,
) -> Result<Option<Ensured>, OAuthError>
where
    F: Fn(HttpRequest) -> Fut,
    Fut: Future<Output = Result<HttpResponse, String>>,
{
    let Some(auth) = auth.filter(|auth| auth.auth_type == "oauth2") else {
        return Ok(None);
    };
    let mut oauth = auth.oauth.clone().unwrap_or_default();
    resolve_oauth(&mut oauth, scope);
    let ensured = ensure_token(&oauth, store, send, now_secs(), force).await?;
    auth.bearer_token = Some(ensured.token.access_token.clone());
    Ok(Some(ensured))
}

/// A valid token for `oauth` (resolved settings). A fresh stored one is reused; an expired
/// one (or any, with `force`) is refreshed by its refresh token, or fetched anew for the
/// grants that need no user. The code grant without a refresh token needs a new login.
pub async fn ensure_token<F, Fut>(
    oauth: &OAuthConfig,
    store: &dyn TokenStore,
    send: F,
    now: u64,
    force: bool,
) -> Result<Ensured, OAuthError>
where
    F: Fn(HttpRequest) -> Fut,
    Fut: Future<Output = Result<HttpResponse, String>>,
{
    let old = stored(oauth, store);
    if let Some(token) = old.as_ref().filter(|t| !force && !t.expired(now)) {
        return Ok(Ensured {
            token: token.info(),
            renewed: false,
            previous_expires_at: None,
        });
    }
    if !force && old.is_some() && oauth.auto_refresh == Some(false) {
        return Err(OAuthError::Login {
            reason: "the token expired and auto-refresh is off".into(),
        });
    }
    let previous_expires_at = old.as_ref().and_then(|t| t.expires_at);
    let token = match old.and_then(|t| t.refresh_token.map(|r| (r, t.scope))) {
        Some((refresh_token, old_scope)) => {
            let form = vec![
                ("grant_type", "refresh_token".to_string()),
                ("refresh_token", refresh_token.clone()),
            ];
            match request_token(oauth, form, &old_scope, &send, now).await {
                Ok(mut token) => {
                    // Servers that do not rotate refresh tokens leave it out of the reply.
                    token.refresh_token.get_or_insert(refresh_token);
                    token
                }
                Err(OAuthError::Provider {
                    error, description, ..
                }) => {
                    // The refresh token is dead: drop it and start over if bonk can.
                    forget(oauth, store)?;
                    if grant(oauth) == "authorization_code" {
                        let reason =
                            format!("the refresh token was rejected ({error} {description})");
                        return Err(OAuthError::Login {
                            reason: reason.trim_end().to_string(),
                        });
                    }
                    fetch(oauth, &send, now).await?
                }
                Err(e) => return Err(e),
            }
        }
        None => fetch(oauth, &send, now).await?,
    };
    save(oauth, store, &token)?;
    Ok(Ensured {
        token: token.info(),
        renewed: true,
        previous_expires_at,
    })
}

/// A new token by a grant that needs no browser.
async fn fetch<F, Fut>(oauth: &OAuthConfig, send: &F, now: u64) -> Result<Token, OAuthError>
where
    F: Fn(HttpRequest) -> Fut,
    Fut: Future<Output = Result<HttpResponse, String>>,
{
    let mut form = match grant(oauth) {
        "client_credentials" => vec![("grant_type", "client_credentials".to_string())],
        "password" => vec![
            ("grant_type", "password".to_string()),
            ("username", oauth.username.clone()),
            ("password", oauth.password.clone()),
        ],
        "authorization_code" => {
            return Err(OAuthError::Login {
                reason: "no token yet".into(),
            })
        }
        other => return Err(other_grant(other)),
    };
    form.push(("scope", oauth.scope.trim().to_string()));
    form.push(("audience", oauth.audience.trim().to_string()));
    request_token(oauth, form, oauth.scope.trim(), send, now).await
}

fn other_grant(grant: &str) -> OAuthError {
    other(format!("OAuth: unsupported grant type `{grant}`"))
}

/// POST `form` (plus client authentication) to the token URL and read the token.
async fn request_token<F, Fut>(
    oauth: &OAuthConfig,
    form: Vec<(&'static str, String)>,
    requested_scope: &str,
    send: &F,
    now: u64,
) -> Result<Token, OAuthError>
where
    F: Fn(HttpRequest) -> Fut,
    Fut: Future<Output = Result<HttpResponse, String>>,
{
    if oauth.token_url.trim().is_empty() {
        return Err(other("OAuth: the Token URL is empty"));
    }
    let request = form_request(oauth, &oauth.token_url, form);
    let response = send(request).await?;
    parse_token(&response, oauth.token_url.trim(), requested_scope, now)
}

/// A form POST to the authorization server with the client's credentials: in an
/// `Authorization: Basic` header, or in the form (`client_auth: body`, or a public
/// client without a secret).
fn form_request(oauth: &OAuthConfig, url: &str, mut form: Vec<(&str, String)>) -> HttpRequest {
    let mut headers = BTreeMap::from([
        ("Accept".to_string(), "application/json".to_string()),
        (
            "Content-Type".to_string(),
            "application/x-www-form-urlencoded".to_string(),
        ),
    ]);
    let id = oauth.client_id.trim();
    let secret = oauth.client_secret.trim();
    if oauth.client_auth == "body" || secret.is_empty() {
        form.push(("client_id", id.to_string()));
        form.push(("client_secret", secret.to_string()));
    } else {
        let basic = BASE64.encode(format!("{id}:{secret}"));
        headers.insert("Authorization".into(), format!("Basic {basic}"));
    }
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().filter(|(_, v)| !v.is_empty()))
        .finish();
    HttpRequest {
        method: "POST".into(),
        url: url.trim().into(),
        headers,
        body: Some(body),
        graphql_variables: None,
        binary_file_path: None,
        body_mode: Some("raw".into()),
        raw_body_format: Some("Text".into()),
        body_params: None,
        auth: None,
        pre_request_script: None,
        test_script: None,
        header_notes: None,
        disabled_headers: None,
    }
}

/// A token from a JSON reply (or a form-encoded one, as GitHub's legacy endpoint sends).
/// An `error` field fails even with HTTP 200: GitHub does that too.
fn parse_token(
    response: &HttpResponse,
    url: &str,
    requested_scope: &str,
    now: u64,
) -> Result<Token, OAuthError> {
    let fields: BTreeMap<String, Value> =
        serde_json::from_str(&response.body).unwrap_or_else(|_| {
            url::form_urlencoded::parse(response.body.as_bytes())
                .map(|(k, v)| (k.into_owned(), Value::String(v.into_owned())))
                .collect()
        });
    let text = |name: &str| match fields.get(name) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    let access_token = text("access_token");
    let ok = (200..300).contains(&response.status);
    if !ok || access_token.is_empty() || !text("error").is_empty() {
        return Err(provider_error(
            response,
            url,
            &text("error"),
            &text("error_description"),
        ));
    }
    let scope = Some(text("scope"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| requested_scope.to_string());
    Ok(Token {
        access_token,
        token_type: text("token_type"),
        refresh_token: Some(text("refresh_token")).filter(|t| !t.is_empty()),
        expires_at: text("expires_in").parse::<u64>().ok().map(|s| now + s),
        scope,
        obtained_at: now,
    })
}

fn provider_error(
    response: &HttpResponse,
    url: &str,
    error: &str,
    description: &str,
) -> OAuthError {
    OAuthError::Provider {
        status: response.status,
        url: url.into(),
        error: error.into(),
        description: description.into(),
        body: response.body.chars().take(4000).collect(),
    }
}

/// Revoke at the provider (RFC 7009) when a revocation URL is set, then forget the token.
pub async fn revoke<F, Fut>(
    oauth: &OAuthConfig,
    store: &dyn TokenStore,
    send: F,
) -> Result<(), OAuthError>
where
    F: Fn(HttpRequest) -> Fut,
    Fut: Future<Output = Result<HttpResponse, String>>,
{
    let url = oauth.revoke_url.trim();
    if let Some(token) = stored(oauth, store).filter(|_| !url.is_empty()) {
        // Revoking the refresh token ends the whole grant; the access token alone may not.
        let (value, hint) = match token.refresh_token {
            Some(refresh) => (refresh, "refresh_token"),
            None => (token.access_token, "access_token"),
        };
        let form = vec![("token", value), ("token_type_hint", hint.to_string())];
        let response = send(form_request(oauth, url, form)).await?;
        if !(200..300).contains(&response.status) {
            return Err(provider_error(&response, url, "", ""));
        }
    }
    Ok(forget(oauth, store)?)
}

/// A started code-grant login: open `url` in a browser, then `wait` for the redirect (or
/// take a code pasted by hand) and `finish`.
pub struct Authorize {
    pub url: String,
    pub redirect_uri: String,
    state: String,
    verifier: Option<String>,
    /// `None` when the redirect URI is not a loopback address: only a pasted code works.
    listener: Option<TcpListener>,
}

pub async fn begin_authorize(oauth: &OAuthConfig) -> Result<Authorize, OAuthError> {
    if oauth.auth_url.trim().is_empty() {
        return Err(other("OAuth: the Auth URL is empty"));
    }
    let mut url = Url::parse(oauth.auth_url.trim())
        .map_err(|e| other(format!("OAuth: bad Auth URL: {e}")))?;
    let (listener, redirect_uri) = redirect_listener(&oauth.redirect_uri).await?;
    let state = random_string()?;
    let verifier = match oauth.pkce {
        Some(false) => None,
        _ => Some(random_string()?),
    };
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", oauth.client_id.trim())
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("state", &state);
        for (name, value) in [("scope", &oauth.scope), ("audience", &oauth.audience)] {
            if !value.trim().is_empty() {
                query.append_pair(name, value.trim());
            }
        }
        if let Some(verifier) = &verifier {
            query
                .append_pair("code_challenge", &pkce_challenge(verifier))
                .append_pair("code_challenge_method", "S256");
        }
    }
    Ok(Authorize {
        url: url.into(),
        redirect_uri,
        state,
        verifier,
        listener,
    })
}

/// Empty: a free port on 127.0.0.1. A loopback `http://` URI: listen on exactly that port
/// (the provider has it registered). Anything else: no listener.
async fn redirect_listener(configured: &str) -> Result<(Option<TcpListener>, String), OAuthError> {
    let configured = configured.trim();
    let io = |e: std::io::Error| other(format!("OAuth: cannot listen for the redirect: {e}"));
    if configured.is_empty() {
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(io)?;
        let port = listener.local_addr().map_err(io)?.port();
        return Ok((Some(listener), format!("http://127.0.0.1:{port}/callback")));
    }
    let url = Url::parse(configured).map_err(|e| other(format!("OAuth: bad Redirect URI: {e}")))?;
    let host = match url.host_str() {
        Some("127.0.0.1" | "localhost") if url.scheme() == "http" => "127.0.0.1",
        Some("[::1]") if url.scheme() == "http" => "[::1]",
        _ => return Ok((None, configured.to_string())),
    };
    let port = url.port_or_known_default().unwrap_or(80);
    let listener = TcpListener::bind(format!("{host}:{port}"))
        .await
        .map_err(io)?;
    Ok((Some(listener), configured.to_string()))
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>bonk</title>\
<body style=\"font:15px system-ui;padding:48px\">Готово — вернитесь в bonk.<br>Done — you can return to bonk.";
const FAILED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>bonk</title>\
<body style=\"font:15px system-ui;padding:48px\">Вход не удался — подробности в bonk.<br>Sign-in failed — see bonk for details.";

impl Authorize {
    pub fn listens(&self) -> bool {
        self.listener.is_some()
    }

    /// The code from the browser's redirect to the loopback listener. Never resolves
    /// without a listener (race it with a pasted code).
    pub async fn wait(&self) -> Result<String, OAuthError> {
        let Some(listener) = &self.listener else {
            return std::future::pending().await;
        };
        let io = |e: std::io::Error| other(format!("OAuth: redirect listener: {e}"));
        loop {
            let (mut stream, _) = listener.accept().await.map_err(io)?;
            let mut buf = vec![0u8; 16 * 1024];
            let mut len = 0;
            while len < buf.len() {
                let n = stream.read(&mut buf[len..]).await.map_err(io)?;
                len += n;
                if n == 0 || buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let head = String::from_utf8_lossy(&buf[..len]);
            let target = head.split_whitespace().nth(1).unwrap_or("/");
            let params = query_params(target.split_once('?').map_or("", |(_, q)| q));
            if !params.contains_key("code") && !params.contains_key("error") {
                // A favicon or a stray probe: not the redirect.
                let reply =
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(reply.as_bytes()).await;
                continue;
            }
            let result = self.code_from(&params, true);
            let page = if result.is_ok() {
                DONE_PAGE
            } else {
                FAILED_PAGE
            };
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                page.len()
            );
            let _ = stream.write_all(reply.as_bytes()).await;
            return result;
        }
    }

    /// A code pasted by hand: the whole redirect URL, or the bare code.
    pub fn pasted(&self, input: &str) -> Result<String, OAuthError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(other("OAuth: paste the code or the whole redirect URL"));
        }
        match input.split_once('?') {
            Some((_, query)) if query.contains("code=") || query.contains("error=") => {
                let query = query.split('#').next().unwrap_or_default();
                self.code_from(&query_params(query), false)
            }
            _ => Ok(input.to_string()),
        }
    }

    /// `state` must come back unchanged from the browser; a pasted URL may have lost it.
    fn code_from(
        &self,
        params: &BTreeMap<String, String>,
        require_state: bool,
    ) -> Result<String, OAuthError> {
        if let Some(error) = params.get("error") {
            return Err(OAuthError::Provider {
                status: 0,
                url: self.redirect_uri.clone(),
                error: error.clone(),
                description: params.get("error_description").cloned().unwrap_or_default(),
                body: String::new(),
            });
        }
        match params.get("state") {
            Some(state) if *state == self.state => {}
            None if !require_state => {}
            _ => {
                return Err(other(
                    "OAuth: the redirect's state does not match this login",
                ))
            }
        }
        params
            .get("code")
            .cloned()
            .ok_or_else(|| other("OAuth: the redirect has no code"))
    }

    /// Exchange the code for a token and store it.
    pub async fn finish<F, Fut>(
        &self,
        oauth: &OAuthConfig,
        code: &str,
        store: &dyn TokenStore,
        send: F,
        now: u64,
    ) -> Result<Token, OAuthError>
    where
        F: Fn(HttpRequest) -> Fut,
        Fut: Future<Output = Result<HttpResponse, String>>,
    {
        let mut form = vec![
            ("grant_type", "authorization_code".to_string()),
            ("code", code.to_string()),
            ("redirect_uri", self.redirect_uri.clone()),
        ];
        if let Some(verifier) = &self.verifier {
            form.push(("code_verifier", verifier.clone()));
        }
        let token = request_token(oauth, form, oauth.scope.trim(), &send, now).await?;
        save(oauth, store, &token)?;
        Ok(token)
    }
}

fn query_params(query: &str) -> BTreeMap<String, String> {
    url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect()
}

/// 32 random bytes, base64url: a PKCE verifier (43 chars) or a `state`.
fn random_string() -> Result<String, OAuthError> {
    let mut bytes = [0u8; 32];
    rustls::crypto::aws_lc_rs::default_provider()
        .secure_random
        .fill(&mut bytes)
        .map_err(|_| other("OAuth: no secure random source"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn response(status: u16, body: &str) -> HttpResponse {
        serde_json::from_value(serde_json::json!({
            "status": status, "headers": {}, "body": body, "final_url": "",
            "elapsed_ms": 1, "size_bytes": body.len(),
        }))
        .unwrap()
    }

    /// Records each request and answers with the next canned reply.
    struct Server {
        sent: Mutex<Vec<HttpRequest>>,
        replies: Mutex<Vec<HttpResponse>>,
    }

    impl Server {
        fn new(replies: Vec<HttpResponse>) -> Self {
            Self {
                sent: Mutex::new(Vec::new()),
                replies: Mutex::new(replies),
            }
        }

        fn send(
            &self,
        ) -> impl Fn(HttpRequest) -> std::future::Ready<Result<HttpResponse, String>> + '_ {
            move |request| {
                self.sent.lock().unwrap().push(request);
                std::future::ready(Ok(self.replies.lock().unwrap().remove(0)))
            }
        }

        fn forms(&self) -> Vec<BTreeMap<String, String>> {
            let sent = self.sent.lock().unwrap();
            sent.iter()
                .map(|r| query_params(r.body.as_deref().unwrap_or_default()))
                .collect()
        }
    }

    fn config(grant: &str) -> OAuthConfig {
        OAuthConfig {
            grant: grant.into(),
            auth_url: "https://auth.test/authorize".into(),
            token_url: "https://auth.test/token".into(),
            client_id: "cli".into(),
            client_secret: "sec".into(),
            scope: "read write".into(),
            ..OAuthConfig::default()
        }
    }

    fn put(store: &MemoryStore, oauth: &OAuthConfig, token: &Token) {
        save(oauth, store, token).unwrap();
    }

    fn token(expires_at: Option<u64>, refresh: Option<&str>) -> Token {
        Token {
            access_token: "old".into(),
            token_type: "Bearer".into(),
            refresh_token: refresh.map(str::to_string),
            expires_at,
            scope: "read write".into(),
            obtained_at: 0,
        }
    }

    #[test]
    fn key_follows_the_client_settings_not_the_secret() {
        let a = config("client_credentials");
        let other_secret = OAuthConfig {
            client_secret: "x".into(),
            ..a.clone()
        };
        let other_scope = OAuthConfig {
            scope: "read".into(),
            ..a.clone()
        };
        assert_eq!(token_key(&a), token_key(&other_secret));
        assert_ne!(token_key(&a), token_key(&other_scope));
        assert!(token_key(&a).starts_with("oauth:"));
    }

    #[test]
    fn pkce_matches_rfc_7636() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(random_string().unwrap().len(), 43);
    }

    #[tokio::test]
    async fn a_fresh_token_is_reused_without_a_request() {
        let store = MemoryStore::default();
        let oauth = config("client_credentials");
        put(&store, &oauth, &token(Some(1000), None));
        let server = Server::new(vec![]);
        let got = ensure_token(&oauth, &store, server.send(), 900, false)
            .await
            .unwrap();
        assert_eq!(got.token.access_token, "old");
        assert!(!got.renewed);
        assert!(server.forms().is_empty());
    }

    #[tokio::test]
    async fn an_expired_token_is_refreshed_and_keeps_its_refresh_token() {
        let store = MemoryStore::default();
        let oauth = config("authorization_code");
        put(&store, &oauth, &token(Some(1000), Some("r1")));
        let server = Server::new(vec![response(
            200,
            r#"{"access_token":"new","token_type":"Bearer","expires_in":3600}"#,
        )]);
        let got = ensure_token(&oauth, &store, server.send(), 980, false)
            .await
            .unwrap();
        assert!(got.renewed);
        assert_eq!(got.previous_expires_at, Some(1000));
        assert_eq!(got.token.access_token, "new");
        assert_eq!(got.token.expires_at, Some(980 + 3600));
        let form = &server.forms()[0];
        assert_eq!(form["grant_type"], "refresh_token");
        assert_eq!(form["refresh_token"], "r1");
        let saved = stored(&oauth, &store).unwrap();
        assert_eq!(saved.refresh_token.as_deref(), Some("r1"));
        assert_eq!(saved.scope, "read write");
    }

    #[tokio::test]
    async fn client_credentials_fetches_with_basic_client_auth() {
        let store = MemoryStore::default();
        let oauth = config("client_credentials");
        let server = Server::new(vec![response(200, "access_token=t1&token_type=bearer")]);
        let got = ensure_token(&oauth, &store, server.send(), 0, false)
            .await
            .unwrap();
        assert_eq!(got.token.access_token, "t1");
        assert_eq!(got.token.expires_at, None);
        let sent = server.sent.lock().unwrap();
        assert_eq!(sent[0].url, "https://auth.test/token");
        assert_eq!(sent[0].headers["Authorization"], "Basic Y2xpOnNlYw==");
        let form = query_params(sent[0].body.as_deref().unwrap());
        assert_eq!(form["grant_type"], "client_credentials");
        assert_eq!(form["scope"], "read write");
        assert!(!form.contains_key("client_secret"));
    }

    #[tokio::test]
    async fn password_grant_sends_credentials_in_the_body_when_asked() {
        let store = MemoryStore::default();
        let oauth = OAuthConfig {
            client_auth: "body".into(),
            username: "u".into(),
            password: "p".into(),
            ..config("password")
        };
        let server = Server::new(vec![response(200, r#"{"access_token":"t"}"#)]);
        ensure_token(&oauth, &store, server.send(), 0, false)
            .await
            .unwrap();
        let form = &server.forms()[0];
        assert_eq!(
            (form["username"].as_str(), form["password"].as_str()),
            ("u", "p")
        );
        assert_eq!(form["client_secret"], "sec");
        assert!(!server.sent.lock().unwrap()[0]
            .headers
            .contains_key("Authorization"));
    }

    #[tokio::test]
    async fn the_code_grant_without_a_token_needs_a_login() {
        let store = MemoryStore::default();
        let server = Server::new(vec![]);
        let err = ensure_token(&config(""), &store, server.send(), 0, false)
            .await
            .unwrap_err();
        assert!(matches!(err, OAuthError::Login { .. }), "{err:?}");
    }

    #[tokio::test]
    async fn a_rejected_refresh_drops_the_token() {
        let store = MemoryStore::default();
        let oauth = config("authorization_code");
        put(&store, &oauth, &token(Some(10), Some("dead")));
        let server = Server::new(vec![response(400, r#"{"error":"invalid_grant"}"#)]);
        let err = ensure_token(&oauth, &store, server.send(), 100, false)
            .await
            .unwrap_err();
        assert!(matches!(err, OAuthError::Login { .. }), "{err:?}");
        assert!(stored(&oauth, &store).is_none());
    }

    #[tokio::test]
    async fn provider_errors_are_parsed_even_with_http_200() {
        let store = MemoryStore::default();
        let server = Server::new(vec![response(
            200,
            r#"{"error":"invalid_client","error_description":"bad secret"}"#,
        )]);
        let err = ensure_token(
            &config("client_credentials"),
            &store,
            server.send(),
            0,
            false,
        )
        .await
        .unwrap_err();
        let OAuthError::Provider {
            status,
            error,
            description,
            ..
        } = &err
        else {
            panic!("{err:?}")
        };
        assert_eq!(
            (*status, error.as_str(), description.as_str()),
            (200, "invalid_client", "bad secret")
        );
        assert_eq!(
            err.to_string(),
            "OAuth: invalid_client: bad secret (HTTP 200)"
        );
    }

    #[tokio::test]
    async fn auto_refresh_off_keeps_an_expired_token_until_asked() {
        let store = MemoryStore::default();
        let oauth = OAuthConfig {
            auto_refresh: Some(false),
            ..config("client_credentials")
        };
        put(&store, &oauth, &token(Some(10), None));
        let server = Server::new(vec![response(200, r#"{"access_token":"t"}"#)]);
        let err = ensure_token(&oauth, &store, server.send(), 100, false).await;
        assert!(matches!(err, Err(OAuthError::Login { .. })));
        let forced = ensure_token(&oauth, &store, server.send(), 100, true)
            .await
            .unwrap();
        assert_eq!(forced.token.access_token, "t");
    }

    #[tokio::test]
    async fn revoke_posts_the_refresh_token_then_forgets() {
        let store = MemoryStore::default();
        let oauth = OAuthConfig {
            revoke_url: "https://auth.test/revoke".into(),
            ..config("authorization_code")
        };
        put(&store, &oauth, &token(None, Some("r")));
        let server = Server::new(vec![response(200, "")]);
        revoke(&oauth, &store, server.send()).await.unwrap();
        let form = &server.forms()[0];
        assert_eq!(
            (form["token"].as_str(), form["token_type_hint"].as_str()),
            ("r", "refresh_token")
        );
        assert!(stored(&oauth, &store).is_none());
    }

    #[tokio::test]
    async fn prepare_auth_resolves_vars_and_fills_the_bearer() {
        let store = MemoryStore::default();
        let mut oauth = config("client_credentials");
        oauth.token_url = "{{host}}/token".into();
        let mut auth = AuthConfig {
            auth_type: "oauth2".into(),
            oauth: Some(oauth),
            ..AuthConfig::default()
        };
        let scope = Scope::from([("host".to_string(), "https://auth.test".to_string())]);
        let server = Server::new(vec![response(200, r#"{"access_token":"t"}"#)]);
        let got = prepare_auth(Some(&mut auth), &scope, &store, server.send(), false)
            .await
            .unwrap();
        assert!(got.is_some());
        assert_eq!(auth.bearer_token.as_deref(), Some("t"));
        assert_eq!(
            server.sent.lock().unwrap()[0].url,
            "https://auth.test/token"
        );
        let mut bearer = AuthConfig {
            auth_type: "bearer".into(),
            ..AuthConfig::default()
        };
        let none = prepare_auth(Some(&mut bearer), &scope, &store, server.send(), false).await;
        assert_eq!(none, Ok(None));
    }

    #[tokio::test]
    async fn the_code_grant_round_trip() {
        let oauth = OAuthConfig {
            audience: "api".into(),
            ..config("authorization_code")
        };
        let login = begin_authorize(&oauth).await.unwrap();
        assert!(login.listens());
        assert!(login.redirect_uri.starts_with("http://127.0.0.1:"));
        let query = query_params(login.url.split_once('?').unwrap().1);
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["redirect_uri"], login.redirect_uri);
        assert_eq!(query["audience"], "api");
        assert_eq!(query["code_challenge_method"], "S256");
        let verifier = login.verifier.clone().unwrap();
        assert_eq!(query["code_challenge"], pkce_challenge(&verifier));

        let redirect = format!("{}?code=c1&state={}", login.redirect_uri, login.state);
        let path = redirect
            .trim_start_matches("http://")
            .split_once('/')
            .unwrap();
        let browser = async {
            let mut stream = tokio::net::TcpStream::connect(path.0).await.unwrap();
            let request = format!("GET /{} HTTP/1.1\r\nHost: x\r\n\r\n", path.1);
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).await.unwrap();
            reply
        };
        let (code, reply) = tokio::join!(login.wait(), browser);
        assert_eq!(code.unwrap(), "c1");
        assert!(reply.starts_with("HTTP/1.1 200"));

        let store = MemoryStore::default();
        let server = Server::new(vec![response(
            200,
            r#"{"access_token":"t","refresh_token":"r","expires_in":"60"}"#,
        )]);
        let token = login
            .finish(&oauth, "c1", &store, server.send(), 5)
            .await
            .unwrap();
        assert_eq!(token.expires_at, Some(65));
        let form = &server.forms()[0];
        assert_eq!(form["code_verifier"], verifier);
        assert_eq!(form["redirect_uri"], login.redirect_uri);
        assert_eq!(
            stored(&oauth, &store).unwrap().refresh_token.as_deref(),
            Some("r")
        );
    }

    #[tokio::test]
    async fn pasted_codes_and_redirect_errors() {
        let oauth = OAuthConfig {
            redirect_uri: "https://example.com/cb".into(),
            ..config("")
        };
        let login = begin_authorize(&oauth).await.unwrap();
        assert!(!login.listens());
        assert_eq!(login.pasted(" abc ").unwrap(), "abc");
        assert_eq!(
            login
                .pasted("https://example.com/cb?code=x%2By#frag")
                .unwrap(),
            "x+y"
        );
        assert!(login
            .pasted("https://example.com/cb?code=x&state=evil")
            .is_err());
        let denied = login
            .pasted("https://example.com/cb?error=access_denied&error_description=no")
            .unwrap_err();
        assert!(matches!(denied, OAuthError::Provider { status: 0, .. }));
    }
}
