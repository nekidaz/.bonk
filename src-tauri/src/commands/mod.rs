pub(crate) mod app;
pub(crate) mod cookies;
pub(crate) mod git;
pub(crate) mod grpc;
pub(crate) mod http;
pub(crate) mod mcp;
pub(crate) mod monitor;
pub(crate) mod oauth;
pub(crate) mod runner;
pub(crate) mod secrets;
pub(crate) mod session;
pub(crate) mod settings_file;
pub(crate) mod terminal;
pub(crate) mod themes;
pub(crate) mod workspace;

/// Run blocking work (disk, `git`) on Tauri's blocking pool. A sync `#[tauri::command]`
/// runs on the main thread, so the window freezes until it returns (like doing file I/O
/// in a UI goroutine). Async commands that call this run on the pool instead.
pub(crate) async fn off_main<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}
