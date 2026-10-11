//! `bonk-cli`: run Bonk collections from a terminal or CI on the app's engine
//! (bonk-core's runner): same scripts, `{{vars}}`, auth and tests as the Runner tab.
//! Exit code: 0 everything passed, 1 something failed, 2 the run couldn't start.

mod report;

use std::{
    io::IsTerminal,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Mutex,
    time::Duration,
};

use bonk_core::{
    application::{
        app_vars, http, run_data,
        runner::{self, GrpcTarget, RunControl, RunPlan, RunStatus, RunVars, Transport},
        workspace,
    },
    conn::GrpcDescriptorCache,
    domain::{
        grpc::GrpcResult,
        http::{HttpRequest, HttpResponse, RequestSettings},
    },
};
use clap::{Args, Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "bonk",
    version,
    about = "Run Bonk API collections from the terminal and CI"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run saved requests (folders, request files, or the whole workspace) with their scripts and tests.
    Run(RunArgs),
}

#[derive(Args, Default)]
struct RunArgs {
    /// Folders or `.bonk.json` files inside the workspace. None: the whole workspace.
    paths: Vec<PathBuf>,
    /// Workspace root (the folder you open in Bonk). Default: the current directory.
    #[arg(long, short = 'w', value_name = "DIR")]
    workspace: Option<PathBuf>,
    /// Environment saved in the Bonk app, by name.
    #[arg(long, short = 'e', value_name = "NAME")]
    env: Option<String>,
    /// A variable; wins over the environment. Repeatable. `BONK_VAR_<NAME>` env vars work too.
    #[arg(long = "var", value_name = "NAME=VALUE", value_parser = parse_var)]
    vars: Vec<(String, String)>,
    /// CSV or JSON data file: one iteration per row (`pm.iterationData`).
    #[arg(long, short = 'd', value_name = "FILE")]
    data: Option<PathBuf>,
    /// Run everything this many times (ignored with --data).
    #[arg(long, short = 'n', default_value_t = 1)]
    iterations: u32,
    /// Pause between requests, ms.
    #[arg(long, default_value_t = 0, value_name = "MS")]
    delay: u64,
    /// Stop at the first failed request.
    #[arg(long)]
    bail: bool,
    /// Per-request timeout, ms.
    #[arg(long, default_value_t = 30_000, value_name = "MS")]
    timeout: u64,
    /// Accept invalid TLS certificates (self-signed dev servers).
    #[arg(long, short = 'k')]
    insecure: bool,
    /// The Bonk app's state.json (globals + environments). Default: the app's data folder.
    #[arg(long, value_name = "FILE")]
    app_state: Option<PathBuf>,
    /// Also write a JUnit XML report (CI test tabs).
    #[arg(long, value_name = "FILE")]
    junit: Option<PathBuf>,
    /// Also write a JSON report.
    #[arg(long, value_name = "FILE")]
    json: Option<PathBuf>,
}

fn parse_var(s: &str) -> Result<(String, String), String> {
    s.split_once('=')
        .map(|(name, value)| (name.trim().to_string(), value.to_string()))
        .filter(|(name, _)| !name.is_empty())
        .ok_or_else(|| format!("expected NAME=VALUE, got `{s}`"))
}

/// Process variables with this prefix become `{{NAME}}` (CI secrets), as in bonk-mcp.
const VAR_PREFIX: &str = "BONK_VAR_";

#[tokio::main]
async fn main() -> ExitCode {
    let Command::Run(args) = Cli::parse().command;
    match run(&args).await {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(error) => {
            eprintln!("bonk: {error}");
            ExitCode::from(2)
        }
    }
}

/// Run and report; `Ok(true)` when every request passed.
async fn run(args: &RunArgs) -> Result<bool, String> {
    let root = args
        .workspace
        .clone()
        .unwrap_or_else(|| PathBuf::from("."))
        .canonicalize()
        .map_err(|e| format!("workspace: {e}"))?;
    let tree = workspace::load(&root.to_string_lossy())?;
    let ids = if args.paths.is_empty() {
        vec!["fs:".to_string()]
    } else {
        args.paths
            .iter()
            .map(|path| node_id(&root, path))
            .collect::<Result<_, _>>()?
    };
    let requests = runner::plan_requests(&tree, &ids)?;
    if requests.is_empty() {
        return Err("no requests to run".into());
    }
    let data_rows = match &args.data {
        Some(path) => {
            let text =
                std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
            run_data::parse_data_file(&path.to_string_lossy(), &text)?
        }
        None => Vec::new(),
    };
    let plan = RunPlan {
        requests,
        iterations: args.iterations,
        data_rows,
        delay_ms: args.delay,
        stop_on_failure: args.bail,
        workspace_root: root.to_string_lossy().into_owned(),
        ..RunPlan::default()
    };
    let mut vars = variables(args)?;
    let transport = CliTransport::new(args)?;
    let color = std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let report = Mutex::new(report::Report::new(plan.iteration_count(), color));
    let status = runner::run_collection(
        &plan,
        &mut vars,
        &transport,
        &RunControl::default(),
        &|event| {
            if let Ok(mut report) = report.lock() {
                report.event(event);
            }
        },
    )
    .await;
    let report = report.into_inner().map_err(|_| "report lock poisoned")?;
    report.print_summary(status);
    if let Some(path) = &args.junit {
        std::fs::write(path, report.junit()).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    if let Some(path) = &args.json {
        std::fs::write(path, report.json(status))
            .map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(status == RunStatus::Done && report.all_ok())
}

/// The workspace id (`fs:<relative path>`) of a folder or request file inside `root`.
fn node_id(root: &Path, path: &Path) -> Result<String, String> {
    let full = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let rel = full.strip_prefix(root).map_err(|_| {
        format!(
            "{} is outside the workspace {}",
            path.display(),
            root.display()
        )
    })?;
    let rel: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Ok(format!("fs:{}", rel.join("/")))
}

/// Globals and the chosen environment from the app, `BONK_VAR_*` over the globals and
/// `--var` over the environment (as in bonk-mcp).
fn variables(args: &RunArgs) -> Result<RunVars, String> {
    let state = args.app_state.clone().or_else(default_state_path);
    let app = app_vars::load_app_vars(state.as_deref());
    let (mut environment, mut globals, _) =
        app_vars::app_scopes(&app, args.env.as_deref(), &app_vars::keychain_secret)?;
    globals.extend(std::env::vars().filter_map(|(name, value)| {
        let name = name.strip_prefix(VAR_PREFIX)?;
        (!name.is_empty()).then(|| (name.to_string(), value))
    }));
    environment.extend(args.vars.iter().cloned());
    Ok(RunVars {
        environment,
        globals,
    })
}

/// Where the Bonk app keeps state.json (Tauri's app data dir for the bundle identifier).
fn default_state_path() -> Option<PathBuf> {
    const IDENTIFIER: &str = "io.github.nekidaz.bonk";
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support")
    } else if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        match std::env::var_os("XDG_DATA_HOME") {
            Some(dir) => PathBuf::from(dir),
            None => home()?.join(".local/share"),
        }
    };
    Some(base.join(IDENTIFIER).join("state.json"))
}

/// The CLI's network: one HTTP client for the run (an in-memory cookie jar carries a
/// login's session to later requests), gRPC dialed per call.
struct CliTransport {
    client: reqwest::Client,
    settings: RequestSettings,
    timeout: Duration,
    insecure: bool,
}

impl CliTransport {
    fn new(args: &RunArgs) -> Result<Self, String> {
        let timeout = Duration::from_millis(args.timeout);
        let client = reqwest::Client::builder()
            .user_agent(concat!("bonk-cli/", env!("CARGO_PKG_VERSION")))
            .cookie_store(true)
            .timeout(timeout)
            .danger_accept_invalid_certs(args.insecure)
            .build()
            .map_err(|e| format!("HTTP client: {e}"))?;
        let settings = RequestSettings {
            timeout_ms: args.timeout,
            validate_tls: !args.insecure,
            ..RequestSettings::default()
        };
        Ok(Self {
            client,
            settings: settings.normalized(),
            timeout,
            insecure: args.insecure,
        })
    }
}

impl Transport for CliTransport {
    type Grpc = (GrpcTarget, GrpcDescriptorCache);

    async fn send_http(&self, request: HttpRequest) -> Result<HttpResponse, String> {
        http::http_send(self.client.clone(), request, self.settings.clone(), None).await
    }

    async fn grpc_open(&self, mut target: GrpcTarget) -> Result<Self::Grpc, String> {
        target.tls.insecure |= self.insecure;
        let cache = runner::load_grpc_schema(&target).await?;
        Ok((target, cache))
    }

    async fn grpc_call(
        &self,
        conn: &Self::Grpc,
        method: &str,
        message: &str,
        metadata: &std::collections::BTreeMap<String, String>,
    ) -> Result<GrpcResult, String> {
        let (target, cache) = conn;
        runner::call_grpc(target, cache, method, message, metadata, self.timeout).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bonk-cli-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn paths_become_workspace_ids() {
        let root = temp_dir();
        std::fs::create_dir(root.join("api")).unwrap();
        std::fs::write(root.join("api/me.bonk.json"), "{}").unwrap();
        assert_eq!(node_id(&root, &root).unwrap(), "fs:");
        assert_eq!(node_id(&root, &root.join("api")).unwrap(), "fs:api");
        assert_eq!(
            node_id(&root, &root.join("api/me.bonk.json")).unwrap(),
            "fs:api/me.bonk.json"
        );
        assert!(node_id(&root, &std::env::temp_dir()).is_err());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn var_flags() {
        assert_eq!(parse_var("a=b=c").unwrap(), ("a".into(), "b=c".into()));
        assert!(parse_var("nope").is_err());
        assert!(parse_var("=x").is_err());
    }

    /// A localhost server answering every request with its `Authorization` header as JSON.
    async fn echo_auth_server() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = vec![0; 8192];
                let n = socket.read(&mut buf).await.unwrap();
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let auth = head
                    .lines()
                    .find_map(|l| l.strip_prefix("authorization: "))
                    .unwrap_or_default()
                    .to_string();
                let body = serde_json::json!({ "auth": auth }).to_string();
                let reply = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        format!("http://{addr}")
    }

    /// A workspace folder run end to end: a test script's write feeds the next request,
    /// folder auth is inherited, and a failing test makes the run fail.
    #[tokio::test]
    async fn runs_a_folder_end_to_end() {
        let root = temp_dir();
        let api = root.join("api");
        std::fs::create_dir(&api).unwrap();
        std::fs::write(
            api.join(".folder.bonk.json"),
            r#"{"auth": {"type": "bearer", "bearerToken": "{{token}}"}}"#,
        )
        .unwrap();
        std::fs::write(
            api.join("a-login.bonk.json"),
            r#"{"name": "login", "protocol": "http", "request": {"method": "GET", "url": "{{base}}/login",
                "auth": {"type": "none"},
                "testScript": "pm.environment.set('token', 't1');"}}"#,
        )
        .unwrap();
        std::fs::write(
            api.join("b-me.bonk.json"),
            r#"{"name": "me", "protocol": "http", "request": {"method": "GET", "url": "{{base}}/me",
                "auth": {"type": "inherit"},
                "testScript": "pm.test('auth', function(){ pm.expect(pm.response.json().auth).to.equal('Bearer t1'); });"}}"#,
        )
        .unwrap();
        let junit = root.join("junit.xml");
        let mut args = RunArgs {
            paths: vec![api.clone()],
            workspace: Some(root.clone()),
            vars: vec![("base".into(), echo_auth_server().await)],
            iterations: 1,
            timeout: 5_000,
            app_state: Some(root.join("no-state.json")),
            junit: Some(junit.clone()),
            ..RunArgs::default()
        };
        assert_eq!(run(&args).await, Ok(true));
        let xml = std::fs::read_to_string(&junit).unwrap();
        assert!(xml.contains(r#"tests="2" failures="0""#), "{xml}");

        args.vars.push(("token".into(), "wrong".into()));
        args.paths = vec![api.join("b-me.bonk.json")];
        assert_eq!(run(&args).await, Ok(false));
        std::fs::remove_dir_all(root).ok();
    }
}
