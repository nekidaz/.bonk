mod redact;
mod request_prep;
mod runtime;
mod server;
mod types;
mod vars;

use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use anyhow::{bail, Context, Result};
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use clap::{Args, Parser, Subcommand};
use rmcp::{
    transport::{
        stdio,
        streamable_http_server::{
            session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
        },
    },
    ServiceExt,
};
use subtle::ConstantTimeEq;

use crate::{
    runtime::{BonkRuntime, MethodPolicy, RuntimeConfig},
    server::BonkMcpServer,
};

const MIN_BODY_BYTES: usize = 1024 * 1024;
const MAX_BODY_BYTES: usize = 250 * 1024 * 1024;

#[derive(Debug, Parser)]
#[command(
    name = "bonk-mcp",
    version,
    about = "Expose a Bonk API workspace to MCP-compatible AI clients"
)]
struct Cli {
    /// Existing Bonk workspace directory containing *.bonk.json files.
    #[arg(long, value_name = "DIR")]
    workspace: PathBuf,

    /// Disable every workspace mutation tool.
    #[arg(long, global = true)]
    read_only: bool,

    /// Permit explicit reads of literal credentials stored in request files.
    #[arg(long, global = true)]
    expose_secrets: bool,

    /// Disable HTTP/gRPC calls and reflection. Local proto inspection remains available.
    #[arg(long, global = true)]
    no_network: bool,

    /// Allow API calls only to this hostname, hostname:port, or *.domain pattern. Repeatable.
    #[arg(long = "target-host", value_name = "HOST", global = true)]
    target_hosts: Vec<String>,

    /// Explicitly allow all API target hosts. Required for a public HTTP listener without --target-host.
    #[arg(long, global = true)]
    allow_all_targets: bool,

    /// Process variables with this prefix become {{NAME}} values without being exposed to the model.
    #[arg(long, default_value = "BONK_VAR_", global = true)]
    variable_prefix: String,

    /// Hard ceiling for returned HTTP response bodies.
    #[arg(
        long,
        default_value_t = 25 * 1024 * 1024,
        global = true
    )]
    max_response_body_bytes: usize,

    /// Bonk app state.json whose globals and environments resolve {{NAME}} values.
    #[arg(long, value_name = "FILE", global = true)]
    app_state: Option<PathBuf>,

    /// App environment name the model may select. Repeatable; others are denied.
    #[arg(long = "environment", value_name = "NAME", global = true)]
    environments: Vec<String>,

    /// Policy for HTTP POST, PUT, PATCH and DELETE.
    #[arg(long, value_enum, default_value = "ask", global = true)]
    mutating_methods: MethodPolicy,

    /// Id of the AI client launching this server, recorded in the journal.
    #[arg(long, value_name = "ID", global = true)]
    client: Option<String>,

    /// Append one JSON line per tool call to this file.
    #[arg(long, value_name = "FILE", global = true)]
    journal: Option<PathBuf>,

    #[command(subcommand)]
    transport: Option<Transport>,
}

#[derive(Debug, Subcommand)]
enum Transport {
    /// Run as a local STDIO MCP server (default).
    Stdio,
    /// Run as a Streamable HTTP MCP server at /mcp.
    Http(HttpArgs),
}

#[derive(Debug, Args)]
struct HttpArgs {
    /// Address to listen on.
    #[arg(long, default_value = "127.0.0.1:8000")]
    bind: SocketAddr,

    /// Accepted inbound Host header (domain or domain:port). Repeat for reverse-proxy aliases.
    #[arg(long = "mcp-host", value_name = "HOST")]
    mcp_hosts: Vec<String>,

    /// Accepted browser Origin including scheme. Missing Origin headers are allowed.
    #[arg(long = "origin", value_name = "ORIGIN")]
    origins: Vec<String>,

    /// Name of the environment variable containing the bearer token. Required for non-loopback bind.
    #[arg(long, default_value = "BONK_MCP_TOKEN")]
    auth_token_env: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    if !(MIN_BODY_BYTES..=MAX_BODY_BYTES).contains(&cli.max_response_body_bytes) {
        bail!("--max-response-body-bytes must be between {MIN_BODY_BYTES} and {MAX_BODY_BYTES}");
    }
    let root = cli
        .workspace
        .canonicalize()
        .with_context(|| format!("workspace does not exist: {}", cli.workspace.display()))?;
    if !root.is_dir() {
        bail!("workspace is not a directory: {}", root.display());
    }
    validate_target_patterns(&cli.target_hosts)?;
    if cli.allow_all_targets && !cli.target_hosts.is_empty() {
        bail!("use either --allow-all-targets or --target-host, not both");
    }
    let target_hosts_empty = cli.target_hosts.is_empty();
    let no_network = cli.no_network;
    let allow_all_targets = cli.allow_all_targets;

    let runtime = BonkRuntime::new(RuntimeConfig {
        root,
        read_only: cli.read_only,
        expose_secrets: cli.expose_secrets,
        network_enabled: !cli.no_network,
        target_hosts: cli.target_hosts,
        variable_prefix: cli.variable_prefix,
        max_response_body_bytes: cli.max_response_body_bytes,
        app_state: cli.app_state,
        environments: cli.environments,
        mutating_methods: cli.mutating_methods,
        client: cli.client,
        journal: cli.journal,
    });
    let server = BonkMcpServer::new(runtime);

    match cli.transport.unwrap_or(Transport::Stdio) {
        Transport::Stdio => run_stdio(server).await,
        Transport::Http(http) => {
            if !http.bind.ip().is_loopback()
                && !no_network
                && !allow_all_targets
                && target_hosts_empty
            {
                bail!(
                    "a non-loopback MCP listener requires at least one --target-host, or the explicit --allow-all-targets flag"
                );
            }
            run_http(server, http).await
        }
    }
}

async fn run_stdio(server: BonkMcpServer) -> Result<()> {
    eprintln!("bonk-mcp {}: STDIO server ready", env!("CARGO_PKG_VERSION"));
    let service = server.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

async fn run_http(server: BonkMcpServer, args: HttpArgs) -> Result<()> {
    let token = std::env::var(&args.auth_token_env)
        .ok()
        .filter(|value| !value.is_empty());
    if !args.bind.ip().is_loopback() && token.is_none() {
        bail!(
            "environment variable {} must contain a bearer token for a non-loopback listener",
            args.auth_token_env
        );
    }
    if !args.bind.ip().is_loopback() && args.mcp_hosts.is_empty() {
        bail!(
            "a non-loopback listener requires at least one --mcp-host for DNS-rebinding protection"
        );
    }

    let mut allowed_hosts = vec!["localhost".into(), "127.0.0.1".into(), "::1".into()];
    allowed_hosts.extend(args.mcp_hosts);
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_allowed_hosts(allowed_hosts)
        .with_allowed_origins(args.origins);
    let service = StreamableHttpService::new(
        move || Ok(server.clone()),
        LocalSessionManager::default().into(),
        config,
    );
    let mut router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest_service("/mcp", service);
    if let Some(token) = token {
        router = router.layer(middleware::from_fn_with_state(
            Arc::new(token),
            require_bearer,
        ));
    }

    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    eprintln!("bonk-mcp listening on http://{}/mcp", args.bind);
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

async fn require_bearer(
    State(expected): State<Arc<String>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let provided = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let authorized = provided.is_some_and(|provided| {
        provided.len() == expected.len()
            && bool::from(provided.as_bytes().ct_eq(expected.as_bytes()))
    });
    if authorized {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, "missing or invalid bearer token").into_response()
    }
}

fn validate_target_patterns(patterns: &[String]) -> Result<()> {
    for pattern in patterns {
        if pattern.is_empty()
            || pattern.contains("//")
            || pattern.contains('/')
            || pattern.chars().any(char::is_whitespace)
        {
            bail!("invalid --target-host pattern: {pattern}");
        }
    }
    Ok(())
}
