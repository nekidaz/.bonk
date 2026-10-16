use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

/// Opens the user's own terminal app in `cwd`. With `command`, runs it there first and leaves
/// the shell open; `env` (only `BONK_*` names) carries secrets so they stay out of the command
/// text and the shell history.
#[tauri::command]
pub fn terminal_open(
    cwd: Option<String>,
    command: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let env = env.unwrap_or_default();
    if let Some(bad) = env.keys().find(|name| !valid_env_name(name)) {
        return Err(format!("invalid terminal variable name: {bad}"));
    }
    let dir = match cwd.filter(|value| !value.is_empty()) {
        Some(value) => {
            let path = PathBuf::from(value);
            if !path.is_absolute() || !path.is_dir() {
                return Err("terminal folder does not exist".to_string());
            }
            path
        }
        None => terminal_default_dir()?,
    };
    let command = command
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty());
    launch(&dir, command.as_deref(), &env)
}

#[cfg(unix)]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The script the terminal runs: deletes itself (it may hold secrets), goes to `dir`, runs
/// `command` with the secrets exported, drops them and hands over to the user's shell.
#[cfg(unix)]
fn terminal_script(dir: &Path, command: Option<&str>, env: &HashMap<String, String>) -> String {
    let mut s = String::from("#!/bin/sh\nrm -f -- \"$0\"\nclear 2>/dev/null\n");
    s += &format!("cd -- {} || exit 1\n", sh_quote(&dir.to_string_lossy()));
    if let Some(command) = command {
        let mut names: Vec<&str> = env.keys().map(String::as_str).collect();
        names.sort_unstable();
        for name in &names {
            s += &format!("export {name}={}\n", sh_quote(&env[*name]));
        }
        s += &format!(
            "printf '%s\\n' {}\n{command}\n",
            sh_quote(&format!("$ {command}"))
        );
        if !names.is_empty() {
            s += &format!("unset {}\n", names.join(" "));
        }
    }
    s += "exec \"${SHELL:-/bin/sh}\"\n";
    s
}

/// Writes the script owner-only into the temp dir; the script removes itself when it starts.
#[cfg(unix)]
fn write_script(body: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let path = std::env::temp_dir().join(format!(
        "bonk-terminal-{}-{nanos}.command",
        std::process::id()
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o700)
        .open(&path)
        .map_err(|error| format!("failed to prepare terminal: {error}"))?;
    file.write_all(body.as_bytes())
        .map_err(|error| format!("failed to prepare terminal: {error}"))?;
    Ok(path)
}

/// `open` hands a `.command` file to whatever app the user set for shell scripts
/// (Terminal, iTerm, …), so it is their terminal, not one of ours.
#[cfg(target_os = "macos")]
fn launch(dir: &Path, command: Option<&str>, env: &HashMap<String, String>) -> Result<(), String> {
    let script = write_script(&terminal_script(dir, command, env))?;
    match std::process::Command::new("/usr/bin/open")
        .arg(&script)
        .status()
    {
        Ok(status) if status.success() => Ok(()),
        _ => {
            let _ = std::fs::remove_file(&script);
            Err("failed to open the terminal app".to_string())
        }
    }
}

/// `$TERMINAL`, else the first common emulator that starts.
#[cfg(all(unix, not(target_os = "macos")))]
fn launch(dir: &Path, command: Option<&str>, env: &HashMap<String, String>) -> Result<(), String> {
    let script = write_script(&terminal_script(dir, command, env))?;
    let custom = std::env::var("TERMINAL").ok().filter(|t| !t.is_empty());
    let candidates = custom.iter().map(|t| (t.as_str(), "-e")).chain([
        ("x-terminal-emulator", "-e"),
        ("gnome-terminal", "--"),
        ("konsole", "-e"),
        ("xfce4-terminal", "-x"),
        ("alacritty", "-e"),
        ("kitty", ""),
        ("xterm", "-e"),
    ]);
    for (bin, flag) in candidates {
        let mut cmd = std::process::Command::new(bin);
        if !flag.is_empty() {
            cmd.arg(flag);
        }
        if let Ok(mut child) = cmd.arg(&script).current_dir(dir).spawn() {
            // Reap it so a closed terminal doesn't linger as a zombie.
            std::thread::spawn(move || child.wait());
            return Ok(());
        }
    }
    let _ = std::fs::remove_file(&script);
    Err("no terminal app found; set $TERMINAL".to_string())
}

/// `start` opens the user's default console host (Windows Terminal or the classic console).
#[cfg(windows)]
fn launch(dir: &Path, command: Option<&str>, env: &HashMap<String, String>) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/c", "start", "", "cmd"]);
    // ponytail: the hand-off command is POSIX-quoted curl, which cmd.exe mangles; emit
    // PowerShell/cmd quoting when Windows users need «Открыть в терминале».
    if let Some(command) = command {
        cmd.args(["/K", command]);
    }
    cmd.current_dir(dir)
        .envs(env)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("failed to open the terminal: {error}"))
        .map(|_| ())
}

#[cfg(test)]
mod terminal_tests {
    use super::valid_env_name;

    #[test]
    fn only_bonk_env_names_pass() {
        assert!(valid_env_name("BONK_TOKEN"));
        assert!(!valid_env_name("PATH"));
        assert!(!valid_env_name("BONK_"));
        assert!(!valid_env_name("BONK_x"));
    }

    #[cfg(unix)]
    #[test]
    fn script_quotes_dir_and_secrets_and_drops_them() {
        let env = [("BONK_TOKEN".to_string(), "a'b".to_string())].into();
        let s = super::terminal_script(
            std::path::Path::new("/tmp/it's"),
            Some("curl -H \"Authorization: Bearer $BONK_TOKEN\" x"),
            &env,
        );
        assert!(s.starts_with("#!/bin/sh\nrm -f -- \"$0\"\n"));
        assert!(s.contains("cd -- '/tmp/it'\\''s' || exit 1\n"));
        assert!(s.contains("export BONK_TOKEN='a'\\''b'\n"));
        assert!(s.contains("unset BONK_TOKEN\nexec \"${SHELL:-/bin/sh}\"\n"));
    }

    #[cfg(unix)]
    #[test]
    fn script_without_command_just_opens_the_shell() {
        let s = super::terminal_script(std::path::Path::new("/w"), None, &Default::default());
        assert!(!s.contains("export"));
        assert!(s.ends_with("cd -- '/w' || exit 1\nexec \"${SHELL:-/bin/sh}\"\n"));
    }
}
