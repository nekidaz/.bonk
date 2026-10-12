//! `bonk-cli`: run Bonk collections from a terminal or CI on the app's engine
//! (bonk-core's runner): same scripts, `{{vars}}`, auth and tests as the Runner tab.
//! Exit code: 0 everything passed, 1 something failed, 2 the run couldn't start.

mod network;
mod report;

use std::{
    io::IsTerminal,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::{Arc, Mutex},
    time::Duration,
};

use bonk_core::{
    application::{
        app_vars, http, http_client, inputs, run_data,
        runner::{self, GrpcTarget, InputMode, RunControl, RunPlan, RunStatus, RunVars, Transport},
        scenarios, workspace,
    },
    conn::GrpcDescriptorCache,
    domain::{
        grpc::GrpcResult,
        http::{pick_client_cert, ClientCert, HttpRequest, HttpResponse, RequestSettings},
        inputs::InputKind,
    },
    infra::cookie_jar::{CookieJar, JarProvider},
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
    Run(Box<RunArgs>),
    /// Import request definitions from a Bonk JSON workspace export.
    Import(ImportArgs),
}

#[derive(Args)]
struct ImportArgs {
    file: PathBuf,
    #[arg(long, short = 'w', value_name = "DIR")]
    workspace: PathBuf,
}

fn import(args: ImportArgs) -> Result<bool, String> {
    let root = args
        .workspace
        .canonicalize()
        .map_err(|e| format!("workspace: {e}"))?;
    let text =
        std::fs::read_to_string(&args.file).map_err(|e| format!("{}: {e}", args.file.display()))?;
    let export: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if export["format"] != "bonk-workspace" || export["version"] != 1 {
        return Err("expected a Bonk workspace export (version 1)".into());
    }
    let name = export["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("workspace export has no name")?;
    let children = serde_json::from_value(export["collections"].clone())
        .map_err(|e| format!("collections: {e}"))?;
    let id = workspace::import_collection(
        &root.to_string_lossy(),
        workspace::ImportCollection {
            name: name.into(),
            children,
            auth: None,
            source: None,
        },
    )?;
    println!("Imported request definitions into {id}. Environment values stay local; use a scenario for portable defaults.");
    Ok(true)
}

#[derive(Args, Default)]
struct RunArgs {
    /// Folders or `.bonk.json` files inside the workspace. None: the whole workspace.
    paths: Vec<PathBuf>,
    /// Workspace root (the folder you open in Bonk). Default: the current directory.
    #[arg(long, short = 'w', value_name = "DIR")]
    workspace: Option<PathBuf>,
    /// A committed scenario in .bonk/scenarios.json (paths and settings come from it).
    #[arg(long, value_name = "NAME", conflicts_with = "paths")]
    scenario: Option<String>,
    /// Environment saved in the Bonk app, by name.
    #[arg(long, short = 'e', value_name = "NAME")]
    env: Option<String>,
    /// A variable; wins over the environment. Repeatable. `BONK_VAR_<NAME>` env vars work too.
    #[arg(long = "var", value_name = "NAME=VALUE", value_parser = parse_var)]
    vars: Vec<(String, String)>,
    /// Value of an «ask on send» variable (`.bonk/inputs.json`), e.g. an SMS code; a step that
    /// needs one nobody gave fails. Repeatable. `BONK_INPUT_<NAME>` env vars work too.
    #[arg(long = "input", value_name = "NAME=VALUE", value_parser = parse_var)]
    inputs: Vec<(String, String)>,
    /// CSV or JSON data file: one iteration per row (`pm.iterationData`).
    #[arg(long, short = 'd', value_name = "FILE")]
    data: Option<PathBuf>,
    /// Run everything this many times (ignored with --data).
    #[arg(long, short = 'n')]
    iterations: Option<u32>,
    /// Pause between requests, ms.
    #[arg(long, value_name = "MS")]
    delay: Option<u64>,
    /// Stop at the first failed request.
    #[arg(long)]
    bail: bool,
    /// Per-request timeout, ms.
    #[arg(long, value_name = "MS")]
    timeout: Option<u64>,
    #[command(flatten)]
    network: network::NetworkArgs,
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
/// Process variables with this prefix answer an «ask on send» variable.
const INPUT_PREFIX: &str = "BONK_INPUT_";

#[tokio::main]
async fn main() -> ExitCode {
    let result = match Cli::parse().command {
        Command::Run(args) => run(&args).await,
        Command::Import(args) => import(args),
    };
    match result {
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
    let scenario = match &args.scenario {
        Some(name) => Some(
            scenarios::load(&root)?
                .into_iter()
                .find(|s| &s.name == name)
                .ok_or_else(|| format!("scenario `{name}` was not found"))?,
        ),
        None => None,
    };
    let mut plan = if let Some(scenario) = &scenario {
        scenario.plan(&root)?
    } else {
        let tree = workspace::load(&root.to_string_lossy())?;
        let ids = if args.paths.is_empty() {
            vec!["fs:".to_string()]
        } else {
            args.paths
                .iter()
                .map(|path| node_id(&root, &root.join(path)))
                .collect::<Result<_, _>>()?
        };
        let requests = runner::plan_requests(&tree, &ids)?;
        if requests.is_empty() {
            return Err("no requests to run".into());
        }
        RunPlan {
            requests,
            iterations: args.iterations.unwrap_or(1),
            delay_ms: args.delay.unwrap_or(0),
            stop_on_failure: args.bail,
            workspace_root: root.to_string_lossy().into_owned(),
            ..RunPlan::default()
        }
    };
    // Explicit data overrides embedded rows. Other scenario settings are preserved;
    // --bail can additionally make a scenario stricter.
    if let Some(path) = &args.data {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        plan.data_rows = run_data::parse_data_file(&path.to_string_lossy(), &text)?;
    }
    if let Some(iterations) = args.iterations {
        plan.iterations = iterations;
    }
    if let Some(delay) = args.delay {
        plan.delay_ms = delay;
    }
    plan.stop_on_failure |= args.bail;
    // A session is kept per environment.
    plan.environment_name = args
        .env
        .clone()
        .or_else(|| scenario.as_ref().and_then(|s| s.environment_name.clone()))
        .unwrap_or_default();
    let mut input_secrets = Vec::new();
    plan_inputs(&mut plan, &root, args, &mut input_secrets)?;
    let (mut vars, mut secrets) = variables(args, scenario.as_ref())?;
    secrets.extend(input_secrets);
    if let Some(scenario) = &scenario {
        scenario.require_variables(&vars)?;
    }
    let transport = CliTransport::new(args)?;
    plan.client_certs = transport.settings.client_certs.clone();
    secrets.extend(network::secrets(&transport.settings));
    let color = std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let mut report = report::Report::new(plan.iteration_count(), color, secrets);
    if let Some(scenario) = &scenario {
        report.protect_variables(&scenario.required_variables);
    }
    let report = Mutex::new(report);
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
    .await?;
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

/// The workspace's «ask on send» fields and the values given for them. No person is
/// there to ask, so a step with a missing value fails. Returns the values to redact.
fn plan_inputs(
    plan: &mut RunPlan,
    root: &Path,
    args: &RunArgs,
    secrets: &mut Vec<String>,
) -> Result<(), String> {
    plan.inputs = inputs::load(root)?;
    plan.input_mode = InputMode::Fail;
    let mut given: Vec<(String, String)> = std::env::vars()
        .filter_map(|(name, value)| {
            let name = name.strip_prefix(INPUT_PREFIX).filter(|n| !n.is_empty())?;
            Some((name.to_string(), value))
        })
        .collect();
    given.extend(args.inputs.iter().cloned());
    for (name, value) in given {
        let Some(def) = plan.inputs.get(&name) else {
            return Err(format!(
                "--input {name}: not an «ask on send» variable of this workspace (.bonk/inputs.json)"
            ));
        };
        let mut value = def.normalize(&value);
        def.check(&value)
            .map_err(|e| format!("--input {name}: {e}"))?;
        if def.kind == InputKind::File {
            // Like every path flag, a relative file resolves from the shell's directory.
            let abs = std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(&value);
            if !abs.is_file() {
                return Err(format!("--input {name}: {} is not a file", abs.display()));
            }
            value = abs.to_string_lossy().into_owned();
        }
        if def.sensitive() {
            secrets.push(value.clone());
        }
        plan.input_values.insert(name, value);
    }
    Ok(())
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

/// Globals and the chosen environment from the app, `BONK_VAR_*` over the environment and
/// `--var` over the environment (as in bonk-mcp), plus the secret values to redact from
/// the output: the app's secret variables and every `BONK_VAR_*` (CI secrets go there).
fn variables(
    args: &RunArgs,
    scenario: Option<&scenarios::Scenario>,
) -> Result<(RunVars, Vec<String>), String> {
    // A portable run must not accidentally depend on this machine's app state.
    let state = args.app_state.clone().or_else(|| {
        if scenario.is_none() || args.env.is_some() {
            default_state_path()
        } else {
            None
        }
    });
    let app = app_vars::load_app_vars(state.as_deref());
    let (mut environment, mut globals, mut secrets) =
        app_vars::app_scopes(&app, args.env.as_deref(), &app_vars::keychain_secret)?;
    if let Some(scenario) = scenario {
        let overrides = environment;
        environment = scenario.variables.environment.clone();
        environment.extend(overrides);
        globals.extend(scenario.variables.globals.clone());
    }
    for (name, value) in std::env::vars() {
        if let Some(name) = name.strip_prefix(VAR_PREFIX).filter(|n| !n.is_empty()) {
            secrets.push(value.clone());
            environment.insert(name.to_string(), value);
        }
    }
    environment.extend(args.vars.iter().cloned());
    if let Some(scenario) = scenario {
        for key in &scenario.required_variables {
            if let Some(value) = environment.get(key).or_else(|| globals.get(key)) {
                secrets.push(value.clone());
            }
        }
    }
    let vars = RunVars {
        environment,
        globals,
    };
    Ok((vars, secrets))
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

/// The CLI's network: HTTP pools per identity share a run-local cookie jar;
/// gRPC is dialed per call.
struct CliTransport {
    clients: std::collections::HashMap<Option<ClientCert>, reqwest::Client>,
    settings: RequestSettings,
    timeout: Duration,
    insecure: bool,
    jar: Arc<CookieJar>,
}

impl CliTransport {
    fn new(args: &RunArgs) -> Result<Self, String> {
        let mut settings = args.network.settings(args.app_state.as_deref())?;
        if let Some(timeout) = args.timeout {
            settings.timeout_ms = timeout;
        }
        settings.validate_tls &= !args.insecure;
        let settings = settings.normalized();
        let timeout = Duration::from_millis(settings.timeout_ms);
        let jar = Arc::new(CookieJar::memory());
        let mut clients = std::collections::HashMap::new();
        // Validate every configured file before sending the first request, and keep
        // separate connection pools: a TLS client holds exactly one identity.
        for identity in std::iter::once(None).chain(settings.client_certs.iter().map(Some)) {
            let builder = reqwest::Client::builder()
                .user_agent(concat!("bonk-cli/", env!("CARGO_PKG_VERSION")))
                .cookie_provider(Arc::new(JarProvider {
                    jar: jar.clone(),
                    save: settings.cookies_save,
                    send: settings.cookies_send,
                    exclude: settings.cookies_exclude.clone(),
                }));
            let client = http_client::configure(builder, &settings, identity)?
                .build()
                .map_err(|e| format!("HTTP client: {e}"))?;
            clients.insert(identity.cloned(), client);
        }
        Ok(Self {
            clients,
            insecure: !settings.validate_tls,
            settings,
            timeout,
            jar,
        })
    }
}

impl Transport for CliTransport {
    type Grpc = (GrpcTarget, GrpcDescriptorCache);

    async fn send_http(&self, request: HttpRequest) -> Result<HttpResponse, String> {
        let host = reqwest::Url::parse(&bonk_core::domain::url::normalize_url(&request.url))
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_default();
        let identity = pick_client_cert(&self.settings.client_certs, &host).cloned();
        let client = self
            .clients
            .get(&identity)
            .ok_or("HTTP client identity was not configured")?;
        http::http_send(
            client.clone(),
            request,
            self.settings.clone(),
            Some(&self.jar),
        )
        .await
    }

    fn script_cookies(&self, url: &str, response: Option<&HttpResponse>) -> Vec<(String, String)> {
        self.jar
            .script_cookies(url, response.map_or(&[], |r| r.cookies.as_slice()))
    }
    fn clear_script_cookies(&self, url: &str) {
        self.jar.clear_for_url(url);
    }

    async fn grpc_open(&self, mut target: GrpcTarget) -> Result<Self::Grpc, String> {
        target.tls.insecure |= self.insecure;
        target.tls.ca_paths.extend(self.settings.ca_paths.clone());
        target.tls.disable_system_cas |= !self.settings.trust_system_cas;
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
        // Atomic counter guarantees a unique path per test even when parallel
        // tests call this within the same clock tick.
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "bonk-cli-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
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
            iterations: Some(1),
            timeout: Some(5_000),
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

    fn parsed_run(root: &Path, flags: &[&str]) -> RunArgs {
        let mut argv = vec![
            "bonk".to_string(),
            "run".into(),
            "--workspace".into(),
            root.to_string_lossy().into_owned(),
        ];
        argv.extend(flags.iter().map(|s| s.to_string()));
        match Cli::try_parse_from(argv).unwrap().command {
            Command::Run(args) => *args,
            _ => unreachable!(),
        }
    }

    fn write_request(root: &Path, url: &str, script: &str) {
        std::fs::write(
            root.join("request.bonk.json"),
            serde_json::json!({
                "name": "network", "protocol": "http", "request": {
                    "method": "GET", "url": url, "testScript": script
                }
            })
            .to_string(),
        )
        .unwrap();
    }

    /// Verifies the handshake on both HTTP/1.1 and the gRPC connector (h2).
    async fn mtls_server(h2: bool) -> (String, tokio::task::JoinHandle<()>) {
        use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(CertificateDer::from_pem_slice(include_bytes!("testdata/ca.pem")).unwrap())
            .unwrap();
        let verifier = rustls::server::WebPkiClientVerifier::builder_with_provider(
            Arc::new(roots),
            provider.clone(),
        )
        .build()
        .unwrap();
        let mut config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_client_cert_verifier(verifier)
            .with_single_cert(
                vec![
                    CertificateDer::from_pem_slice(include_bytes!("testdata/server.pem")).unwrap(),
                ],
                PrivateKeyDer::from_pem_slice(include_bytes!("testdata/server.key")).unwrap(),
            )
            .unwrap();
        config.alpn_protocols = if h2 {
            vec![b"h2".to_vec()]
        } else {
            vec![b"http/1.1".to_vec()]
        };
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = format!("https://127.0.0.1:{port}");
        let task = tokio::spawn(async move {
            loop {
                let (socket, _) = listener.accept().await.unwrap();
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    let Ok(mut socket) = acceptor.accept(socket).await else {
                        return;
                    };
                    let mut buf = [0; 8192];
                    let Ok(n) = socket.read(&mut buf).await else {
                        return;
                    };
                    if h2 && n > 0 {
                        // An empty HTTP/2 SETTINGS frame is enough for the connector
                        // handshake; this test intentionally makes no RPC.
                        let _ = socket.write_all(&[0, 0, 0, 4, 0, 0, 0, 0, 0]).await;
                        let _ = socket.read(&mut buf).await;
                    } else if buf[..n].starts_with(b"GET /redirect ") {
                        let reply = format!("HTTP/1.1 302 Found\r\nlocation: https://localhost:{port}/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                        let _ = socket.write_all(reply.as_bytes()).await;
                    } else if n > 0 && buf[..n].starts_with(b"GET ") {
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}").await;
                    }
                });
            }
        });
        (url, task)
    }

    #[tokio::test]
    async fn cli_ca_and_host_scoped_identities_perform_real_tls_handshakes() {
        let root = temp_dir();
        let files = root.join("tls files");
        std::fs::create_dir(&files).unwrap();
        for (name, bytes) in [
            ("ca.pem", include_bytes!("testdata/ca.pem").as_slice()),
            (
                "client.pem",
                include_bytes!("testdata/client.pem").as_slice(),
            ),
            (
                "client.key",
                include_bytes!("testdata/client.key").as_slice(),
            ),
            (
                "client.p12",
                include_bytes!("testdata/client.p12").as_slice(),
            ),
        ] {
            std::fs::write(files.join(name), bytes).unwrap();
        }
        let (url, task) = mtls_server(false).await;
        write_request(&root, &url, "");
        let ca = files.join("ca.pem").to_string_lossy().into_owned();
        let cert = files.join("client.pem").to_string_lossy().into_owned();
        let key = files.join("client.key").to_string_lossy().into_owned();
        let p12 = files.join("client.p12").to_string_lossy().into_owned();
        let flags = [
            "--no-proxy",
            "--timeout",
            "2000",
            "--cacert",
            &ca,
            "--no-system-ca",
            "--cert",
            &cert,
            "--key",
            &key,
            "--cert-host",
            "127.0.0.1",
        ];
        let args = parsed_run(&root, &flags);
        assert_eq!(run(&args).await, Ok(true));
        // A trusted CA alone cannot satisfy client auth; a client identity alone
        // cannot make an untrusted server certificate pass validation.
        assert_eq!(
            run(&parsed_run(
                &root,
                &[
                    "--no-proxy",
                    "--timeout",
                    "2000",
                    "--cacert",
                    &ca,
                    "--no-system-ca"
                ]
            ))
            .await,
            Ok(false)
        );
        assert_eq!(
            run(&parsed_run(
                &root,
                &[
                    "--no-proxy",
                    "--timeout",
                    "2000",
                    "--no-system-ca",
                    "--cert",
                    &cert,
                    "--key",
                    &key
                ]
            ))
            .await,
            Ok(false)
        );
        let mut wrong_host = parsed_run(&root, &flags);
        wrong_host.network.cert_host = "other.test".into();
        assert_eq!(run(&wrong_host).await, Ok(false));
        assert_eq!(
            run(&parsed_run(
                &root,
                &[
                    "--no-proxy",
                    "--cacert",
                    &ca,
                    "--no-system-ca",
                    "--p12",
                    &p12,
                    "--p12-password",
                    "test-bundle-password"
                ]
            ))
            .await,
            Ok(true)
        );
        let config = files.join("network.json");
        std::fs::write(&config, r#"{"proxy":{"mode":"none"},"caPaths":["ca.pem"],"trustSystemCas":false,"clientCerts":[{"host":"127.0.0.1","certPath":"client.pem","keyPath":"client.key"}]}"#).unwrap();
        assert_eq!(
            run(&parsed_run(
                &root,
                &["--network-settings", &config.to_string_lossy()]
            ))
            .await,
            Ok(true)
        );
        let state = root.join("state.json");
        std::fs::write(
            &state,
            serde_json::json!({
                "proxyMode":"none", "trustedCaPaths":[ca], "trustSystemCas":false,
                "clientCerts":[{"host":"127.0.0.1","certPath":cert,"keyPath":key}]
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(
            run(&parsed_run(
                &root,
                &["--app-state", &state.to_string_lossy()]
            ))
            .await,
            Ok(true)
        );
        // Redirects must not reuse a host-restricted identity for a different host.
        write_request(&root, &format!("{url}/redirect"), "pm.test('stopped at identity boundary', function() { pm.expect(pm.response.code).to.equal(302); });");
        assert_eq!(run(&args).await, Ok(true));
        // Same CA/identity via the unary gRPC connector, without a fake transport.
        let (grpc_url, grpc_task) = mtls_server(true).await;
        let tls = bonk_core::domain::grpc::GrpcTls {
            ca_paths: vec![ca],
            disable_system_cas: true,
            client_cert: Some(cert),
            client_key: Some(key),
            ..Default::default()
        };
        assert!(bonk_core::application::grpc_native::connect_with(
            &grpc_url,
            false,
            &tls,
            &Default::default()
        )
        .await
        .is_ok());
        let untrusted = bonk_core::domain::grpc::GrpcTls {
            ca_paths: Vec::new(),
            ..tls
        };
        assert!(bonk_core::application::grpc_native::connect_with(
            &grpc_url,
            false,
            &untrusted,
            &Default::default()
        )
        .await
        .is_err());
        grpc_task.abort();
        task.abort();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cli_proxy_routes_authenticates_bypasses_and_redacts() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let root = temp_dir();
        let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = proxy.local_addr().unwrap().to_string();
        let task = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut socket, _) = proxy.accept().await.unwrap();
                let mut buf = [0; 8192];
                let n = socket.read(&mut buf).await.unwrap();
                let request = String::from_utf8_lossy(&buf[..n]);
                assert!(
                    request.starts_with("GET http://bonk-proxy.invalid/path HTTP/1.1"),
                    "{request}"
                );
                assert!(
                    request.contains("proxy-authorization: Basic dXNlcjp0ZXN0LXByb3h5LXBhc3N3b3Jk"),
                    "{request}"
                );
                let body = r#"{"proxyAuth":"dXNlcjp0ZXN0LXByb3h5LXBhc3N3b3Jk"}"#;
                let reply = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        write_request(&root, "http://bonk-proxy.invalid/path", "console.log(pm.response.json().proxyAuth); pm.test('test-proxy-password', function() { pm.expect(pm.response.code).to.equal(200); });");
        let json = root.join("report.json");
        let junit = root.join("report.xml");
        let proxy_url = format!("http://user:test%2Dproxy%2Dpassword@{addr}");
        let json_path = json.to_string_lossy();
        let junit_path = junit.to_string_lossy();
        for mut flags in [
            vec![
                "--proxy",
                &addr,
                "--proxy-user",
                "user",
                "--proxy-password",
                "test-proxy-password",
            ],
            vec!["--proxy", &proxy_url],
        ] {
            flags.extend(["--json", &json_path, "--junit", &junit_path]);
            assert_eq!(run(&parsed_run(&root, &flags)).await, Ok(true));
            for path in [&json, &junit] {
                let report = std::fs::read_to_string(path).unwrap();
                assert!(!report.contains("test-proxy-password"), "{report}");
                assert!(
                    !report.contains("dXNlcjp0ZXN0LXByb3h5LXBhc3N3b3Jk"),
                    "{report}"
                );
                if report.starts_with('{') {
                    assert!(report.contains("redacted"), "{report}");
                }
            }
        }
        task.await.unwrap();
        write_request(&root, &echo_auth_server().await, "");
        // Closed proxy port: these succeed only if no-proxy / bypass take effect.
        assert_eq!(
            run(&parsed_run(
                &root,
                &["--proxy", &addr, "--proxy-bypass", "127.0.0.1"]
            ))
            .await,
            Ok(true)
        );
        let config = root.join("network.json");
        std::fs::write(
            &config,
            serde_json::json!({"proxy":{"mode":"manual","url":addr}}).to_string(),
        )
        .unwrap();
        assert_eq!(
            run(&parsed_run(
                &root,
                &[
                    "--network-settings",
                    &config.to_string_lossy(),
                    "--proxy",
                    &addr,
                    "--no-proxy"
                ]
            ))
            .await,
            Ok(true)
        );
        let bad = parsed_run(&root, &["--cacert", "/nonexistent/ca.pem"]);
        assert!(run(&bad).await.unwrap_err().contains("CA certificate"));
        assert!(Cli::try_parse_from(["bonk", "run", "--cert", "client.pem"]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cli_socks5h_routes_without_local_dns() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let root = temp_dir();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!("socks5h://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut greeting = [0; 2];
            socket.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting[0], 5, "client must speak SOCKS5");
            let mut methods = vec![0; usize::from(greeting[1])];
            socket.read_exact(&mut methods).await.unwrap();
            assert!(methods.contains(&0));
            socket.write_all(&[5, 0]).await.unwrap();
            let mut connect = [0; 5];
            socket.read_exact(&mut connect).await.unwrap();
            assert_eq!(&connect[..4], &[5, 1, 0, 3]);
            let mut host = vec![0; usize::from(connect[4])];
            socket.read_exact(&mut host).await.unwrap();
            assert_eq!(host, b"bonk-socks.invalid");
            let mut port = [0; 2];
            socket.read_exact(&mut port).await.unwrap();
            assert_eq!(u16::from_be_bytes(port), 80);
            socket
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 80])
                .await
                .unwrap();
            let mut request = [0; 8192];
            let n = socket.read(&mut request).await.unwrap();
            assert!(request[..n].starts_with(b"GET /health HTTP/1.1"));
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}")
                .await
                .unwrap();
        });
        write_request(&root, "http://bonk-socks.invalid/health", "");
        assert_eq!(
            run(&parsed_run(
                &root,
                &["--proxy", &proxy, "--timeout", "2000"]
            ))
            .await,
            Ok(true)
        );
        task.await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
