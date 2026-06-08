use crate::state::AppState;
use bonk_core::domain::http::{HttpRequest, HttpResponse, RequestSettings};
use std::future::Future;
use std::time::Duration;
use tauri::Manager;
use tauri::State;
use tokio::sync::oneshot;

fn register_cancel(
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

fn finish_cancel(state: &State<'_, AppState>, request_id: &Option<String>) {
    if let Some(request_id) = request_id.as_deref().filter(|id| !id.is_empty()) {
        if let Ok(mut cancels) = state.cancels.lock() {
            cancels.remove(request_id);
        }
    }
}

async fn timeout_result<T, F>(timeout_ms: Option<u64>, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let Some(ms) = timeout_ms.filter(|ms| *ms > 0) else {
        return future.await;
    };
    match tokio::time::timeout(Duration::from_millis(ms), future).await {
        Ok(result) => result,
        Err(_) => Err(format!("request timed out after {ms} ms")),
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

#[tauri::command]
pub async fn http_send(
    req: HttpRequest,
    request_id: Option<String>,
    settings: Option<RequestSettings>,
    state: State<'_, AppState>,
) -> Result<HttpResponse, String> {
    let cancel = register_cancel(&state, &request_id)?;
    let settings = settings.unwrap_or_default().normalized();
    let client = state.http_client(&settings)?;
    let result = if let Some(cancel) = cancel {
        tokio::select! {
            res = bonk_core::application::http::http_send(client, req, settings) => res,
            _ = cancel => Err("request cancelled".to_string()),
        }
    } else {
        bonk_core::application::http::http_send(client, req, settings).await
    };
    finish_cancel(&state, &request_id);
    result
}

use bonk_core::conn::GrpcConn;
use bonk_core::domain::grpc::{GrpcResult, ServiceTree};
use std::collections::HashMap;

#[tauri::command]
pub fn workspace_pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Open Bonk workspace")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn file_pick() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Attach file")
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_load(path: String) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    bonk_core::application::workspace::load(&path)
}

#[tauri::command]
pub fn workspace_create_folder(
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    bonk_core::application::workspace::create_folder(&root, &parent, &name)
}

#[tauri::command]
pub fn workspace_save_request(
    root: String,
    dir: String,
    existing: Option<String>,
    node: bonk_core::domain::workspace::RequestNode,
) -> Result<String, String> {
    bonk_core::application::workspace::save_request(&root, &dir, existing.as_deref(), node)
}

#[tauri::command]
pub fn workspace_delete(root: String, path: String) -> Result<(), String> {
    bonk_core::application::workspace::delete(&root, &path)
}

#[tauri::command]
pub fn workspace_rename(root: String, path: String, name: String) -> Result<String, String> {
    bonk_core::application::workspace::rename(&root, &path, &name)
}

#[tauri::command]
pub fn workspace_duplicate(root: String, path: String) -> Result<String, String> {
    bonk_core::application::workspace::duplicate(&root, &path)
}

#[tauri::command]
pub fn workspace_move(root: String, path: String, dest: String) -> Result<String, String> {
    bonk_core::application::workspace::move_node(&root, &path, &dest)
}

use bonk_core::application::git;

#[tauri::command]
pub fn git_status(root: String) -> Result<git::GitStatus, String> {
    git::status(&root)
}

#[tauri::command]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    git::stage(&root, &paths)
}

#[tauri::command]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    git::unstage(&root, &paths)
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    git::commit(&root, &message)
}

#[tauri::command]
pub fn git_init(root: String) -> Result<(), String> {
    git::init(&root)
}

#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<String>, String> {
    git::branches(&root)
}

#[tauri::command]
pub fn git_checkout(root: String, name: String) -> Result<(), String> {
    git::checkout(&root, &name)
}

#[tauri::command]
pub fn git_create_branch(root: String, name: String) -> Result<(), String> {
    git::create_branch(&root, &name)
}

#[tauri::command]
pub fn git_push(root: String) -> Result<String, String> {
    git::push(&root)
}

#[tauri::command]
pub fn git_pull(root: String) -> Result<String, String> {
    git::pull(&root)
}

#[tauri::command]
pub fn git_diff(root: String, path: String, cached: Option<bool>) -> Result<String, String> {
    if cached.unwrap_or(false) {
        git::diff_staged(&root, &path)
    } else {
        git::diff(&root, &path)
    }
}

#[tauri::command]
pub fn git_log(root: String, limit: u32) -> Result<Vec<git::GitCommit>, String> {
    git::log(&root, limit)
}

#[tauri::command]
pub fn git_status_diffs(root: String) -> Result<Vec<git::FileDiff>, String> {
    git::status_diffs(&root)
}

#[tauri::command]
pub fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    git::discard(&root, &paths)
}

#[tauri::command]
pub fn git_graph(root: String, limit: u32) -> Result<Vec<String>, String> {
    git::graph(&root, limit)
}

fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
pub fn app_state_load(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    bonk_core::application::app_state::load_map(&state_path(&app)?)
}

#[tauri::command]
pub fn app_state_set(
    app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    bonk_core::application::app_state::set_key(&state_path(&app)?, &key, value)
}

#[tauri::command]
pub async fn grpc_connect(
    endpoint: String,
    plaintext: bool,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let id = format!("{endpoint}|{plaintext}");
    let channel = timeout_result(
        timeout_ms,
        bonk_core::application::grpc_native::connect(&endpoint, plaintext),
    )
    .await?;
    state
        .conns
        .lock()
        .map_err(|_| "grpc state lock poisoned".to_string())?
        .insert(
            id.clone(),
            GrpcConn {
                channel: Some(channel),
                cache: None,
            },
        );
    Ok(id)
}

fn conn(state: &State<AppState>, id: &str) -> Result<GrpcConn, String> {
    state
        .conns
        .lock()
        .map_err(|_| "grpc state lock poisoned".to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "unknown connection".into())
}

#[tauri::command]
pub async fn grpc_reflect(
    connection_id: String,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<ServiceTree, String> {
    let conn = conn(&state, &connection_id)?;
    if let Some(cache) = conn.cache {
        return Ok(cache.tree);
    }
    // The connection id is "{endpoint}|{plaintext}" (see grpc_connect). Reflect
    // on fresh connections (not the stored call channel) so a v1 reset can't
    // poison the v1alpha fallback.
    let (endpoint, plaintext) = connection_id
        .rsplit_once('|')
        .ok_or_else(|| "invalid connection id".to_string())?;
    let cache = timeout_result(
        timeout_ms,
        bonk_core::application::grpc_native::reflect(endpoint, plaintext == "true"),
    )
    .await?;
    let tree = cache.tree.clone();
    if let Some(conn) = state
        .conns
        .lock()
        .map_err(|_| "grpc state lock poisoned".to_string())?
        .get_mut(&connection_id)
    {
        conn.cache = Some(cache);
    }
    Ok(tree)
}

#[tauri::command]
pub async fn grpc_load_proto(
    connection_id: String,
    proto_paths: Vec<String>,
    import_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ServiceTree, String> {
    // The channel must already be open (grpc_connect). Compiling is sync CPU
    // work, so run it off the async runtime.
    if proto_paths.is_empty() {
        return Err("no .proto files selected".to_string());
    }
    let cache = tokio::task::spawn_blocking(move || {
        bonk_core::application::grpc_native::compile_protos(&proto_paths, &import_paths)
    })
    .await
    .map_err(|e| format!("proto compile task failed: {e}"))??;
    let tree = cache.tree.clone();
    if let Some(conn) = state
        .conns
        .lock()
        .map_err(|_| "grpc state lock poisoned".to_string())?
        .get_mut(&connection_id)
    {
        conn.cache = Some(cache);
    } else {
        return Err("unknown connection".to_string());
    }
    Ok(tree)
}

#[tauri::command]
pub fn proto_pick() -> Option<Vec<String>> {
    rfd::FileDialog::new()
        .add_filter("Protocol Buffers", &["proto"])
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
}

#[tauri::command]
pub async fn grpc_template(
    connection_id: String,
    method: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut guard = state
        .conns
        .lock()
        .map_err(|_| "grpc state lock poisoned".to_string())?;
    let conn = guard
        .get_mut(&connection_id)
        .ok_or_else(|| "unknown connection".to_string())?;
    let cache = conn
        .cache
        .as_mut()
        .ok_or_else(|| "reflection cache is not loaded".to_string())?;
    bonk_core::application::grpc_native::template(cache, &method)
}

#[tauri::command]
pub async fn grpc_call(
    connection_id: String,
    method: String,
    json_body: String,
    metadata: HashMap<String, String>,
    request_id: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<GrpcResult, String> {
    let conn = conn(&state, &connection_id)?;
    let channel = conn
        .channel
        .ok_or_else(|| "connection has no channel".to_string())?;
    let cache = conn
        .cache
        .ok_or_else(|| "reflection cache is not loaded".to_string())?;
    let cancel = register_cancel(&state, &request_id)?;
    let result = if let Some(cancel) = cancel {
        tokio::select! {
            res = timeout_result(timeout_ms, bonk_core::application::grpc_native::call(channel, cache, &method, &json_body, &metadata)) => res,
            _ = cancel => Err("request cancelled".to_string()),
        }
    } else {
        timeout_result(
            timeout_ms,
            bonk_core::application::grpc_native::call(
                channel, cache, &method, &json_body, &metadata,
            ),
        )
        .await
    };
    finish_cancel(&state, &request_id);
    result
}
