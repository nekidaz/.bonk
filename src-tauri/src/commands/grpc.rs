use super::http::{finish_cancel, register_cancel};
use crate::state::AppState;
use bonk_core::conn::GrpcConn;
use bonk_core::domain::grpc::{GrpcCertInfo, GrpcPrefs, GrpcResult, GrpcTls, ServiceTree};
use std::collections::HashMap;
use std::future::Future;
use std::time::Duration;
use tauri::State;

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

/// S29: what certificate the server presents and whether it verifies.
#[tauri::command]
pub async fn grpc_tls_inspect(
    endpoint: String,
    tls: Option<GrpcTls>,
) -> Result<GrpcCertInfo, String> {
    bonk_core::application::grpc_tls::inspect(&endpoint, &tls.unwrap_or_default()).await
}

/// (subject CN, expiry unix seconds) of a CA/cert file, for the Settings list.
#[tauri::command]
pub fn cert_file_info(path: String) -> Result<(String, i64), String> {
    bonk_core::application::grpc_tls::cert_file_info(&path)
}

#[tauri::command]
pub async fn grpc_connect(
    endpoint: String,
    plaintext: bool,
    tls: Option<GrpcTls>,
    prefs: Option<GrpcPrefs>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let tls = tls.unwrap_or_default();
    let prefs = prefs.unwrap_or_default();
    // Distinct TLS options / limits get distinct connections.
    let id = format!(
        "{endpoint}|{plaintext}|{}|{}",
        serde_json::to_string(&tls).map_err(|e| e.to_string())?,
        serde_json::to_string(&prefs).map_err(|e| e.to_string())?
    );
    let channel = timeout_result(
        timeout_ms,
        bonk_core::application::grpc_native::connect_with(&endpoint, plaintext, &tls, &prefs),
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
                endpoint,
                plaintext,
                tls,
                prefs,
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
    // Reflect on fresh connections (not the stored call channel) so a v1 reset
    // can't poison the v1alpha fallback.
    let cache = timeout_result(
        timeout_ms,
        bonk_core::application::grpc_native::reflect_with(
            &conn.endpoint,
            conn.plaintext,
            &conn.tls,
            &conn.prefs,
        ),
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
    // Validate the connection exists *before* the heavy compile so we fail fast
    // (and don't burn a blocking-pool thread compiling for a dead connection).
    conn(&state, &connection_id)?;
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
pub async fn grpc_proto_inspect(
    paths: Vec<String>,
    import_paths: Vec<String>,
) -> Result<bonk_core::application::proto_inspect::ProtoInspection, String> {
    tokio::task::spawn_blocking(move || {
        bonk_core::application::proto_inspect::inspect_protos(&paths, &import_paths)
    })
    .await
    .map_err(|e| format!("proto inspect task failed: {e}"))
}

#[tauri::command]
pub fn proto_read(path: String) -> Result<String, String> {
    bonk_core::application::proto_inspect::proto_read(&path)
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

/// Folder of .proto files; `grpc_proto_inspect` expands it and makes it an import root.
#[tauri::command]
pub fn proto_pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose proto folder")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn grpc_template(
    connection_id: String,
    method: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // template() builds fresh sample data from the descriptor cache and doesn't
    // mutate shared state, so clone just the cache under the lock and release it
    // before the (possibly slow) call — otherwise we'd hold the std Mutex across
    // it and starve other users of state.conns.
    let mut cache = {
        let guard = state
            .conns
            .lock()
            .map_err(|_| "grpc state lock poisoned".to_string())?;
        let conn = guard
            .get(&connection_id)
            .ok_or_else(|| "unknown connection".to_string())?;
        conn.cache
            .clone()
            .ok_or_else(|| "reflection cache is not loaded".to_string())?
    };
    bonk_core::application::grpc_native::template(&mut cache, &method)
}

/// Streaming gRPC call (S20): server, client or bidi. Messages reach the webview through `on_message` as they
/// arrive; the returned result summarises the whole stream. Always uses the native tonic client.
#[tauri::command]
pub async fn grpc_stream(
    connection_id: String,
    method: String,
    json_body: String,
    metadata: HashMap<String, String>,
    request_id: Option<String>,
    on_message: tauri::ipc::Channel<bonk_core::application::grpc_native::GrpcStreamMessage>,
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
    // Client/bidi: keep the request side open for `grpc_stream_send` until `grpc_stream_end`.
    let stream_id = request_id.clone().filter(|id| !id.is_empty());
    let more = match &stream_id {
        Some(id)
            if cache
                .methods
                .get(&method)
                .is_some_and(|m| m.is_client_streaming()) =>
        {
            let (sender, rx) = bonk_core::application::grpc_native::stream_sender(&cache, &method)?;
            state
                .grpc_streams
                .lock()
                .map_err(|_| "stream registry lock poisoned".to_string())?
                .insert(id.clone(), sender);
            Some(rx)
        }
        _ => None,
    };
    let call = bonk_core::application::grpc_native::call_stream(
        channel,
        cache,
        &method,
        &json_body,
        &metadata,
        &conn.prefs,
        more,
        |message| {
            let _ = on_message.send(message);
        },
    );
    let result = if let Some(cancel) = cancel {
        tokio::select! {
            res = call => res,
            _ = cancel => Err("request cancelled".to_string()),
        }
    } else {
        call.await
    };
    finish_cancel(&state, &request_id);
    if let (Some(id), Ok(mut streams)) = (stream_id, state.grpc_streams.lock()) {
        streams.remove(&id);
    }
    result
}

/// Sends more messages into an open client/bidi stream; returns how many went out.
#[tauri::command]
pub fn grpc_stream_send(
    request_id: String,
    json_body: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state
        .grpc_streams
        .lock()
        .map_err(|_| "stream registry lock poisoned".to_string())?
        .get(&request_id)
        .ok_or_else(|| "the stream is not open for sending".to_string())?
        .send(&json_body)
}

/// Half-closes an open client/bidi stream: the server sees end-of-stream, replies keep coming.
#[tauri::command]
pub fn grpc_stream_end(request_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .grpc_streams
        .lock()
        .map_err(|_| "stream registry lock poisoned".to_string())?
        .remove(&request_id);
    Ok(())
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
    // Prefer grpcurl (fresh connection per call); the long-lived tonic channel
    // is only the fallback when grpcurl isn't installed.
    let call = async {
        match bonk_core::application::grpcurl::find_grpcurl() {
            Some(bin) => {
                bonk_core::application::grpcurl::call(
                    &bin,
                    &conn.endpoint,
                    conn.plaintext,
                    &conn.tls,
                    cache,
                    &method,
                    &json_body,
                    &metadata,
                    &conn.prefs,
                )
                .await
            }
            None => {
                bonk_core::application::grpc_native::call_with(
                    channel,
                    cache,
                    &method,
                    &json_body,
                    &metadata,
                    &conn.prefs,
                )
                .await
            }
        }
    };
    let result = if let Some(cancel) = cancel {
        tokio::select! {
            res = timeout_result(timeout_ms, call) => res,
            _ = cancel => Err("request cancelled".to_string()),
        }
    } else {
        timeout_result(timeout_ms, call).await
    };
    finish_cancel(&state, &request_id);
    result
}
