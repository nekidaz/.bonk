use super::http::{finish_cancel, register_cancel};
use crate::state::AppState;
use std::time::Duration;
use tauri::State;

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
pub async fn terminal_run(
    cwd: Option<String>,
    command: String,
    run_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<TerminalOutput, String> {
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
    // ⌃C: `cancel_request(run_id)` fires the receiver; dropping the future kills the
    // child (kill_on_drop). ponytail: on macOS that is the `script` PTY wrapper, whose
    // shell gets SIGHUP when the PTY closes; process-group kill if grandchildren linger.
    let cancel = register_cancel(&state, &run_id)?;
    let run = tokio::time::timeout(TERMINAL_TIMEOUT, child.output());
    let output = if let Some(cancel) = cancel {
        tokio::select! {
            res = run => Some(res),
            _ = cancel => None,
        }
    } else {
        Some(run.await)
    };
    finish_cancel(&state, &run_id);
    let output = output
        .ok_or_else(|| "interrupted".to_string())?
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
