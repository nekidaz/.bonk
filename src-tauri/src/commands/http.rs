use crate::state::AppState;
use std::collections::BTreeMap;

use bonk_core::domain::{
    http::{HttpRequest, HttpResponse, RequestSettings},
    request_prep,
    workspace::Param,
};
use tauri::State;
use tokio::sync::oneshot;

pub(super) fn register_cancel(
    state: &State<'_, AppState>,
    request_id: &Option<String>,
) -> Result<Option<oneshot::Receiver<()>>, String> {
    let Some(request_id) = request_id.as_deref().filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let (tx, rx) = oneshot::channel();
    let replaced = state
        .cancels
        .lock()
        .map_err(|_| "cancel registry lock poisoned".to_string())?
        .insert(request_id.to_string(), tx);
    if let Some(previous) = replaced {
        let _ = previous.send(());
    }
    Ok(Some(rx))
}

pub(super) fn finish_cancel(state: &State<'_, AppState>, request_id: &Option<String>) {
    if let Some(request_id) = request_id.as_deref().filter(|id| !id.is_empty()) {
        if let Ok(mut cancels) = state.cancels.lock() {
            cancels.remove(request_id);
        }
    }
}

#[tauri::command]
pub fn cancel_request(request_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let cancel = state
        .cancels
        .lock()
        .map_err(|_| "cancel registry lock poisoned".to_string())?
        .remove(&request_id);
    if let Some(cancel) = cancel {
        let _ = cancel.send(());
    }
    Ok(())
}

/// Before the pre-request script: params into the URL, the body for its mode.
/// `{{vars}}` are left for `http_resolve`. Same code bonk-mcp sends with.
#[tauri::command]
pub fn http_prepare(mut req: HttpRequest, params: Option<Vec<Param>>) -> HttpRequest {
    request_prep::materialize(&mut req, params.as_deref());
    req
}

/// After the pre-request script: `{{vars}}` from `scope`, then auth.
#[tauri::command]
pub fn http_resolve(
    mut req: HttpRequest,
    scope: BTreeMap<String, String>,
) -> Result<HttpRequest, String> {
    request_prep::resolve(&mut req, &scope)?;
    Ok(req)
}

#[tauri::command]
pub async fn http_send(
    req: HttpRequest,
    request_id: Option<String>,
    settings: Option<RequestSettings>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<HttpResponse, String> {
    let cancel = register_cancel(&state, &request_id)?;
    let settings = settings.unwrap_or_default().normalized();
    let jar = super::cookies::jar(&app, &state, &settings.cookie_jar)?;
    jar.set_keep_session(settings.cookies_keep_session);
    let client = state.http_client(&settings, &req.url, Some(jar.clone()))?;
    let result = if let Some(cancel) = cancel {
        tokio::select! {
            res = bonk_core::application::http::http_send(client, req, settings, Some(&jar)) => res,
            _ = cancel => Err("request cancelled".to_string()),
        }
    } else {
        bonk_core::application::http::http_send(client, req, settings, Some(&jar)).await
    };
    finish_cancel(&state, &request_id);
    // A jar that can't be written must not hide the response; it's retried on the next save.
    if let Err(e) = jar.save() {
        eprintln!("{e}");
    }
    result
}

/// Run a user script (pre-request or test) in the sandboxed QuickJS engine.
///
/// QuickJS is synchronous CPU work, so it runs on the blocking pool rather than
/// the async executor. `context` is a JSON string; the returned string is the
/// serialized `__out` object the frontend parses into a `ScriptResult`.
#[tauri::command]
pub async fn run_script(phase: String, code: String, context: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        bonk_core::application::scripts::run_script(&phase, &code, &context)
    })
    .await
    .map_err(|e| format!("script task failed: {e}"))?
}
