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
const JOURNAL_FILE: &str = "mcp-journal.jsonl";
/// Options of the last successful install; `needsUpdate` compares against them.
const OPTIONS_FILE: &str = "mcp-install.json";
const MUTATING_POLICIES: [&str; 3] = ["allow", "ask", "deny"];

// Client ids, stable across the UI, `clients` filters and the server's `--client` flag:
//   claude-desktop  Claude Desktop (claude_desktop_config.json)
//   openai          ChatGPT desktop / Codex (shared ~/.codex/config.toml)
//   claude-code     Claude Code, user scope (~/.claude.json, written via `claude mcp add`)
//   other           manual setup through `mcp_client_config`
const CLAUDE_DESKTOP: &str = "claude-desktop";
const OPENAI: &str = "openai";
const CLAUDE_CODE: &str = "claude-code";
const OTHER_CLIENT: &str = "other";

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
    config_path: Option<String>,
    last_call_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpIntegrationStatus {
    binary_available: bool,
    installed_binary: String,
    version: String,
    clients: Vec<McpClientStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOperationResult {
    status: McpIntegrationStatus,
    messages: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInstallOptions {
    workspace: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    no_network: bool,
    #[serde(default)]
    target_hosts: Vec<String>,
    #[serde(default)]
    expose_secrets: bool,
    /// App environment names the AI may use.
    #[serde(default)]
    environments: Vec<String>,
    /// allow | ask | deny for HTTP POST/PUT/PATCH/DELETE.
    #[serde(default = "default_mutating_methods")]
    mutating_methods: String,
    /// Client ids to install for; None = every available client.
    #[serde(default, skip_serializing)]
    clients: Option<Vec<String>>,
}

fn default_mutating_methods() -> String {
    "ask".into()
}

#[derive(Debug, Clone)]
struct ClientPaths {
    claude_desktop_config: PathBuf,
    codex_config: PathBuf,
    claude_code_config: PathBuf,
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
            claude_code_config: home.join(".claude.json"),
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
    mut options: McpInstallOptions,
) -> Result<McpOperationResult, String> {
    let workspace = canonical_workspace(&options.workspace)?;
    validate_options(&options)?;
    let binary = install_mcp_binary(&app)?;
    let data = data_dir(&app)?;
    let clients = ClientPaths::discover(&home_dir(&app)?);
    let mut messages = Vec::new();
    let mut attempted = 0usize;
    let mut succeeded = 0usize;

    for (id, name, available) in clients.list() {
        if !wanted(options.clients.as_deref(), id) {
            continue;
        }
        if !available {
            if options.clients.is_some() {
                messages.push(format!("{name}: not detected"));
            }
            continue;
        }
        attempted += 1;
        let args = mcp_args(&workspace, &options, id, &data);
        let result = match (id, clients.claude_code.as_deref()) {
            (CLAUDE_DESKTOP, _) => {
                install_claude_desktop(&clients.claude_desktop_config, &binary, &args)
            }
            (OPENAI, _) => install_codex(&clients.codex_config, &binary, &args),
            (_, Some(claude)) => install_claude_code(claude, &binary, &args).await,
            _ => Err("not detected".into()),
        };
        match result {
            Ok(()) => {
                succeeded += 1;
                messages.push(format!("{name} configured"));
            }
            Err(error) => messages.push(format!("{name}: {error}")),
        }
    }

    if attempted == 0 {
        return Err(if messages.is_empty() {
            "No supported local AI client was detected. Install Claude Desktop, ChatGPT/Codex, or Claude Code first.".into()
        } else {
            messages.join(" · ")
        });
    }
    if succeeded == 0 {
        return Err(messages.join(" · "));
    }
    options.workspace = workspace.to_string_lossy().into_owned();
    let saved = serde_json::to_vec_pretty(&options).map_err(|error| error.to_string())?;
    atomic_config_write(&data.join(OPTIONS_FILE), &saved)?;

    Ok(McpOperationResult {
        status: collect_status(&app).await?,
        messages,
    })
}

#[tauri::command]
pub async fn mcp_uninstall(
    app: AppHandle,
    clients: Option<Vec<String>>,
) -> Result<McpOperationResult, String> {
    let paths = ClientPaths::discover(&home_dir(&app)?);
    let wanted = |id| wanted(clients.as_deref(), id);
    let mut messages = Vec::new();

    if wanted(CLAUDE_DESKTOP) && paths.claude_desktop_config.exists() {
        match uninstall_claude_desktop(&paths.claude_desktop_config) {
            Ok(true) => messages.push("Claude Desktop integration removed".into()),
            Ok(false) => {}
            Err(error) => messages.push(format!("Claude Desktop: {error}")),
        }
    }
    if wanted(OPENAI) && paths.codex_config.exists() {
        match uninstall_codex(&paths.codex_config) {
            Ok(true) => messages.push("ChatGPT / Codex integration removed".into()),
            Ok(false) => {}
            Err(error) => messages.push(format!("ChatGPT / Codex: {error}")),
        }
    }
    if let Some(claude) = paths.claude_code.as_deref().filter(|_| wanted(CLAUDE_CODE)) {
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

/// `{"mcpServers":{"bonk":{…}}}` for configuring any other MCP client by hand.
#[tauri::command]
pub fn mcp_client_config(app: AppHandle, options: McpInstallOptions) -> Result<String, String> {
    let workspace = canonical_workspace(&options.workspace)?;
    validate_options(&options)?;
    let binary = install_mcp_binary(&app)?;
    let args = mcp_args(&workspace, &options, OTHER_CLIENT, &data_dir(&app)?);
    serde_json::to_string_pretty(&json!({
        "mcpServers": { SERVER_NAME: { "command": binary, "args": args } }
    }))
    .map_err(|error| error.to_string())
}

/// Newest-first tool calls recorded by every installed server.
#[tauri::command]
pub fn mcp_journal(app: AppHandle, limit: Option<usize>) -> Result<Vec<Value>, String> {
    let mut entries = read_journal(&data_dir(&app)?.join(JOURNAL_FILE));
    entries.reverse();
    entries.truncate(limit.unwrap_or(200));
    Ok(entries)
}

async fn collect_status(app: &AppHandle) -> Result<McpIntegrationStatus, String> {
    let paths = ClientPaths::discover(&home_dir(app)?);
    let installed_binary = installed_mcp_path(app)?;
    let binary_available = installed_binary.is_file() || bundled_mcp_path().is_some();
    let data = data_dir(app)?;
    let saved = fs::read(data.join(OPTIONS_FILE))
        .ok()
        .and_then(|raw| serde_json::from_slice::<McpInstallOptions>(&raw).ok());
    let expected = |id| {
        saved
            .as_ref()
            .map(|options| mcp_args(Path::new(&options.workspace), options, id, &data))
    };

    let mut clients = vec![
        claude_desktop_status(&paths, &installed_binary, expected(CLAUDE_DESKTOP)),
        codex_status(&paths, &installed_binary, expected(OPENAI)),
        claude_code_status(&paths, &installed_binary, expected(CLAUDE_CODE)).await,
    ];
    let journal = read_journal(&data.join(JOURNAL_FILE));
    for client in &mut clients {
        client.last_call_at = journal
            .iter()
            .filter(|entry| entry["client"].as_str() == Some(client.id.as_str()))
            .filter_map(|entry| entry["at"].as_u64())
            .max();
    }

    Ok(McpIntegrationStatus {
        binary_available,
        installed_binary: installed_binary.to_string_lossy().into_owned(),
        version: env!("CARGO_PKG_VERSION").into(),
        clients,
    })
}

impl ClientPaths {
    /// (id, display name, detected) for every supported client.
    fn list(&self) -> [(&'static str, &'static str, bool); 3] {
        [
            (
                CLAUDE_DESKTOP,
                "Claude Desktop",
                self.claude_desktop_available,
            ),
            (OPENAI, "ChatGPT / Codex", self.openai_available),
            (CLAUDE_CODE, "Claude Code", self.claude_code.is_some()),
        ]
    }
}

fn wanted(clients: Option<&[String]>, id: &str) -> bool {
    clients.is_none_or(|clients| clients.iter().any(|client| client == id))
}

fn home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map_err(|error| format!("failed to find the home directory: {error}"))
}

/// Where state.json lives (see `state_path` in commands).
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve the Bonk data directory: {error}"))
}

/// Journal lines from the rotated file then the live one (oldest first).
fn read_journal(path: &Path) -> Vec<Value> {
    [path.with_extension("jsonl.1"), path.to_path_buf()]
        .iter()
        .filter_map(|file| fs::read_to_string(file).ok())
        .flat_map(|raw| {
            raw.lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn validate_options(options: &McpInstallOptions) -> Result<(), String> {
    validate_target_hosts(&options.target_hosts)?;
    if !MUTATING_POLICIES.contains(&options.mutating_methods.as_str()) {
        return Err(format!(
            "Invalid mutating methods policy: {}",
            options.mutating_methods
        ));
    }
    Ok(())
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

fn mcp_args(
    workspace: &Path,
    options: &McpInstallOptions,
    client: &str,
    data: &Path,
) -> Vec<String> {
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
    if options.expose_secrets {
        args.push("--expose-secrets".into());
    }
    for host in &options.target_hosts {
        args.push("--target-host".into());
        args.push(host.clone());
    }
    for environment in options.environments.iter().filter(|name| !name.is_empty()) {
        args.push("--environment".into());
        args.push(environment.clone());
    }
    for (flag, value) in [
        ("--mutating-methods", options.mutating_methods.clone()),
        ("--client", client.into()),
        (
            "--app-state",
            data.join("state.json").to_string_lossy().into_owned(),
        ),
        (
            "--journal",
            data.join(JOURNAL_FILE).to_string_lossy().into_owned(),
        ),
    ] {
        args.push(flag.into());
        args.push(value);
    }
    args
}

/// Installed entries are stale when the binary moved (app update) or the args
/// differ from what the last-saved options would write. Without saved options
/// (installed by an older Bonk) any entry lacking `--journal` is stale.
fn needs_update(
    command: Option<&str>,
    args: &[String],
    binary: &Path,
    expected: Option<&[String]>,
) -> bool {
    command != Some(binary.to_string_lossy().as_ref())
        || expected.map_or(!args.iter().any(|arg| arg == "--journal"), |expected| {
            args != expected
        })
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

fn claude_desktop_status(
    paths: &ClientPaths,
    binary: &Path,
    expected: Option<Vec<String>>,
) -> McpClientStatus {
    let mut status = base_status(
        CLAUDE_DESKTOP,
        "Claude Desktop",
        paths.claude_desktop_available,
        "Local desktop configuration",
        &paths.claude_desktop_config,
    );
    if !paths.claude_desktop_config.exists() {
        return status;
    }
    match read_json_object(&paths.claude_desktop_config) {
        Ok(root) => apply_json_entry(&mut status, &root, binary, expected.as_deref()),
        Err(error) => status.error = Some(error),
    }
    status
}

fn codex_status(
    paths: &ClientPaths,
    binary: &Path,
    expected: Option<Vec<String>>,
) -> McpClientStatus {
    let mut status = base_status(
        OPENAI,
        "ChatGPT / Codex",
        paths.openai_available,
        "Shared local OpenAI MCP configuration",
        &paths.codex_config,
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
                let args = server
                    .get("args")
                    .and_then(Item::as_value)
                    .and_then(|value| value.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(str::to_owned))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let command = server
                    .get("command")
                    .and_then(Item::as_value)
                    .and_then(|value| value.as_str());
                status.installed = true;
                status.workspace = workspace_arg(&args);
                status.needs_update = needs_update(command, &args, binary, expected.as_deref());
            }
        }
        Err(error) => status.error = Some(error),
    }
    status
}

/// Reads ~/.claude.json directly; falls back to `claude mcp get` (which also
/// health-checks the server) when the entry isn't there.
async fn claude_code_status(
    paths: &ClientPaths,
    binary: &Path,
    expected: Option<Vec<String>>,
) -> McpClientStatus {
    let mut status = base_status(
        CLAUDE_CODE,
        "Claude Code",
        paths.claude_code.is_some(),
        "User-scoped Claude Code configuration",
        &paths.claude_code_config,
    );
    if let Ok(root) = read_json_object(&paths.claude_code_config) {
        apply_json_entry(&mut status, &root, binary, expected.as_deref());
    }
    if let Some(executable) = paths.claude_code.as_deref().filter(|_| !status.installed) {
        status.installed = run_client(executable, &["mcp", "get", SERVER_NAME])
            .await
            .is_ok();
    }
    status
}

/// Fill status from a JSON config's `mcpServers.bonk` entry (Claude Desktop / Code).
fn apply_json_entry(
    status: &mut McpClientStatus,
    root: &serde_json::Map<String, Value>,
    binary: &Path,
    expected: Option<&[String]>,
) {
    let Some(entry) = root
        .get("mcpServers")
        .and_then(Value::as_object)
        .and_then(|servers| servers.get(SERVER_NAME))
    else {
        return;
    };
    let args = entry
        .get("args")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let command = entry.get("command").and_then(Value::as_str);
    status.installed = true;
    status.workspace = workspace_arg(&args);
    status.needs_update = needs_update(command, &args, binary, expected);
}

fn base_status(
    id: &str,
    name: &str,
    available: bool,
    detail: &str,
    config: &Path,
) -> McpClientStatus {
    McpClientStatus {
        id: id.into(),
        name: name.into(),
        available,
        installed: false,
        needs_update: false,
        workspace: None,
        detail: detail.into(),
        error: None,
        config_path: Some(config.to_string_lossy().into_owned()),
        last_call_at: None,
    }
}

fn workspace_arg(args: &[String]) -> Option<String> {
    args.windows(2)
        .find_map(|pair| (pair[0] == "--workspace").then(|| pair[1].clone()))
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

    fn restricted_options() -> McpInstallOptions {
        McpInstallOptions {
            workspace: "/tmp/workspace".into(),
            read_only: true,
            no_network: true,
            target_hosts: vec!["api.example.com".into()],
            expose_secrets: true,
            environments: vec!["Staging".into()],
            mutating_methods: "deny".into(),
            clients: None,
        }
    }

    #[test]
    fn builds_restricted_server_args() {
        assert_eq!(
            mcp_args(
                Path::new("/tmp/workspace"),
                &restricted_options(),
                CLAUDE_CODE,
                Path::new("/data")
            ),
            vec![
                "--workspace",
                "/tmp/workspace",
                "--read-only",
                "--no-network",
                "--expose-secrets",
                "--target-host",
                "api.example.com",
                "--environment",
                "Staging",
                "--mutating-methods",
                "deny",
                "--client",
                "claude-code",
                "--app-state",
                "/data/state.json",
                "--journal",
                "/data/mcp-journal.jsonl"
            ]
        );
    }

    #[test]
    fn needs_update_compares_binary_and_args() {
        let binary = Path::new("/opt/bonk-mcp");
        let options = restricted_options();
        let expected = mcp_args(Path::new("/w"), &options, OPENAI, Path::new("/d"));
        assert!(!needs_update(
            Some("/opt/bonk-mcp"),
            &expected,
            binary,
            Some(&expected)
        ));
        assert!(needs_update(
            Some("/old/bonk-mcp"),
            &expected,
            binary,
            Some(&expected)
        ));
        let other_client = mcp_args(Path::new("/w"), &options, CLAUDE_CODE, Path::new("/d"));
        assert!(needs_update(
            Some("/opt/bonk-mcp"),
            &other_client,
            binary,
            Some(&expected)
        ));
        let legacy = vec!["--workspace".to_string(), "/w".into()];
        assert!(needs_update(Some("/opt/bonk-mcp"), &legacy, binary, None));
        assert!(!needs_update(
            Some("/opt/bonk-mcp"),
            &expected,
            binary,
            None
        ));
        let saved = serde_json::to_string(&options).unwrap();
        let restored: McpInstallOptions = serde_json::from_str(&saved).unwrap();
        assert_eq!(
            mcp_args(Path::new("/w"), &restored, OPENAI, Path::new("/d")),
            expected
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
