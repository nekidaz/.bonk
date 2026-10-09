use crate::state::AppState;
use bonk_core::domain::http::{HttpRequest, HttpResponse, RequestSettings};
use std::future::Future;
use std::time::Duration;
use tauri::Manager;
use tauri::State;
use tokio::sync::oneshot;

const TERMINAL_TIMEOUT: Duration = Duration::from_secs(120);
const TERMINAL_OUTPUT_LIMIT: usize = 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    stdout: String,
    stderr: String,
    status: i32,
    elapsed_ms: u128,
    cwd: String,
}

const TERMINAL_CWD_MARKER: &str = "__BONK_CWD_62E892D1__";

fn terminal_output_text(bytes: &[u8]) -> String {
    if bytes.len() <= TERMINAL_OUTPUT_LIMIT {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let mut text = String::from_utf8_lossy(&bytes[..TERMINAL_OUTPUT_LIMIT]).into_owned();
    text.push_str("\n… output truncated at 1 MiB");
    text
}

/// The panel is a text renderer rather than a full VT emulator. Strip ANSI
/// color/control sequences and OSC shell-integration markers (OSC 7/133) so
/// they never leak into the visible command output as `]133;…` garbage.
fn strip_terminal_controls(input: String) -> String {
    #[derive(Clone, Copy)]
    enum State {
        Text,
        Escape,
        Csi,
        Osc,
        OscEscape,
        String,
        StringEscape,
    }

    let mut state = State::Text;
    let mut clean = String::with_capacity(input.len());
    for ch in input.chars() {
        state = match state {
            State::Text => {
                if ch == '\u{1b}' {
                    State::Escape
                } else if ch == '\u{8}' {
                    clean.pop();
                    State::Text
                } else if ch == '\r' || (ch.is_control() && ch != '\n' && ch != '\t') {
                    State::Text
                } else {
                    clean.push(ch);
                    State::Text
                }
            }
            State::Escape => match ch {
                '[' => State::Csi,
                ']' => State::Osc,
                'P' | 'X' | '^' | '_' => State::String,
                _ => State::Text,
            },
            State::Csi => {
                if ('\u{40}'..='\u{7e}').contains(&ch) {
                    State::Text
                } else {
                    State::Csi
                }
            }
            State::Osc => match ch {
                '\u{7}' => State::Text,
                '\u{1b}' => State::OscEscape,
                _ => State::Osc,
            },
            State::OscEscape => {
                if ch == '\\' {
                    State::Text
                } else {
                    State::Osc
                }
            }
            State::String => {
                if ch == '\u{1b}' {
                    State::StringEscape
                } else {
                    State::String
                }
            }
            State::StringEscape => {
                if ch == '\\' {
                    State::Text
                } else {
                    State::String
                }
            }
        };
    }
    clean
}

fn terminal_default_dir() -> Result<std::path::PathBuf, String> {
    let home = if cfg!(target_os = "windows") {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    };
    if let Some(home) = home {
        let path = std::path::PathBuf::from(home);
        if path.is_absolute() && path.is_dir() {
            return Ok(path);
        }
    }
    std::env::current_dir()
        .map_err(|error| format!("failed to resolve terminal directory: {error}"))
}

#[tauri::command]
pub fn terminal_default_cwd() -> Result<String, String> {
    Ok(terminal_default_dir()?.to_string_lossy().into_owned())
}

fn terminal_cwd_from_output(stdout: &mut String, fallback: &std::path::Path) -> String {
    let mut cwd = fallback.to_string_lossy().into_owned();
    if let Some(marker) = stdout.rfind(TERMINAL_CWD_MARKER) {
        let value_start = marker + TERMINAL_CWD_MARKER.len();
        let value_end = stdout[value_start..]
            .find(['\r', '\n'])
            .map(|offset| value_start + offset)
            .unwrap_or(stdout.len());
        let next = stdout[value_start..value_end].trim();
        if !next.is_empty() {
            cwd = next.to_string();
        }
        let trim_at = stdout[..marker].trim_end_matches(['\r', '\n']).len();
        stdout.truncate(trim_at);
    }
    cwd
}

/// Execute one explicit command in a persistent frontend terminal session.
/// The shell reports its final cwd through a private marker, allowing `cd`,
/// `cd ..`, and compound commands such as `cd src && ls` to carry their
/// directory into the next invocation.
#[tauri::command]
pub async fn terminal_run(cwd: Option<String>, command: String) -> Result<TerminalOutput, String> {
    let cwd_path = match cwd.filter(|value| !value.is_empty()) {
        Some(value) => {
            let path = std::path::PathBuf::from(value);
            if !path.is_absolute() {
                return Err("terminal cwd must be an absolute path".to_string());
            }
            if !path.is_dir() {
                return Err("terminal cwd is not a directory".to_string());
            }
            path
        }
        None => terminal_default_dir()?,
    };
    let command = command.trim();
    if command.is_empty() {
        return Err("command cannot be empty".to_string());
    }
    if command.len() > 32 * 1024 {
        return Err("command is too long".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut child = {
        let wrapped = format!(
            "{command} & set \"__bonk_status=!errorlevel!\" & echo {TERMINAL_CWD_MARKER}!CD! & exit /b !__bonk_status!"
        );
        let mut child = tokio::process::Command::new("cmd.exe");
        child.args(["/d", "/v:on", "/s", "/c", &wrapped]);
        child
    };

    // macOS ships BSD `script`, which gives the child a real PTY. This matters
    // for tools such as eza (commonly aliased as `ls`) and for shell functions
    // that intentionally behave differently when stdin/stdout are not a TTY.
    #[cfg(target_os = "macos")]
    let mut child = {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|path| std::path::Path::new(path).is_absolute())
            .unwrap_or_else(|| "/bin/zsh".to_string());
        let wrapped = format!(
            "__bonk_command=$BONK_TERMINAL_COMMAND\nunset BONK_TERMINAL_COMMAND\neval -- \"$__bonk_command\"\n__bonk_status=$?\nprintf '\\n{TERMINAL_CWD_MARKER}%s\\n' \"$PWD\"\nexit $__bonk_status"
        );
        let mut child = tokio::process::Command::new("/usr/bin/script");
        child.args(["-q", "/dev/null", &shell, "-lic", &wrapped]);
        child
            .env("BONK_TERMINAL_COMMAND", command)
            .env("TERM", "xterm-256color");
        child
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut child = {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|path| std::path::Path::new(path).is_absolute())
            .unwrap_or_else(|| "/bin/sh".to_string());
        let shell_name = std::path::Path::new(&shell)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        let (wrapped, mode) = if shell_name == "zsh" {
            (
                format!(
                    "source \"${{ZDOTDIR:-$HOME}}/.zshrc\" 2>/dev/null\n__bonk_command=$BONK_TERMINAL_COMMAND\nunset BONK_TERMINAL_COMMAND\neval -- \"$__bonk_command\"\n__bonk_status=$?\nprintf '\\n{TERMINAL_CWD_MARKER}%s\\n' \"$PWD\"\nexit $__bonk_status"
                ),
                "-lc",
            )
        } else {
            (
                format!(
                    "{command}\n__bonk_status=$?\nprintf '\\n{TERMINAL_CWD_MARKER}%s\\n' \"$PWD\"\nexit $__bonk_status"
                ),
                if matches!(shell_name.as_str(), "bash" | "fish") { "-lic" } else { "-lc" },
            )
        };
        let mut child = tokio::process::Command::new(shell);
        child.args([mode, &wrapped]);
        if shell_name == "zsh" {
            child.env("BONK_TERMINAL_COMMAND", command);
        }
        child
    };

    child.current_dir(&cwd_path).kill_on_drop(true);
    let started = std::time::Instant::now();
    let output = tokio::time::timeout(TERMINAL_TIMEOUT, child.output())
        .await
        .map_err(|_| "command timed out after 120 seconds".to_string())?
        .map_err(|error| format!("failed to run command: {error}"))?;

    let mut stdout = strip_terminal_controls(terminal_output_text(&output.stdout));
    let cwd = terminal_cwd_from_output(&mut stdout, &cwd_path);
    Ok(TerminalOutput {
        stdout,
        stderr: strip_terminal_controls(terminal_output_text(&output.stderr)),
        status: output.status.code().unwrap_or(-1),
        elapsed_ms: started.elapsed().as_millis(),
        cwd,
    })
}

#[cfg(test)]
mod terminal_tests {
    use super::{strip_terminal_controls, terminal_cwd_from_output, TERMINAL_CWD_MARKER};
    use std::path::Path;

    #[test]
    fn strips_ansi_and_osc_shell_markers() {
        let raw = "^D\u{8}\u{8}\u{1b}]133;D;0\u{1b}\\\u{1b}]7;file:///tmp\u{1b}\\\u{1b}[31mhello\u{1b}[0m";
        assert_eq!(strip_terminal_controls(raw.to_string()), "hello");
    }

    #[test]
    fn extracts_persistent_cwd_from_stdout() {
        let mut output = format!("files\n\n{TERMINAL_CWD_MARKER}/tmp/example\n");
        let cwd = terminal_cwd_from_output(&mut output, Path::new("/fallback"));
        assert_eq!(cwd, "/tmp/example");
        assert_eq!(output, "files");
    }
}

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
    let client = state.http_client(&settings, &req.url)?;
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

use bonk_core::conn::GrpcConn;
use bonk_core::domain::grpc::{GrpcCertInfo, GrpcPrefs, GrpcResult, GrpcTls, ServiceTree};

/// S29: what certificate the server presents and whether it verifies.
#[tauri::command]
pub async fn grpc_tls_inspect(
    endpoint: String,
    tls: Option<GrpcTls>,
) -> Result<GrpcCertInfo, String> {
    bonk_core::application::grpc_tls::inspect(&endpoint, &tls.unwrap_or_default()).await
}
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

/// A spec file the user picked for OpenAPI/Swagger import: its base name plus
/// the full text. Pick + read are atomic (one dialog, one read) so no generic
/// arbitrary-path read primitive is exposed to the frontend.
#[derive(serde::Serialize)]
pub struct ImportedFile {
    name: String,
    text: String,
}

/// Prompt for a Postman Collection or OpenAPI / Swagger file and return its
/// name + contents. `Ok(None)` when the user cancels the dialog.
#[tauri::command]
pub fn openapi_import_pick() -> Result<Option<ImportedFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter(
            "API Collection / Spec",
            &["json", "yaml", "yml", "har", "txt", "sh", "curl"],
        )
        .set_title("Import Collection / OpenAPI")
        .pick_file()
    else {
        return Ok(None);
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(ImportedFile { name, text }))
}

/// Prompt for a save location and write `contents` there. `Ok(None)` when the
/// user cancels the dialog; on success returns the chosen path.
#[tauri::command]
pub fn openapi_export_save(
    default_name: String,
    contents: String,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .set_title(title.as_deref().unwrap_or("Export OpenAPI"))
        .save_file()
    else {
        return Ok(None);
    };
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// App data directory (where state.json lives), for the Data settings section.
#[tauri::command]
pub fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Reveal `path` in the OS file manager.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg("-R").arg(p).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .status()
    } else {
        std::process::Command::new("xdg-open")
            .arg(p.parent().unwrap_or(p))
            .status()
    };
    // explorer exits non-zero even on success, so only a spawn failure is an error.
    status.map(|_| ()).map_err(|e| e.to_string())
}

/// Rename the workspace folder `root` to `name` (same parent); returns the new path.
#[tauri::command]
pub fn workspace_rename_root(root: String, name: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Invalid folder name".into());
    }
    let from = std::path::Path::new(&root);
    let to = from.parent().ok_or("No parent folder")?.join(name);
    if to.exists() {
        return Err("A folder with that name already exists".into());
    }
    std::fs::rename(from, &to).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}

/// Move the workspace folder to the OS trash (never a hard delete).
#[tauri::command]
pub fn workspace_trash(root: String) -> Result<(), String> {
    require_absolute_root(&root)?;
    trash::delete(&root).map_err(|e| e.to_string())
}

/// Reject a workspace root that isn't an absolute path.
///
/// The frontend passes `root` (the folder the user picked via
/// [`workspace_pick_folder`], which always yields an absolute path) back on
/// every workspace call. Requiring it to be absolute stops a malformed or
/// crafted relative root from being resolved against the process CWD and
/// escaping the selected folder.
fn require_absolute_root(root: &str) -> Result<(), String> {
    if std::path::Path::new(root).is_absolute() {
        Ok(())
    } else {
        Err("workspace root must be an absolute path".to_string())
    }
}

#[tauri::command]
pub fn workspace_load(path: String) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    require_absolute_root(&path)?;
    bonk_core::application::workspace::load(&path)
}

#[tauri::command]
pub fn workspace_create_folder(
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::create_folder(&root, &parent, &name)
}

#[tauri::command]
pub fn workspace_save_folder_auth(
    root: String,
    dir: String,
    auth: Option<bonk_core::domain::http::AuthConfig>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::save_folder_auth(&root, &dir, auth)
}

#[tauri::command]
pub fn workspace_save_request(
    root: String,
    dir: String,
    existing: Option<String>,
    node: bonk_core::domain::workspace::RequestNode,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::save_request(&root, &dir, existing.as_deref(), node)
}

#[tauri::command]
pub fn workspace_delete(root: String, path: String) -> Result<(), String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::delete(&root, &path)
}

#[tauri::command]
pub fn workspace_rename(root: String, path: String, name: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::rename(&root, &path, &name)
}

#[tauri::command]
pub fn workspace_duplicate(root: String, path: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::duplicate(&root, &path)
}

#[tauri::command]
pub fn workspace_move(root: String, path: String, dest: String) -> Result<String, String> {
    require_absolute_root(&root)?;
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
        Some(id) if cache.methods.get(&method).is_some_and(|m| m.is_client_streaming()) => {
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

// --- OS keychain for secret env vars ---

fn secret_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("io.github.nekidaz.bonk", key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match secret_entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    secret_entry(&key)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match secret_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
