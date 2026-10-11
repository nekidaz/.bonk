use super::http::{finish_cancel, register_cancel};
use crate::state::AppState;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

const TERMINAL_OUTPUT_LIMIT: usize = 1024 * 1024;

/// How a command ended; its output was already streamed line by line (`TerminalLine`).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    status: i32,
    elapsed_ms: u128,
    cwd: String,
}

/// One output line, sent while the command runs (CT5).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLine {
    stderr: bool,
    text: String,
}

const TERMINAL_CWD_MARKER: &str = "__BONK_CWD_62E892D1__";

/// Holds back blank stdout lines until something visible follows, so the blank
/// line printed before the cwd marker never reaches the panel, and picks the cwd
/// out of the marker line.
#[derive(Default)]
struct StdoutFilter {
    blank: usize,
    cwd: Option<String>,
}

impl StdoutFilter {
    fn push(&mut self, line: String) -> Vec<String> {
        if let Some(at) = line.find(TERMINAL_CWD_MARKER) {
            let cwd = line[at + TERMINAL_CWD_MARKER.len()..].trim();
            if !cwd.is_empty() {
                self.cwd = Some(cwd.to_string());
            }
            return Vec::new();
        }
        if line.trim().is_empty() {
            self.blank += 1;
            return Vec::new();
        }
        let mut out = vec![String::new(); std::mem::take(&mut self.blank)];
        out.push(line);
        out
    }
}

/// Only `BONK_*` names: the request → terminal hand-off passes secrets this way (CT6),
/// it must not be able to override PATH and friends.
fn valid_env_name(name: &str) -> bool {
    name.len() > 5
        && name.starts_with("BONK_")
        && name
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

/// Reads `reader` line by line, strips terminal controls and sends each line until
/// the shared 1 MiB budget runs out.
async fn pump<R: AsyncRead + Unpin>(
    reader: R,
    stderr: bool,
    on_line: &Channel<TerminalLine>,
    budget: &AtomicUsize,
    mut filter: Option<&mut StdoutFilter>,
) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = strip_terminal_controls(String::from_utf8_lossy(&buf).into_owned());
        let line = line.trim_end_matches('\n').to_string();
        let lines = match filter.as_deref_mut() {
            Some(f) => f.push(line),
            None => vec![line],
        };
        for text in lines {
            let used = budget.fetch_add(text.len() + 1, Ordering::Relaxed);
            if used >= TERMINAL_OUTPUT_LIMIT {
                continue;
            }
            let text = if used + text.len() + 1 >= TERMINAL_OUTPUT_LIMIT {
                "… output truncated at 1 MiB".to_string()
            } else {
                text
            };
            let _ = on_line.send(TerminalLine { stderr, text });
        }
    }
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

/// Execute one explicit command in a persistent frontend terminal session.
/// The shell reports its final cwd through a private marker, allowing `cd`,
/// `cd ..`, and compound commands such as `cd src && ls` to carry their
/// directory into the next invocation. Output streams through `on_line`; there is
/// no timeout, a long command runs until it ends or ⌃C / ■ Остановить cancels it.
#[tauri::command]
pub async fn terminal_run(
    cwd: Option<String>,
    command: String,
    run_id: Option<String>,
    env: Option<HashMap<String, String>>,
    on_line: Channel<TerminalLine>,
    state: State<'_, AppState>,
) -> Result<TerminalOutput, String> {
    let env = env.unwrap_or_default();
    if let Some(bad) = env.keys().find(|name| !valid_env_name(name)) {
        return Err(format!("invalid terminal variable name: {bad}"));
    }
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

    child
        .current_dir(&cwd_path)
        .envs(&env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let started = std::time::Instant::now();
    let mut child = child
        .spawn()
        .map_err(|error| format!("failed to run command: {error}"))?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err("failed to capture command output".to_string());
    };
    // ⌃C: `cancel_request(run_id)` fires the receiver; dropping the future kills the
    // child (kill_on_drop). ponytail: on macOS that is the `script` PTY wrapper, whose
    // shell gets SIGHUP when the PTY closes; process-group kill if grandchildren linger.
    let cancel = register_cancel(&state, &run_id)?;
    let mut filter = StdoutFilter::default();
    let budget = AtomicUsize::new(0);
    let run = async {
        tokio::join!(
            pump(stdout, false, &on_line, &budget, Some(&mut filter)),
            pump(stderr, true, &on_line, &budget, None),
        );
        child.wait().await
    };
    let status = if let Some(cancel) = cancel {
        tokio::select! {
            res = run => Some(res),
            _ = cancel => None,
        }
    } else {
        Some(run.await)
    };
    finish_cancel(&state, &run_id);
    let status = status
        .ok_or_else(|| "interrupted".to_string())?
        .map_err(|error| format!("failed to run command: {error}"))?;

    Ok(TerminalOutput {
        status: status.code().unwrap_or(-1),
        elapsed_ms: started.elapsed().as_millis(),
        cwd: filter
            .cwd
            .unwrap_or_else(|| cwd_path.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
mod terminal_tests {
    use super::{strip_terminal_controls, valid_env_name, StdoutFilter, TERMINAL_CWD_MARKER};

    #[test]
    fn strips_ansi_and_osc_shell_markers() {
        let raw = "^D\u{8}\u{8}\u{1b}]133;D;0\u{1b}\\\u{1b}]7;file:///tmp\u{1b}\\\u{1b}[31mhello\u{1b}[0m";
        assert_eq!(strip_terminal_controls(raw.to_string()), "hello");
    }

    #[test]
    fn stdout_filter_hides_marker_and_trailing_blank_lines() {
        let mut f = StdoutFilter::default();
        let mut shown = Vec::new();
        for line in [
            "files",
            "",
            "more",
            "",
            format!("{TERMINAL_CWD_MARKER}/tmp/example").as_str(),
        ] {
            shown.extend(f.push(line.to_string()));
        }
        assert_eq!(shown, ["files", "", "more"]);
        assert_eq!(f.cwd.as_deref(), Some("/tmp/example"));
    }

    #[test]
    fn only_bonk_env_names_pass() {
        assert!(valid_env_name("BONK_TOKEN"));
        assert!(!valid_env_name("PATH"));
        assert!(!valid_env_name("BONK_"));
        assert!(!valid_env_name("BONK_x"));
    }
}
