//! OAuth 2.0 for the Authorization tab and the send path. Each command takes the auth
//! as configured (with `{{vars}}`) plus the variable scope, so the token key is always
//! computed from the same resolved settings. Logic lives in `bonk_core::application::oauth`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bonk_core::application::oauth::{self, Authorize, Ensured, Keychain, OAuthError, TokenInfo};
use bonk_core::domain::http::{AuthConfig, HttpRequest, OAuthConfig, RequestSettings};
use bonk_core::domain::request_prep::resolve_oauth;
use serde::Serialize;
use tauri::State;
use tokio::sync::{mpsc, Mutex};

use crate::state::AppState;

type Scope = BTreeMap<String, String>;

/// A browser login waiting for its redirect, or for a pasted code / cancel on `input`.
pub struct Login {
    authorize: Authorize,
    oauth: OAuthConfig,
    input: mpsc::Sender<Option<String>>,
    inbox: Mutex<mpsc::Receiver<Option<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStarted {
    flow_id: String,
    url: String,
    redirect_uri: String,
    /// False: the redirect URI is not a loopback address, so the code must be pasted.
    listens: bool,
}

fn resolved(auth: &AuthConfig, scope: &Scope) -> OAuthConfig {
    let mut oauth = auth.oauth.clone().unwrap_or_default();
    resolve_oauth(&mut oauth, scope);
    oauth
}

/// Token requests go out like any request (proxy, TLS, certificates), without cookies.
fn sender<'a>(
    state: &'a AppState,
    settings: &'a RequestSettings,
) -> impl Fn(
    HttpRequest,
) -> std::pin::Pin<
    Box<
        dyn std::future::Future<Output = Result<bonk_core::domain::http::HttpResponse, String>>
            + Send
            + 'a,
    >,
> + 'a {
    move |request: HttpRequest| {
        let client = state.http_client(settings, &request.url, None);
        let settings = settings.clone();
        Box::pin(async move {
            bonk_core::application::http::http_send(client?, request, settings, None).await
        })
    }
}

fn settings_or_default(settings: Option<RequestSettings>) -> RequestSettings {
    settings.unwrap_or_default().normalized()
}

/// The stored token for this auth, if any (expired ones too: the card says so).
#[tauri::command]
pub fn oauth_status(auth: AuthConfig, scope: Scope) -> Option<TokenInfo> {
    oauth::stored(&resolved(&auth, &scope), &Keychain).map(|token| token.info())
}

/// A valid token for a send: the stored one, or a refreshed / newly fetched one.
/// `force`: renew even a fresh token (the "Refresh" button, a 401 retry).
#[tauri::command]
pub async fn oauth_token(
    auth: AuthConfig,
    scope: Scope,
    settings: Option<RequestSettings>,
    force: bool,
    state: State<'_, AppState>,
) -> Result<Ensured, OAuthError> {
    let settings = settings_or_default(settings);
    let oauth = resolved(&auth, &scope);
    let send = sender(&state, &settings);
    oauth::ensure_token(&oauth, &Keychain, send, oauth::now_secs(), force).await
}

#[tauri::command]
pub fn oauth_forget(auth: AuthConfig, scope: Scope) -> Result<(), String> {
    oauth::forget(&resolved(&auth, &scope), &Keychain)
}

#[tauri::command]
pub async fn oauth_revoke(
    auth: AuthConfig,
    scope: Scope,
    settings: Option<RequestSettings>,
    state: State<'_, AppState>,
) -> Result<(), OAuthError> {
    let settings = settings_or_default(settings);
    let send = sender(&state, &settings);
    oauth::revoke(&resolved(&auth, &scope), &Keychain, send).await
}

/// Start a code-grant login: listen for the redirect and open the login page in the
/// system browser. Then `oauth_login_wait`.
#[tauri::command]
pub async fn oauth_login_start(
    auth: AuthConfig,
    scope: Scope,
    state: State<'_, AppState>,
) -> Result<LoginStarted, OAuthError> {
    let oauth = resolved(&auth, &scope);
    let authorize = oauth::begin_authorize(&oauth).await?;
    static NEXT_FLOW: AtomicU64 = AtomicU64::new(1);
    let flow_id = NEXT_FLOW.fetch_add(1, Ordering::Relaxed).to_string();
    let started = LoginStarted {
        flow_id: flow_id.clone(),
        url: authorize.url.clone(),
        redirect_uri: authorize.redirect_uri.clone(),
        listens: authorize.listens(),
    };
    let (input, inbox) = mpsc::channel(4);
    let login = Login {
        authorize,
        oauth,
        input,
        inbox: Mutex::new(inbox),
    };
    let mut logins = state.oauth_logins.lock().map_err(|e| e.to_string())?;
    // One login at a time: a new one cancels the previous (its wait ends with an error).
    for (_, old) in logins.drain() {
        let _ = old.input.try_send(None);
    }
    logins.insert(flow_id, Arc::new(login));
    drop(logins);
    // A browser that does not open is not fatal: the card shows the link to copy.
    if let Err(e) = super::app::open_in_browser(&started.url) {
        eprintln!("oauth: cannot open the browser: {e}");
    }
    Ok(started)
}

/// Wait for the redirect (or a pasted code), exchange the code and store the token.
#[tauri::command]
pub async fn oauth_login_wait(
    flow_id: String,
    settings: Option<RequestSettings>,
    state: State<'_, AppState>,
) -> Result<TokenInfo, OAuthError> {
    let login = state
        .oauth_logins
        .lock()
        .map_err(|e| e.to_string())?
        .get(&flow_id)
        .cloned()
        .ok_or_else(|| OAuthError::from("OAuth: this login has ended".to_string()))?;
    let result = async {
        let mut inbox = login.inbox.lock().await;
        let code = tokio::select! {
            code = login.authorize.wait() => code?,
            input = inbox.recv() => match input.flatten() {
                Some(pasted) => login.authorize.pasted(&pasted)?,
                None => return Err(OAuthError::from("OAuth: login cancelled".to_string())),
            },
        };
        let settings = settings_or_default(settings);
        let send = sender(&state, &settings);
        let token = login
            .authorize
            .finish(&login.oauth, &code, &Keychain, send, oauth::now_secs())
            .await?;
        Ok(token.info())
    }
    .await;
    if let Ok(mut logins) = state.oauth_logins.lock() {
        if logins.get(&flow_id).is_some_and(|l| Arc::ptr_eq(l, &login)) {
            logins.remove(&flow_id);
        }
    }
    result
}

/// A code (or the whole redirect URL) pasted by hand; `None` cancels the login.
#[tauri::command]
pub fn oauth_login_input(
    flow_id: String,
    input: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let logins = state.oauth_logins.lock().map_err(|e| e.to_string())?;
    if let Some(login) = logins.get(&flow_id) {
        let _ = login.input.try_send(input);
    }
    Ok(())
}
