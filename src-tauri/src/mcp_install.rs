use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use toml_edit::{value, Array, DocumentMut, Item, Table};

const SERVER_NAME: &str = "bonk";
const CLIENT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientStatus {
    id: String,
    name: String,
    available: bool,
    installed: bool,
    needs_update: bool,
    workspace: Option<String>,
    detail: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpIntegrationStatus {
    binary_available: bool,
    installed_binary: String,
    clients: Vec<McpClientStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOperationResult {
    status: McpIntegrationStatus,
    messages: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInstallOptions {
    workspace: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    no_network: bool,
    #[serde(default)]
    target_hosts: Vec<String>,
}

#[derive(Debug, Clone)]
struct ClientPaths {
    claude_desktop_config: PathBuf,
    codex_config: PathBuf,
    claude_code: Option<PathBuf>,
    claude_desktop_available: bool,
    openai_available: bool,
}

impl ClientPaths {
    fn discover(home: &Path) -> Self {
        let claude_desktop_config = claude_desktop_config_path(home);
        let codex_config = home.join(".codex").join("config.toml");
        let claude_code = find_executable("claude", home);

        Self {
            claude_desktop_available: claude_desktop_config.exists()
                || claude_desktop_app_exists(home),
            openai_available: codex_config.exists()
                || find_executable("codex", home).is_some()
                || chatgpt_app_exists(home),
            claude_desktop_config,
            codex_config,
            claude_code,
        }
    }
}

#[tauri::command]
pub async fn mcp_integration_status(app: AppHandle) -> Result<McpIntegrationStatus, String> {
    collect_status(&app).await
}

#[tauri::command]
pub async fn mcp_install(
    app: AppHandle,
    options: McpInstallOptions,
) -> Result<McpOperationResult, String> {
    let workspace = canonical_workspace(&options.workspace)?;
    validate_target_hosts(&options.target_hosts)?;
    let binary = install_mcp_binary(&app)?;
    let args = mcp_args(&workspace, &options);
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("failed to find the home directory: {error}"))?;
    let clients = ClientPaths::discover(&home);
    let mut messages = Vec::new();
    let mut attempted = 0usize;
    let mut succeeded = 0usize;

    if clients.claude_desktop_available {
        attempted += 1;
        match install_claude_desktop(&clients.claude_desktop_config, &binary, &args) {
            Ok(()) => {
                succeeded += 1;
                messages.push("Claude Desktop configured".into());
            }
            Err(error) => messages.push(format!("Claude Desktop: {error}")),
        }
    }

    if clients.openai_available {
        attempted += 1;
        match install_codex(&clients.codex_config, &binary, &args) {
            Ok(()) => {
                succeeded += 1;
                messages.push("ChatGPT / Codex configured".into());
            }
            Err(error) => messages.push(format!("ChatGPT / Codex: {error}")),
        }
    }

    if let Some(claude) = &clients.claude_code {
        attempted += 1;
        match install_claude_code(claude, &binary, &args).await {
            Ok(()) => {
                succeeded += 1;
                messages.push("Claude Code configured".into());
            }
            Err(error) => messages.push(format!("Claude Code: {error}")),
        }
    }

    if attempted == 0 {
        return Err(
            "No supported local AI client was detected. Install Claude Desktop, ChatGPT/Codex, or Claude Code first."
                .into(),
        );
    }
    if succeeded == 0 {
        return Err(messages.join(" · "));
    }

    Ok(McpOperationResult {
        status: collect_status(&app).await?,
        messages,
    })
}

#[tauri::command]
pub async fn mcp_uninstall(app: AppHandle) -> Result<McpOperationResult, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("failed to find the home directory: {error}"))?;
    let clients = ClientPaths::discover(&home);
    let mut messages = Vec::new();

    if clients.claude_desktop_config.exists() {
        match uninstall_claude_desktop(&clients.claude_desktop_config) {
            Ok(true) => messages.push("Claude Desktop integration removed".into()),
            Ok(false) => {}
            Err(error) => messages.push(format!("Claude Desktop: {error}")),
        }
    }
    if clients.codex_config.exists() {
        match uninstall_codex(&clients.codex_config) {
            Ok(true) => messages.push("ChatGPT / Codex integration removed".into()),
            Ok(false) => {}
            Err(error) => messages.push(format!("ChatGPT / Codex: {error}")),
        }
    }
    if let Some(claude) = &clients.claude_code {
        match remove_claude_code(claude).await {
            Ok(true) => messages.push("Claude Code integration removed".into()),
            Ok(false) => {}
            Err(error) => messages.push(format!("Claude Code: {error}")),
        }
    }
    if messages.is_empty() {
        messages.push("No installed Bonk MCP entries were found".into());
    }

    Ok(McpOperationResult {
        status: collect_status(&app).await?,
        messages,
    })
}

async fn collect_status(app: &AppHandle) -> Result<McpIntegrationStatus, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("failed to find the home directory: {error}"))?;
    let paths = ClientPaths::discover(&home);
    let installed_binary = installed_mcp_path(app)?;
    let binary_available = installed_binary.is_file() || bundled_mcp_path().is_some();

    let mut clients = vec![
        claude_desktop_status(&paths, &installed_binary),
        codex_status(&paths, &installed_binary),
    ];
    clients.push(claude_code_status(paths.claude_code.as_deref()).await);

    Ok(McpIntegrationStatus {
        binary_available,
        installed_binary: installed_binary.to_string_lossy().into_owned(),
        clients,
    })
}

fn canonical_workspace(workspace: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(workspace);
    if !path.is_absolute() {
        return Err("Choose an absolute Bonk workspace path first".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("failed to open workspace: {error}"))?;
    if !canonical.is_dir() {
        return Err("The selected workspace is not a directory".into());
    }
    Ok(canonical)
}

fn validate_target_hosts(hosts: &[String]) -> Result<(), String> {
    for host in hosts {
        if host.is_empty()
            || host.contains('/')
            || host.contains("//")
            || host.chars().any(char::is_whitespace)
        {
            return Err(format!("Invalid target host: {host}"));
        }
    }
    Ok(())
}

fn mcp_args(workspace: &Path, options: &McpInstallOptions) -> Vec<String> {
    let mut args = vec![
        "--workspace".into(),
        workspace.to_string_lossy().into_owned(),
    ];
    if options.read_only {
        args.push("--read-only".into());
    }
    if options.no_network {
        args.push("--no-network".into());
    }
    for host in &options.target_hosts {
        args.push("--target-host".into());
        args.push(host.clone());
    }
    args
}

fn installed_mcp_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut name = format!("bonk-mcp-{}", env!("CARGO_PKG_VERSION"));
    if cfg!(target_os = "windows") {
        name.push_str(".exe");
    }
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("mcp").join(name))
        .map_err(|error| format!("failed to resolve the Bonk data directory: {error}"))
}

fn executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "bonk-mcp.exe"
    } else {
        "bonk-mcp"
    }
}

fn bundled_mcp_path() -> Option<PathBuf> {
    let current = std::env::current_exe().ok()?;
    let parent = current.parent()?;
    let mut candidates = vec![parent.join(executable_name())];
    if let Some(grandparent) = parent.parent() {
        candidates.push(grandparent.join(executable_name()));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn install_mcp_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let destination = installed_mcp_path(app)?;
    let Some(source) = bundled_mcp_path() else {
        if destination.is_file() {
            return Ok(destination);
        }
        return Err(
            "The Bonk MCP binary is missing from this app build. Reinstall Bonk or run npm run prepare:mcp in development."
                .into(),
        );
    };
    let parent = destination
        .parent()
        .ok_or_else(|| "invalid MCP install path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create MCP install directory: {error}"))?;
    let temporary = parent.join(format!(".bonk-mcp-{}.tmp", std::process::id()));
    fs::copy(&source, &temporary)
        .map_err(|error| format!("failed to copy the MCP binary: {error}"))?;
    set_executable(&temporary)?;
    replace_file(&temporary, &destination)?;
    Ok(destination)
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("failed to mark MCP binary executable: {error}"))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn install_claude_desktop(config: &Path, binary: &Path, args: &[String]) -> Result<(), String> {
    let mut root = read_json_object(config)?;
    let servers = ensure_json_object(&mut root, "mcpServers")?;
    let mut entry = servers
        .get(SERVER_NAME)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    entry.insert(
        "command".into(),
        Value::String(binary.to_string_lossy().into_owned()),
    );
    entry.insert("args".into(), json!(args));
    servers.insert(SERVER_NAME.into(), Value::Object(entry));
    write_json_config(config, &Value::Object(root))
}

fn uninstall_claude_desktop(config: &Path) -> Result<bool, String> {
    let mut root = read_json_object(config)?;
    let Some(servers) = root.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        return Ok(false);
    };
    let removed = servers.remove(SERVER_NAME).is_some();
    if removed {
        write_json_config(config, &Value::Object(root))?;
    }
    Ok(removed)
}

fn read_json_object(path: &Path) -> Result<serde_json::Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Default::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("{} contains invalid JSON: {error}", path.display()))?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{} must contain a JSON object", path.display()))
}

fn ensure_json_object<'a>(
    root: &'a mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, Value>, String> {
    if !root.contains_key(key) {
        root.insert(key.into(), Value::Object(Default::default()));
    }
    root.get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!("`{key}` must be a JSON object"))
}

fn write_json_config(path: &Path, value: &Value) -> Result<(), String> {
    let mut output = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    output.push('\n');
    atomic_config_write(path, output.as_bytes())
}

fn install_codex(config: &Path, binary: &Path, args: &[String]) -> Result<(), String> {
    let mut document = read_toml_document(config)?;
    ensure_toml_table(&mut document, "mcp_servers")?;
    if !document["mcp_servers"]
        .as_table_like()
        .unwrap()
        .contains_key(SERVER_NAME)
    {
        document["mcp_servers"][SERVER_NAME] = Item::Table(Table::new());
    }
    let server = document["mcp_servers"][SERVER_NAME]
        .as_table_like_mut()
        .ok_or_else(|| "`mcp_servers.bonk` must be a TOML table".to_string())?;
    server.insert("command", value(binary.to_string_lossy().into_owned()));
    let mut values = Array::new();
    for arg in args {
        values.push(arg.as_str());
    }
    server.insert("args", value(values));
    server.insert("enabled", value(true));
    atomic_config_write(config, document.to_string().as_bytes())
}

fn uninstall_codex(config: &Path) -> Result<bool, String> {
    let mut document = read_toml_document(config)?;
    let Some(servers) = document
        .get_mut("mcp_servers")
        .and_then(Item::as_table_like_mut)
    else {
        return Ok(false);
    };
    let removed = servers.remove(SERVER_NAME).is_some();
    if removed {
        atomic_config_write(config, document.to_string().as_bytes())?;
    }
    Ok(removed)
}

fn read_toml_document(path: &Path) -> Result<DocumentMut, String> {
    if !path.exists() {
        return Ok(DocumentMut::new());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    raw.parse::<DocumentMut>()
        .map_err(|error| format!("{} contains invalid TOML: {error}", path.display()))
}

fn ensure_toml_table(document: &mut DocumentMut, key: &str) -> Result<(), String> {
    if !document.as_table().contains_key(key) {
        document[key] = Item::Table(Table::new());
    }
    if document[key].is_table_like() {
        Ok(())
    } else {
        Err(format!("`{key}` must be a TOML table"))
    }
}

async fn install_claude_code(
    executable: &Path,
    binary: &Path,
    args: &[String],
) -> Result<(), String> {
    let _ = run_client(
        executable,
        &["mcp", "remove", SERVER_NAME, "--scope", "user"],
    )
    .await;
    let mut command = vec![
        "mcp".to_string(),
        "add".into(),
        "--scope".into(),
        "user".into(),
        SERVER_NAME.into(),
        "--".into(),
        binary.to_string_lossy().into_owned(),
    ];
    command.extend(args.iter().cloned());
    run_client_owned(executable, &command).await.map(|_| ())
}

async fn remove_claude_code(executable: &Path) -> Result<bool, String> {
    let installed = run_client(executable, &["mcp", "get", SERVER_NAME])
        .await
        .is_ok();
    if !installed {
        return Ok(false);
    }
    run_client(
        executable,
        &["mcp", "remove", SERVER_NAME, "--scope", "user"],
    )
    .await
    .map(|_| true)
}

async fn run_client(executable: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let owned = args
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    run_client_owned(executable, &owned).await
}

async fn run_client_owned(executable: &Path, args: &[String]) -> Result<Vec<u8>, String> {
    let output = tokio::time::timeout(CLIENT_TIMEOUT, Command::new(executable).args(args).output())
        .await
        .map_err(|_| "client command timed out".to_string())?
        .map_err(|error| format!("failed to start client command: {error}"))?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        let message = String::from_utf8_lossy(&output.stderr);
        let message = message.trim().chars().take(500).collect::<String>();
        Err(if message.is_empty() {
            format!("client command exited with {}", output.status)
        } else {
            message
        })
    }
}

fn claude_desktop_status(paths: &ClientPaths, expected_binary: &Path) -> McpClientStatus {
    let mut status = base_status(
        "claude-desktop",
        "Claude Desktop",
        paths.claude_desktop_available,
        "Local desktop configuration",
    );
    if !paths.claude_desktop_config.exists() {
        return status;
    }
    match read_json_object(&paths.claude_desktop_config) {
        Ok(root) => {
            if let Some(entry) = root
                .get("mcpServers")
                .and_then(Value::as_object)
                .and_then(|servers| servers.get(SERVER_NAME))
            {
                status.installed = true;
                status.workspace = entry
                    .get("args")
                    .and_then(Value::as_array)
                    .and_then(|args| workspace_arg(args));
                let command = entry.get("command").and_then(Value::as_str);
                status.needs_update = command != Some(expected_binary.to_string_lossy().as_ref());
            }
        }
        Err(error) => status.error = Some(error),
    }
    status
}

fn codex_status(paths: &ClientPaths, expected_binary: &Path) -> McpClientStatus {
    let mut status = base_status(
        "openai",
        "ChatGPT / Codex",
        paths.openai_available,
        "Shared local OpenAI MCP configuration",
    );
    if !paths.codex_config.exists() {
        return status;
    }
    match read_toml_document(&paths.codex_config) {
        Ok(document) => {
            if let Some(server) = document
                .get("mcp_servers")
                .and_then(Item::as_table_like)
                .and_then(|servers| servers.get(SERVER_NAME))
                .and_then(Item::as_table_like)
            {
                status.installed = true;
                let args = server
                    .get("args")
                    .and_then(Item::as_value)
                    .and_then(|value| value.as_array());
                status.workspace = args.and_then(workspace_toml_arg);
                let command = server
                    .get("command")
                    .and_then(Item::as_value)
                    .and_then(|value| value.as_str());
                status.needs_update = command != Some(expected_binary.to_string_lossy().as_ref());
            }
        }
        Err(error) => status.error = Some(error),
    }
    status
}

async fn claude_code_status(executable: Option<&Path>) -> McpClientStatus {
    let mut status = base_status(
        "claude-code",
        "Claude Code",
        executable.is_some(),
        "User-scoped Claude Code configuration",
    );
    if let Some(executable) = executable {
        status.installed = run_client(executable, &["mcp", "get", SERVER_NAME])
            .await
            .is_ok();
    }
    status
}

fn base_status(id: &str, name: &str, available: bool, detail: &str) -> McpClientStatus {
    McpClientStatus {
        id: id.into(),
        name: name.into(),
        available,
        installed: false,
        needs_update: false,
        workspace: None,
        detail: detail.into(),
        error: None,
    }
}

fn workspace_arg(values: &[Value]) -> Option<String> {
    values.windows(2).find_map(|pair| {
        (pair[0].as_str() == Some("--workspace"))
            .then(|| pair[1].as_str().map(str::to_owned))
            .flatten()
    })
}

fn workspace_toml_arg(values: &toml_edit::Array) -> Option<String> {
    let values = values.iter().collect::<Vec<_>>();
    values.windows(2).find_map(|pair| {
        (pair[0].as_str() == Some("--workspace"))
            .then(|| pair[1].as_str().map(str::to_owned))
            .flatten()
    })
}

fn atomic_config_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    backup_once(path)?;
    let temporary = parent.join(format!(".bonk-config-{}.tmp", std::process::id()));
    fs::write(&temporary, contents)
        .map_err(|error| format!("failed to write temporary config: {error}"))?;
    set_private(&temporary)?;
    replace_file(&temporary, path)
}

fn backup_once(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config");
    let backup = path.with_file_name(format!("{name}.bonk-backup"));
    if !backup.exists() {
        fs::copy(path, &backup)
            .map_err(|error| format!("failed to back up {}: {error}", path.display()))?;
        set_private(&backup)?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_private(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to secure {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_private(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("failed to replace {}: {error}", destination.display()))?;
    }
    fs::rename(temporary, destination)
        .map_err(|error| format!("failed to install {}: {error}", destination.display()))
}

fn find_executable(name: &str, home: &Path) -> Option<PathBuf> {
    let mut names = vec![OsString::from(name)];
    if cfg!(target_os = "windows") {
        names.insert(0, OsString::from(format!("{name}.exe")));
        names.push(OsString::from(format!("{name}.cmd")));
    }
    let mut directories = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    directories.extend([
        home.join(".local/bin"),
        home.join(".cargo/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    directories.into_iter().find_map(|directory| {
        names
            .iter()
            .map(|name| directory.join(name))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(target_os = "macos")]
fn claude_desktop_config_path(home: &Path) -> PathBuf {
    home.join("Library/Application Support/Claude/claude_desktop_config.json")
}

#[cfg(target_os = "windows")]
fn claude_desktop_config_path(home: &Path) -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Roaming"))
        .join("Claude/claude_desktop_config.json")
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn claude_desktop_config_path(home: &Path) -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
        .join("Claude/claude_desktop_config.json")
}

#[cfg(target_os = "macos")]
fn claude_desktop_app_exists(home: &Path) -> bool {
    Path::new("/Applications/Claude.app").exists() || home.join("Applications/Claude.app").exists()
}

#[cfg(not(target_os = "macos"))]
fn claude_desktop_app_exists(_home: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn chatgpt_app_exists(home: &Path) -> bool {
    Path::new("/Applications/ChatGPT.app").exists()
        || home.join("Applications/ChatGPT.app").exists()
}

#[cfg(not(target_os = "macos"))]
fn chatgpt_app_exists(_home: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "bonk-mcp-install-test-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn builds_restricted_server_args() {
        let options = McpInstallOptions {
            workspace: "/tmp/workspace".into(),
            read_only: true,
            no_network: true,
            target_hosts: vec!["api.example.com".into()],
        };
        assert_eq!(
            mcp_args(Path::new("/tmp/workspace"), &options),
            vec![
                "--workspace",
                "/tmp/workspace",
                "--read-only",
                "--no-network",
                "--target-host",
                "api.example.com"
            ]
        );
    }

    #[test]
    fn codex_update_preserves_other_servers_and_env() {
        let mut document = r#"
[mcp_servers.other]
command = "other"

[mcp_servers.bonk]
command = "old"
args = ["--workspace", "/old"]

[mcp_servers.bonk.env]
BONK_VAR_TOKEN = "keep-me"
"#
        .parse::<DocumentMut>()
        .unwrap();
        let server = document["mcp_servers"][SERVER_NAME]
            .as_table_like_mut()
            .unwrap();
        server.insert("command", value("/new/bonk-mcp"));
        let mut args = Array::new();
        args.push("--workspace");
        args.push("/new");
        server.insert("args", value(args));
        let output = document.to_string();
        assert!(output.contains("[mcp_servers.other]"));
        assert!(output.contains("BONK_VAR_TOKEN = \"keep-me\""));
        assert!(output.contains("/new/bonk-mcp"));
    }

    #[test]
    fn claude_update_preserves_existing_environment() {
        let mut root = serde_json::from_str::<Value>(
            r#"{"mcpServers":{"bonk":{"command":"old","env":{"TOKEN":"keep"}},"other":{"command":"other"}}}"#,
        )
        .unwrap()
        .as_object()
        .unwrap()
        .clone();
        let servers = ensure_json_object(&mut root, "mcpServers").unwrap();
        let mut entry = servers[SERVER_NAME].as_object().unwrap().clone();
        entry.insert("command".into(), Value::String("new".into()));
        entry.insert("args".into(), json!(["--workspace", "/new"]));
        servers.insert(SERVER_NAME.into(), Value::Object(entry));
        assert_eq!(servers[SERVER_NAME]["env"]["TOKEN"], "keep");
        assert_eq!(servers["other"]["command"], "other");
    }

    #[test]
    fn claude_config_install_and_remove_roundtrip() {
        let directory = TestDirectory::new();
        let config = directory.0.join("claude_desktop_config.json");
        fs::write(&config, r#"{"mcpServers":{"other":{"command":"other"}}}"#).unwrap();
        install_claude_desktop(
            &config,
            Path::new("/opt/bonk-mcp"),
            &["--workspace".into(), "/api".into()],
        )
        .unwrap();
        let installed = read_json_object(&config).unwrap();
        assert_eq!(installed["mcpServers"]["bonk"]["command"], "/opt/bonk-mcp");
        assert_eq!(installed["mcpServers"]["other"]["command"], "other");
        assert!(directory
            .0
            .join("claude_desktop_config.json.bonk-backup")
            .exists());
        assert!(uninstall_claude_desktop(&config).unwrap());
        let removed = read_json_object(&config).unwrap();
        assert!(removed["mcpServers"].get("bonk").is_none());
        assert_eq!(removed["mcpServers"]["other"]["command"], "other");
    }

    #[test]
    fn codex_config_install_and_remove_roundtrip() {
        let directory = TestDirectory::new();
        let config = directory.0.join("config.toml");
        fs::write(
            &config,
            "model = \"test\"\n\n[mcp_servers.other]\ncommand = \"other\"\n",
        )
        .unwrap();
        install_codex(
            &config,
            Path::new("/opt/bonk-mcp"),
            &["--workspace".into(), "/api".into()],
        )
        .unwrap();
        let installed = read_toml_document(&config).unwrap();
        assert_eq!(
            installed["mcp_servers"]["bonk"]["command"].as_str(),
            Some("/opt/bonk-mcp")
        );
        assert_eq!(
            installed["mcp_servers"]["other"]["command"].as_str(),
            Some("other")
        );
        assert!(uninstall_codex(&config).unwrap());
        let removed = read_toml_document(&config).unwrap();
        assert!(removed["mcp_servers"].get("bonk").is_none());
        assert_eq!(
            removed["mcp_servers"]["other"]["command"].as_str(),
            Some("other")
        );
    }
}
