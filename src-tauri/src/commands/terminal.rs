//! The Terminal tab: the user's own login shell in a real PTY (like VS Code's terminal).
//! xterm.js in the panel draws it; bytes go back and forth through these commands.
use crate::state::AppState;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::ipc::Channel;
use tauri::State;

/// One running shell: the PTY's master side, its input, and the shell process.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    /// Feeds the session's writer thread. A write to a shell that isn't reading stdin
    /// blocks once the PTY buffer fills, so it never happens under the `ptys` lock.
    input: mpsc::Sender<Vec<u8>>,
    child: Box<dyn Child + Send + Sync>,
}

/// What the shell sends to the panel.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PtyEvent {
    Data {
        text: String,
    },
    /// The shell ended (`exit`, or it crashed).
    Exit,
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

fn terminal_default_dir() -> Result<PathBuf, String> {
    let home = if cfg!(target_os = "windows") {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    };
    if let Some(home) = home {
        let path = PathBuf::from(home);
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

/// Takes the longest valid UTF-8 text out of `buf`, leaving a character cut by the read
/// boundary for the next read (a Go `utf8.FullRune` loop, in short).
fn take_utf8(buf: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => return String::from_utf8_lossy(&std::mem::take(buf)).into_owned(),
    };
    let rest = buf.split_off(valid);
    String::from_utf8_lossy(&std::mem::replace(buf, rest)).into_owned()
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Starts the user's login shell (`$SHELL`; `cmd` on Windows) in `cwd` and streams its
/// output to `on_event` until it exits. Returns the shell's name (`zsh`) for the session list.
#[tauri::command]
pub fn pty_open(
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let dir = cwd
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .map_or_else(terminal_default_dir, Ok)?;
    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|error| format!("failed to open a terminal: {error}"))?;
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let shell = std::path::Path::new(&cmd.get_shell())
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| format!("failed to start the shell: {error}"))?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to open a terminal: {error}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to open a terminal: {error}"))?;
    // Like a goroutine ranging over a chan []byte: ends when the session (the sender) is
    // dropped, or when the shell is gone and writes fail.
    let (input, queue) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        for data in queue {
            if writer
                .write_all(&data)
                .and_then(|()| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });
    state
        .ptys
        .lock()
        .map_err(|_| "terminal state lock poisoned".to_string())?
        .insert(
            id,
            PtySession {
                master: pair.master,
                input,
                child,
            },
        );
    // A blocking read loop on its own thread, like a goroutine around io.Copy.
    std::thread::spawn(move || {
        let mut chunk = [0u8; 16 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&chunk[..n]);
                    let text = take_utf8(&mut pending);
                    if !text.is_empty() && on_event.send(PtyEvent::Data { text }).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_event.send(PtyEvent::Exit);
    });
    Ok(shell)
}

/// Keystrokes and pastes from xterm.js. Only queues them, so it never blocks; it stays a
/// sync command (main thread) so keystrokes reach the queue in the order they were typed.
#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let ptys = state
        .ptys
        .lock()
        .map_err(|_| "terminal state lock poisoned".to_string())?;
    let session = ptys.get(&id).ok_or("the terminal is closed")?;
    session
        .input
        .send(data.into_bytes())
        .map_err(|_| "the terminal is closed".to_string())
}

#[tauri::command]
pub fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ptys = state
        .ptys
        .lock()
        .map_err(|_| "terminal state lock poisoned".to_string())?;
    match ptys.get(&id) {
        Some(session) => session
            .master
            .resize(pty_size(cols, rows))
            .map_err(|error| format!("failed to resize the terminal: {error}")),
        None => Ok(()),
    }
}

/// Kills the shell (if still running) and forgets the session.
#[tauri::command]
pub fn pty_close(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = state
        .ptys
        .lock()
        .map_err(|_| "terminal state lock poisoned".to_string())?
        .remove(&id);
    if let Some(mut session) = session {
        // kill() waits up to 200 ms for SIGHUP before SIGKILL, and wait() reaps the
        // process so no zombie is left: both off the main thread.
        std::thread::spawn(move || {
            let _ = session.child.kill();
            let _ = session.child.wait();
        });
    }
    Ok(())
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// CT6: writes `export BONK_…='…'` lines to an owner-only temp file and returns its path.
/// The hand-off pastes `(. file; rm -f file; curl …)`, so the secret values never pass
/// through the shell's input or history, and live only in that subshell.
/// Limit: POSIX shells only; Windows `cmd` can't source it.
#[tauri::command]
pub fn pty_stage_env(env: HashMap<String, String>) -> Result<String, String> {
    if let Some(bad) = env.keys().find(|name| !valid_env_name(name)) {
        return Err(format!("invalid terminal variable name: {bad}"));
    }
    let mut body = String::new();
    for (name, value) in &env {
        body += &format!("export {name}={}\n", sh_quote(value));
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let path = std::env::temp_dir().join(format!("bonk-env-{}-{nanos}", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options
        .open(&path)
        .and_then(|mut file| file.write_all(body.as_bytes()))
        .map_err(|error| format!("failed to pass the variables: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod terminal_tests {
    use super::{sh_quote, take_utf8, valid_env_name};

    #[test]
    fn only_bonk_env_names_pass() {
        assert!(valid_env_name("BONK_TOKEN"));
        assert!(!valid_env_name("PATH"));
        assert!(!valid_env_name("BONK_"));
        assert!(!valid_env_name("BONK_x"));
    }

    #[test]
    fn utf8_cut_by_a_read_waits_for_the_rest() {
        let bytes = "ок".as_bytes();
        let mut buf = bytes[..3].to_vec();
        assert_eq!(take_utf8(&mut buf), "о");
        assert_eq!(buf, bytes[2..3]);
        buf.extend_from_slice(&bytes[3..]);
        assert_eq!(take_utf8(&mut buf), "к");
        assert!(buf.is_empty());
    }

    #[test]
    fn broken_bytes_dont_stall_the_stream() {
        let mut buf = vec![b'a', 0xff, b'b'];
        assert_eq!(take_utf8(&mut buf), "a\u{fffd}b");
        assert!(buf.is_empty());
    }

    #[test]
    fn quotes_single_quotes() {
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
    }
}
