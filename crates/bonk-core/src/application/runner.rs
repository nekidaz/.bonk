//! Collection Runner: saved requests (HTTP + gRPC) through pre-request script, `{{vars}}`,
//! the network and the test script, iteration after iteration. Script writes to the
//! environment/globals carry over to the next request. The app runs collections and Flow
//! request blocks through this (src-tauri `runner_run`); a CLI can do the same.
//!
//! The network comes in through `Transport`, the way a Go function takes an interface:
//! the app's sends through its proxy/mTLS/cookie settings and gRPC connection cache.

use std::{
    collections::BTreeMap,
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::scripts;
use crate::domain::{
    grpc::{GrpcResult, GrpcTls},
    http::{pick_client_cert, ClientCert, HttpRequest, HttpResponse},
    request_prep::{self, Scope},
    workspace::RequestNode,
};

/// Environment + globals of a run. Scripts change them as the run goes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RunVars {
    #[serde(default)]
    pub environment: Scope,
    #[serde(default)]
    pub globals: Scope,
}

impl RunVars {
    /// `{{var}}` scope: iteration data over environment over globals (`pm.variables.get`).
    fn scope(&self, data: &Scope) -> Scope {
        let mut scope = self.globals.clone();
        scope.extend(self.environment.clone());
        scope.extend(data.clone());
        scope
    }
}

/// What to run. Request auth is already effective (own or the folder's).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPlan {
    pub requests: Vec<RequestNode>,
    /// Ignored when `data_rows` is set: one iteration per row then.
    #[serde(default)]
    pub iterations: u32,
    #[serde(default)]
    pub data_rows: Vec<Scope>,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default)]
    pub stop_on_failure: bool,
    /// Resolves workspace-relative `.proto` paths.
    #[serde(default)]
    pub workspace_root: String,
    /// The global `-I` list (Settings → gRPC), after each request's own imports.
    #[serde(default)]
    pub global_import_paths: Vec<String>,
    /// Settings client identities: a gRPC request without its own takes the one for its host.
    #[serde(default)]
    pub client_certs: Vec<ClientCert>,
}

impl RunPlan {
    pub fn iteration_count(&self) -> u32 {
        if self.data_rows.is_empty() {
            self.iterations.max(1)
        } else {
            self.data_rows.len() as u32
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_line: Option<u32>,
}

/// HTTP status code, or gRPC status text (`OK`, `ERR`…).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum RowStatus {
    Code(u16),
    Text(String),
}

/// One executed request (the app's `RunResultRow`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResultRow {
    pub id: String,
    /// 1-based.
    pub iteration: u32,
    pub request_name: String,
    pub protocol: String,
    /// HTTP method, or `gRPC`.
    pub method: String,
    /// Resolved URL (HTTP) or `endpoint · Method` (gRPC).
    pub target: String,
    pub status: RowStatus,
    /// Transport ok, no fatal script error, every test passed.
    pub ok: bool,
    pub elapsed_ms: u64,
    pub tests: Vec<ScriptTest>,
    pub logs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<String>,
    pub node_id: String,
    /// Start within its iteration, pauses and delays excluded (the waterfall).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_offset_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<usize>,
    /// When the call finished, ms since the run started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u64>,
}

/// What scripts changed, for the caller to keep (the app folds it into its stores).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VarWrites {
    pub env_set: Scope,
    pub env_unset: Vec<String>,
    pub globals_set: Scope,
    pub globals_unset: Vec<String>,
    /// URLs whose cookies `pm.cookies.jar().clear(url)` asked to delete.
    pub cookie_clears: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    /// An iteration started, `at_ms` after the run did.
    #[serde(rename_all = "camelCase")]
    Iteration {
        index: u32,
        at_ms: u64,
    },
    /// A request is about to go out.
    #[serde(rename_all = "camelCase")]
    Call {
        node_id: String,
        name: String,
        method: String,
    },
    Vars(VarWrites),
    Row(Box<RunResultRow>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Done,
    Stopped,
}

/// Pause / stop from outside while a run is going (`RunControl` is shared with the caller).
#[derive(Debug, Default)]
pub struct RunControl {
    paused: AtomicBool,
    stopped: AtomicBool,
}

impl RunControl {
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    /// The call in flight finishes; nothing after it is sent.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }

    fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Relaxed)
    }

    /// Wait out a pause; true when the run should stop instead.
    async fn hold_or_stop(&self) -> bool {
        while self.paused.load(Ordering::Relaxed) && !self.stopped() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.stopped()
    }
}

/// Where a gRPC call's schema comes from.
#[derive(Debug, Clone, PartialEq)]
pub enum GrpcSchema {
    Reflection,
    /// Absolute `.proto` files and import roots.
    Proto {
        files: Vec<String>,
        imports: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct GrpcTarget {
    pub endpoint: String,
    pub plaintext: bool,
    pub tls: GrpcTls,
    pub schema: GrpcSchema,
}

/// The network side of a run.
pub trait Transport: Sync {
    /// An open gRPC connection with its schema loaded.
    type Grpc: Send + Sync;

    fn send_http(
        &self,
        request: HttpRequest,
    ) -> impl Future<Output = Result<HttpResponse, String>> + Send;

    /// Dial and load the schema; runs before the pre-request script, like the app's editor.
    fn grpc_open(
        &self,
        target: GrpcTarget,
    ) -> impl Future<Output = Result<Self::Grpc, String>> + Send;

    fn grpc_call(
        &self,
        conn: &Self::Grpc,
        method: &str,
        message: &str,
        metadata: &BTreeMap<String, String>,
    ) -> impl Future<Output = Result<GrpcResult, String>> + Send;

    /// `pm.cookies` for `url`, as `(name, value)`; none without a cookie jar.
    fn script_cookies(
        &self,
        _url: &str,
        _response: Option<&HttpResponse>,
    ) -> Vec<(String, String)> {
        Vec::new()
    }
}

/// Run every request of `plan`, `iteration_count` times, streaming progress to `emit`.
/// Never fails: a request that can't be sent becomes an `ok: false` row.
pub async fn run_collection<T: Transport>(
    plan: &RunPlan,
    vars: &mut RunVars,
    transport: &T,
    control: &RunControl,
    emit: &(dyn Fn(RunEvent) + Sync),
) -> RunStatus {
    let iterations = plan.iteration_count();
    let started = Instant::now();
    let no_data = Scope::new();
    for index in 1..=iterations {
        let data = plan.data_rows.get(index as usize - 1).unwrap_or(&no_data);
        let iteration_start = Instant::now();
        emit(RunEvent::Iteration {
            index,
            at_ms: millis(started.elapsed()),
        });
        // Time spent paused or in the configured delay: kept out of the waterfall.
        let mut idle = Duration::ZERO;
        for (j, node) in plan.requests.iter().enumerate() {
            let held = Instant::now();
            if control.hold_or_stop().await {
                return RunStatus::Stopped;
            }
            idle += held.elapsed();
            emit(RunEvent::Call {
                node_id: node.id.clone(),
                name: node.name.clone(),
                method: display_method(node),
            });
            let start_offset = iteration_start.elapsed().saturating_sub(idle);
            let mut row = run_node(plan, node, index, data, vars, transport, emit).await;
            row.start_offset_ms = Some(millis(start_offset));
            row.end_ms = Some(millis(started.elapsed()));
            let ok = row.ok;
            emit(RunEvent::Row(Box::new(row)));
            if control.stopped() || (plan.stop_on_failure && !ok) {
                return RunStatus::Stopped;
            }
            let last = index == iterations && j + 1 == plan.requests.len();
            if plan.delay_ms > 0 && !last {
                let slept = Instant::now();
                tokio::time::sleep(Duration::from_millis(plan.delay_ms)).await;
                idle += slept.elapsed();
            }
        }
    }
    RunStatus::Done
}

/// Run one saved request; script writes land in `vars` and go out as `RunEvent::Vars`.
pub async fn run_node<T: Transport>(
    plan: &RunPlan,
    node: &RequestNode,
    iteration: u32,
    data: &Scope,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
) -> RunResultRow {
    let mut ctx = NodeRun {
        data,
        vars,
        emit,
        tests: Vec::new(),
        logs: Vec::new(),
    };
    if node.protocol == "grpc" {
        ctx.grpc(plan, node, iteration, transport).await
    } else {
        ctx.http(node, iteration, transport).await
    }
}

fn display_method(node: &RequestNode) -> String {
    if node.protocol == "grpc" {
        "gRPC".into()
    } else {
        node.request.method.clone()
    }
}

fn millis(d: Duration) -> u64 {
    d.as_millis().try_into().unwrap_or(u64::MAX)
}

/// What a request's pipeline produced, before it becomes a row.
struct Outcome {
    status: RowStatus,
    /// Transport-level success (HTTP 2xx is judged by the caller).
    ok: bool,
    elapsed_ms: u64,
    error: Option<String>,
    body: Option<String>,
    size: Option<usize>,
}

impl Outcome {
    /// The pre-request script failed: nothing was sent.
    fn not_sent(status: RowStatus, error: String) -> Self {
        Self {
            status,
            ok: false,
            elapsed_ms: 0,
            error: Some(error),
            body: None,
            size: None,
        }
    }
}

/// One request's run: the scope it reads and the tests/logs its scripts leave.
struct NodeRun<'a> {
    data: &'a Scope,
    vars: &'a mut RunVars,
    emit: &'a (dyn Fn(RunEvent) + Sync),
    tests: Vec<ScriptTest>,
    logs: Vec<String>,
}

impl NodeRun<'_> {
    async fn http<T: Transport>(
        &mut self,
        node: &RequestNode,
        iteration: u32,
        transport: &T,
    ) -> RunResultRow {
        let url = match node.params.as_deref() {
            Some(params) if !params.is_empty() => {
                request_prep::sync_url_with_params(&node.request.url, params)
            }
            _ => node.request.url.clone(),
        };
        let target = request_prep::resolve_text(&url, &self.vars.scope(self.data));
        let outcome = self.http_pipeline(node, transport).await;
        self.row(node, iteration, target, outcome, |o| match o.status {
            RowStatus::Code(code) => o.ok && (200..300).contains(&code),
            RowStatus::Text(_) => false,
        })
    }

    async fn http_pipeline<T: Transport>(
        &mut self,
        node: &RequestNode,
        transport: &T,
    ) -> Result<Outcome, String> {
        let mut request = node.request.clone();
        request_prep::materialize(&mut request, node.params.as_deref());
        if let Some(code) = script(&request.pre_request_script) {
            let mut probe = request.clone();
            request_prep::resolve(&mut probe, &self.vars.scope(self.data))?;
            let cookies = transport.script_cookies(&probe.url, None);
            let context = self.http_context(&request, None, &cookies);
            let pre = self.run_script("pre-request", code, context).await?;
            if let Some(error) = pre.error {
                return Ok(Outcome::not_sent(RowStatus::Code(0), error));
            }
            pre.request_patch.unwrap_or_default().apply(&mut request);
        }
        let mut resolved = request.clone();
        request_prep::resolve(&mut resolved, &self.vars.scope(self.data))?;
        let response = transport.send_http(resolved.clone()).await?;
        let mut error = None;
        if let Some(code) = script(&request.test_script) {
            let cookies = transport.script_cookies(&resolved.url, Some(&response));
            let context = self.http_context(&resolved, Some(&response), &cookies);
            error = self.run_script("test", code, context).await?.error;
        }
        Ok(Outcome {
            status: RowStatus::Code(response.status),
            ok: true,
            elapsed_ms: response.elapsed_ms,
            error,
            body: Some(response.body),
            size: Some(response.size_bytes),
        })
    }

    async fn grpc<T: Transport>(
        &mut self,
        plan: &RunPlan,
        node: &RequestNode,
        iteration: u32,
        transport: &T,
    ) -> RunResultRow {
        let grpc = node.grpc.as_ref();
        let endpoint = request_prep::resolve_text(
            grpc.map_or("", |g| g.endpoint.as_str()),
            &self.vars.scope(self.data),
        );
        let method = grpc.and_then(|g| g.method.as_deref()).unwrap_or_default();
        let short = method.rsplit('.').next().unwrap_or(method);
        let target = format!("{endpoint} · {short}").trim().to_string();
        let outcome = match grpc {
            Some(g) if !g.endpoint.trim().is_empty() && !method.is_empty() => {
                self.grpc_pipeline(plan, g, &endpoint, method, transport)
                    .await
            }
            _ => Err("gRPC request has no endpoint or method".into()),
        };
        self.row(node, iteration, target, outcome, |o| o.ok)
    }

    async fn grpc_pipeline<T: Transport>(
        &mut self,
        plan: &RunPlan,
        g: &crate::domain::workspace::GrpcTabState,
        endpoint: &str,
        method: &str,
        transport: &T,
    ) -> Result<Outcome, String> {
        let root = plan.workspace_root.as_str();
        let schema = if g.source.as_deref() == Some("proto") {
            let abs = |paths: &Option<Vec<String>>| -> Vec<String> {
                paths.iter().flatten().map(|p| to_abs(p, root)).collect()
            };
            let mut imports = abs(&g.import_paths);
            for path in &plan.global_import_paths {
                if !imports.contains(path) {
                    imports.push(path.clone());
                }
            }
            GrpcSchema::Proto {
                files: abs(&g.proto_paths),
                imports,
            }
        } else {
            GrpcSchema::Reflection
        };
        let conn = transport
            .grpc_open(GrpcTarget {
                endpoint: endpoint.to_string(),
                plaintext: g.plaintext,
                tls: grpc_tls_for(endpoint, g.tls.clone(), &plan.client_certs).unwrap_or_default(),
                schema,
            })
            .await?;

        let mut message = g.message.clone();
        let mut metadata = g.metadata.clone();
        if let Some(code) = script(&g.pre_request_script) {
            let context = self.grpc_context(method, endpoint, &message, &metadata, None);
            let pre = self.run_script("pre-request", code, context).await?;
            if let Some(error) = pre.error {
                return Ok(Outcome::not_sent(RowStatus::Text("ERR".into()), error));
            }
            // The endpoint is already dialed: a script can't move it.
            let patch = pre.request_patch.unwrap_or_default();
            if let Some(body) = patch.body {
                message = body;
            }
            if let Some(headers) = patch.headers {
                metadata = headers;
            }
        }
        let strip_authorization = g.plaintext && !g.keep_auth_on_plaintext.unwrap_or(false);
        let outgoing = request_prep::grpc_prepare(
            g.auth.as_ref(),
            &message,
            &metadata,
            &self.vars.scope(self.data),
            strip_authorization,
        );
        let result = transport
            .grpc_call(&conn, method, &outgoing.message, &outgoing.metadata)
            .await?;
        let mut error = None;
        if let Some(code) = script(&g.test_script) {
            let context = self.grpc_context(
                method,
                endpoint,
                &outgoing.message,
                &outgoing.metadata,
                Some(&result),
            );
            error = self.run_script("test", code, context).await?.error;
        }
        Ok(Outcome {
            status: RowStatus::Text(result.status),
            ok: result.ok,
            elapsed_ms: result.elapsed_ms,
            error,
            body: Some(result.body),
            size: Some(result.size_bytes),
        })
    }

    /// The row for `outcome`; a pipeline error is an `ERR` row without the scripts' output.
    fn row(
        &mut self,
        node: &RequestNode,
        iteration: u32,
        target: String,
        outcome: Result<Outcome, String>,
        transport_ok: impl Fn(&Outcome) -> bool,
    ) -> RunResultRow {
        let outcome = outcome.unwrap_or_else(|error| {
            self.tests.clear();
            self.logs.clear();
            Outcome::not_sent(RowStatus::Text("ERR".into()), error)
        });
        let tests_ok = self.tests.iter().all(|t| t.passed);
        RunResultRow {
            id: new_id(),
            iteration,
            request_name: node.name.clone(),
            protocol: if node.protocol == "grpc" {
                "grpc"
            } else {
                "http"
            }
            .into(),
            method: display_method(node),
            target,
            ok: transport_ok(&outcome) && outcome.error.is_none() && tests_ok,
            status: outcome.status,
            elapsed_ms: outcome.elapsed_ms,
            tests: std::mem::take(&mut self.tests),
            logs: std::mem::take(&mut self.logs),
            error: outcome.error,
            response_body: outcome.body,
            node_id: node.id.clone(),
            start_offset_ms: None,
            size_bytes: outcome.size,
            end_ms: None,
        }
    }

    /// Run a script, keep its tests/logs, fold its variable writes into `vars` (and emit them).
    async fn run_script(
        &mut self,
        phase: &'static str,
        code: &str,
        context: Value,
    ) -> Result<ScriptOutput, String> {
        let code = code.to_string();
        let context = context.to_string();
        let raw = tokio::task::spawn_blocking(move || scripts::run_script(phase, &code, &context))
            .await
            .map_err(|e| format!("script task failed: {e}"))??;
        let mut out: ScriptOutput = serde_json::from_str(&raw).unwrap_or_else(|_| ScriptOutput {
            error: Some(format!(
                "script returned invalid output: {}",
                raw.chars().take(200).collect::<String>()
            )),
            ..ScriptOutput::default()
        });
        self.logs.append(&mut out.logs);
        self.tests.append(&mut out.tests);
        let writes = std::mem::take(&mut out.writes);
        for (key, value) in &writes.env_set {
            self.vars.environment.insert(key.clone(), value.clone());
        }
        for key in &writes.env_unset {
            self.vars.environment.remove(key);
        }
        for (key, value) in &writes.globals_set {
            self.vars.globals.insert(key.clone(), value.clone());
        }
        for key in &writes.globals_unset {
            self.vars.globals.remove(key);
        }
        if writes != VarWrites::default() {
            (self.emit)(RunEvent::Vars(writes));
        }
        Ok(out)
    }

    /// `buildScriptContext` in shared/model/scripts.ts.
    fn http_context(
        &self,
        request: &HttpRequest,
        response: Option<&HttpResponse>,
        cookies: &[(String, String)],
    ) -> Value {
        let mut req = Map::new();
        req.insert("method".into(), json!(request.method));
        req.insert("url".into(), json!(request.url));
        req.insert("headers".into(), json!(request.headers));
        if let Some(body) = &request.body {
            req.insert("body".into(), json!(body));
        }
        let response = response.map(|r| {
            json!({ "code": r.status, "responseTime": r.elapsed_ms, "headers": r.headers, "body": r.body })
        });
        let cookies: Vec<Value> = cookies
            .iter()
            .map(|(name, value)| json!({ "name": name, "value": value }))
            .collect();
        json!({
            "cookies": cookies,
            "request": req,
            "response": response,
            "environment": self.vars.environment,
            "globals": self.vars.globals,
            "iterationData": self.data,
        })
    }

    /// `buildGrpcScriptContext`: endpoint→url, metadata→headers, message→body; the code is
    /// 0 (OK) or 2 (UNKNOWN), close enough to `grpc.Status` for `to.have.status(0)`.
    fn grpc_context(
        &self,
        method: &str,
        endpoint: &str,
        message: &str,
        metadata: &BTreeMap<String, String>,
        result: Option<&GrpcResult>,
    ) -> Value {
        let response = result.map(|r| {
            json!({ "code": if r.ok { 0 } else { 2 }, "responseTime": r.elapsed_ms, "headers": {}, "body": r.body })
        });
        json!({
            "request": { "method": method, "url": endpoint, "headers": metadata, "body": message, "readonlyUrl": true },
            "response": response,
            "environment": self.vars.environment,
            "globals": self.vars.globals,
            "iterationData": self.data,
        })
    }
}

/// The `__out` object a script run returns (`parseScriptResult` in scripts.ts).
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ScriptOutput {
    logs: Vec<String>,
    tests: Vec<ScriptTest>,
    #[serde(flatten)]
    writes: VarWrites,
    request_patch: Option<RequestPatch>,
    error: Option<String>,
}

/// What a pre-request script changed on the outgoing request.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RequestPatch {
    url: Option<String>,
    body: Option<String>,
    headers: Option<BTreeMap<String, String>>,
}

impl RequestPatch {
    fn apply(self, request: &mut HttpRequest) {
        if let Some(url) = self.url {
            request.url = url;
        }
        if let Some(body) = self.body {
            request.body = Some(body);
        }
        if let Some(headers) = self.headers {
            request.headers = headers;
        }
    }
}

fn script(code: &Option<String>) -> Option<&str> {
    code.as_deref().filter(|code| !code.trim().is_empty())
}

fn new_id() -> String {
    format!("{:016x}{:016x}", fastrand::u64(..), fastrand::u64(..))
}

/// Per-request gRPC TLS, else the Settings client identity for the endpoint's host
/// (`grpcTlsFor` in shared/settings).
pub fn grpc_tls_for(endpoint: &str, tls: Option<GrpcTls>, certs: &[ClientCert]) -> Option<GrpcTls> {
    let set = |v: &Option<String>| v.as_deref().is_some_and(|v| !v.is_empty());
    if let Some(t) = &tls {
        if (set(&t.client_cert) && set(&t.client_key)) || set(&t.client_p12) {
            return tls;
        }
    }
    let Some(cert) = pick_client_cert(certs, &endpoint_host(endpoint)) else {
        return tls;
    };
    let mut t = tls.unwrap_or_default();
    match cert.p12_path.clone().filter(|p| !p.is_empty()) {
        Some(p12) => {
            t.client_p12 = Some(p12);
            t.client_p12_password = cert.p12_password.clone();
        }
        None => {
            t.client_cert = Some(cert.cert_path.clone());
            t.client_key = Some(cert.key_path.clone());
        }
    }
    Some(t)
}

/// Host of a gRPC endpoint (`endpointHost` in shared/settings/proxy.ts).
fn endpoint_host(endpoint: &str) -> String {
    let rest = endpoint.trim();
    let rest = rest
        .strip_prefix("http://")
        .or_else(|| rest.strip_prefix("https://"))
        .unwrap_or(rest);
    let rest = rest.split('/').next().unwrap_or_default();
    if let Some(v6) = rest.strip_prefix('[').and_then(|r| r.split_once(']')) {
        return v6.0.to_string();
    }
    rest.split(':').next().unwrap_or_default().to_string()
}

/// A stored proto path made absolute (`toAbs` in entities/request/protoPaths.ts).
fn to_abs(path: &str, root: &str) -> String {
    let b = path.as_bytes();
    let absolute = path.starts_with('/')
        || path.starts_with('\\')
        || (b.len() > 2
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && matches!(b[2], b'/' | b'\\'));
    if root.is_empty() || absolute {
        return path.to_string();
    }
    format!("{}/{path}", root.trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    type GrpcCallSeen = (String, String, BTreeMap<String, String>);

    /// Records what was sent; answers from `responses` in order (then 200 `{}`).
    #[derive(Default)]
    struct Fake {
        sent: Mutex<Vec<HttpRequest>>,
        responses: Mutex<Vec<(u16, String)>>,
        opened: Mutex<Vec<GrpcTarget>>,
        /// (method, message, metadata) per call.
        calls: Mutex<Vec<GrpcCallSeen>>,
    }

    impl Transport for Fake {
        type Grpc = ();

        fn send_http(
            &self,
            request: HttpRequest,
        ) -> impl Future<Output = Result<HttpResponse, String>> + Send {
            let url = request.url.clone();
            self.sent.lock().unwrap().push(request);
            let mut responses = self.responses.lock().unwrap();
            let (status, body) = if responses.is_empty() {
                (200, "{}".to_string())
            } else {
                responses.remove(0)
            };
            async move {
                if url.contains("down") {
                    return Err("connection refused".into());
                }
                Ok(HttpResponse {
                    status,
                    headers: BTreeMap::new(),
                    body,
                    final_url: url,
                    elapsed_ms: 5,
                    size_bytes: 2,
                    body_truncated: false,
                    cookies: Vec::new(),
                    jar_sends: None,
                })
            }
        }

        fn grpc_open(&self, target: GrpcTarget) -> impl Future<Output = Result<(), String>> + Send {
            self.opened.lock().unwrap().push(target);
            async { Ok(()) }
        }

        fn grpc_call(
            &self,
            _conn: &(),
            method: &str,
            message: &str,
            metadata: &BTreeMap<String, String>,
        ) -> impl Future<Output = Result<GrpcResult, String>> + Send {
            self.calls
                .lock()
                .unwrap()
                .push((method.into(), message.into(), metadata.clone()));
            async {
                Ok(GrpcResult {
                    ok: true,
                    status: "OK".into(),
                    body: r#"{"id":7}"#.into(),
                    elapsed_ms: 3,
                    size_bytes: 8,
                    metadata: BTreeMap::new(),
                    trailers: BTreeMap::new(),
                    details: Vec::new(),
                })
            }
        }
    }

    fn http(id: &str, request: Value) -> RequestNode {
        serde_json::from_value(json!({
            "id": id, "name": id, "protocol": "http",
            "request": request,
        }))
        .unwrap()
    }

    async fn run(plan: &RunPlan, vars: &mut RunVars, fake: &Fake) -> (RunStatus, Vec<RunEvent>) {
        let events = Mutex::new(Vec::new());
        let status = run_collection(plan, vars, fake, &RunControl::default(), &|e| {
            events.lock().unwrap().push(e)
        })
        .await;
        (status, events.into_inner().unwrap())
    }

    fn rows(events: &[RunEvent]) -> Vec<&RunResultRow> {
        events
            .iter()
            .filter_map(|e| match e {
                RunEvent::Row(row) => Some(row.as_ref()),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn a_script_write_reaches_the_next_request() {
        let login = http(
            "login",
            json!({
                "method": "POST", "url": "{{base}}/login",
                "testScript": "pm.environment.set('token', pm.response.json().token); pm.test('200', function(){ pm.expect(pm.response.code).to.equal(200); });",
            }),
        );
        let me = http(
            "me",
            json!({
                "method": "GET", "url": "{{base}}/me", "headers": {"Authorization": "Bearer {{token}}"},
            }),
        );
        let plan = RunPlan {
            requests: vec![login, me],
            ..RunPlan::default()
        };
        let fake = Fake::default();
        fake.responses
            .lock()
            .unwrap()
            .push((200, r#"{"token":"t1"}"#.into()));
        let mut vars = RunVars {
            environment: Scope::from([("base".into(), "https://api.test".into())]),
            globals: Scope::new(),
        };
        let (status, events) = run(&plan, &mut vars, &fake).await;

        assert_eq!(status, RunStatus::Done);
        let sent = fake.sent.lock().unwrap();
        assert_eq!(sent[1].url, "https://api.test/me");
        assert_eq!(sent[1].headers["Authorization"], "Bearer t1");
        assert_eq!(vars.environment["token"], "t1");
        assert!(events
            .iter()
            .any(|e| matches!(e, RunEvent::Vars(w) if w.env_set["token"] == "t1")));
        let rows = rows(&events);
        assert!(rows.iter().all(|r| r.ok));
        assert_eq!(rows[0].tests.len(), 1);
        assert_eq!(rows[0].target, "https://api.test/login");
    }

    #[tokio::test]
    async fn data_rows_drive_iterations() {
        let get = http(
            "get",
            json!({"method": "GET", "url": "https://api.test/users/{{id}}"}),
        );
        let plan = RunPlan {
            requests: vec![get],
            iterations: 5,
            data_rows: vec![
                Scope::from([("id".into(), "1".into())]),
                Scope::from([("id".into(), "2".into())]),
            ],
            ..RunPlan::default()
        };
        let fake = Fake::default();
        let (_, events) = run(&plan, &mut RunVars::default(), &fake).await;
        let urls: Vec<_> = fake
            .sent
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.url.clone())
            .collect();
        assert_eq!(
            urls,
            ["https://api.test/users/1", "https://api.test/users/2"]
        );
        let iterations: Vec<_> = rows(&events).iter().map(|r| r.iteration).collect();
        assert_eq!(iterations, [1, 2]);
    }

    #[tokio::test]
    async fn stop_on_failure_ends_the_run() {
        let a = http("a", json!({"method": "GET", "url": "https://api.test/a"}));
        let b = http("b", json!({"method": "GET", "url": "https://api.test/b"}));
        let plan = RunPlan {
            requests: vec![a, b],
            stop_on_failure: true,
            ..RunPlan::default()
        };
        let fake = Fake::default();
        fake.responses.lock().unwrap().push((500, String::new()));
        let (status, events) = run(&plan, &mut RunVars::default(), &fake).await;
        assert_eq!(status, RunStatus::Stopped);
        let rows = rows(&events);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, RowStatus::Code(500));
        assert!(!rows[0].ok);
    }

    #[tokio::test]
    async fn a_failing_pre_request_script_sends_nothing() {
        let a = http(
            "a",
            json!({
                "method": "GET", "url": "https://api.test/a",
                "preRequestScript": "pm.environment.set('seen', '1'); throw new Error('boom');",
            }),
        );
        let plan = RunPlan {
            requests: vec![a],
            ..RunPlan::default()
        };
        let fake = Fake::default();
        let mut vars = RunVars::default();
        let (_, events) = run(&plan, &mut vars, &fake).await;
        assert!(fake.sent.lock().unwrap().is_empty());
        let row = rows(&events)[0];
        assert_eq!(row.status, RowStatus::Code(0));
        assert!(row.error.as_deref().unwrap_or_default().contains("boom"));
        // Writes before the throw still count, as in the app.
        assert_eq!(vars.environment["seen"], "1");
    }

    #[tokio::test]
    async fn a_transport_error_is_an_err_row() {
        let a = http("a", json!({"method": "GET", "url": "https://down.test/"}));
        let plan = RunPlan {
            requests: vec![a],
            ..RunPlan::default()
        };
        let (status, events) = run(&plan, &mut RunVars::default(), &Fake::default()).await;
        assert_eq!(status, RunStatus::Done);
        let row = rows(&events)[0];
        assert_eq!(row.status, RowStatus::Text("ERR".into()));
        assert_eq!(row.error.as_deref(), Some("connection refused"));
    }

    #[tokio::test]
    async fn stop_before_the_next_call() {
        let a = http("a", json!({"method": "GET", "url": "https://api.test/a"}));
        let plan = RunPlan {
            requests: vec![a],
            ..RunPlan::default()
        };
        let control = RunControl::default();
        control.stop();
        let fake = Fake::default();
        let status = run_collection(&plan, &mut RunVars::default(), &fake, &control, &|_| {}).await;
        assert_eq!(status, RunStatus::Stopped);
        assert!(fake.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn grpc_resolves_auth_tls_and_proto_paths() {
        let node: RequestNode = serde_json::from_value(json!({
            "id": "fs:svc/say", "name": "say", "protocol": "grpc",
            "request": {"method": "POST", "url": ""},
            "grpc": {
                "endpoint": "{{host}}:443", "plaintext": false, "method": "demo.Echo.Say",
                "message": "{\"text\":\"{{text}}\"}", "metadata": {"x-id": "1"},
                "source": "proto", "protoPaths": ["protos/echo.proto"], "importPaths": ["/abs/inc"],
                "auth": {"type": "bearer", "bearerToken": "{{token}}"},
                "preRequestScript": "pm.environment.set('text', 'hi');",
            },
        }))
        .unwrap();
        let plan = RunPlan {
            requests: vec![node],
            workspace_root: "/ws".into(),
            global_import_paths: vec!["/global".into(), "/abs/inc".into()],
            client_certs: vec![ClientCert {
                host: "api.test".into(),
                cert_path: "/c.pem".into(),
                key_path: "/k.pem".into(),
                p12_path: None,
                p12_password: None,
            }],
            ..RunPlan::default()
        };
        let mut vars = RunVars {
            environment: Scope::from([
                ("host".into(), "api.test".into()),
                ("token".into(), "t1".into()),
            ]),
            globals: Scope::new(),
        };
        let fake = Fake::default();
        let (_, events) = run(&plan, &mut vars, &fake).await;

        let opened = &fake.opened.lock().unwrap()[0];
        assert_eq!(opened.endpoint, "api.test:443");
        assert_eq!(opened.tls.client_cert.as_deref(), Some("/c.pem"));
        assert_eq!(
            opened.schema,
            GrpcSchema::Proto {
                files: vec!["/ws/protos/echo.proto".into()],
                imports: vec!["/abs/inc".into(), "/global".into()],
            }
        );
        let (method, message, metadata) = &fake.calls.lock().unwrap()[0];
        assert_eq!(method, "demo.Echo.Say");
        // The pre-request script's write is visible to this request's own resolution.
        assert_eq!(message, r#"{"text":"hi"}"#);
        assert_eq!(metadata["authorization"], "Bearer t1");
        let row = rows(&events)[0];
        assert!(row.ok);
        assert_eq!(row.target, "api.test:443 · Say");
        assert_eq!(row.status, RowStatus::Text("OK".into()));
    }

    /// The plan exactly as `runRequests` (entities/request/execute.ts) sends it.
    #[test]
    fn parses_the_app_plan() {
        let plan: RunPlan = serde_json::from_value(json!({
            "requests": [
                {
                    "kind": "request", "id": "fs:a.bonk.json", "name": "a", "protocol": "http",
                    "request": {"method": "GET", "url": "https://x", "headers": {},
                                "auth": {"type": "none", "apiKeyIn": "header"}},
                    "params": [{"key": "q", "value": "1", "description": "", "enabled": true}]
                },
                {
                    "kind": "request", "id": "fs:g.bonk.json", "name": "g", "protocol": "grpc",
                    "request": {"method": "POST", "url": "", "headers": {}},
                    "grpc": {"endpoint": "h:443", "plaintext": false, "method": "p.S.M",
                             "message": "{}", "metadata": {}, "auth": {"type": "none"}}
                }
            ],
            "iterations": 2, "dataRows": [], "delayMs": 0, "stopOnFailure": false,
            "workspaceRoot": "/ws", "globalImportPaths": []
        }))
        .unwrap();
        assert_eq!(plan.requests.len(), 2);
        assert_eq!(plan.iteration_count(), 2);
    }

    #[test]
    fn endpoint_hosts() {
        assert_eq!(endpoint_host("https://api.test:443/x"), "api.test");
        assert_eq!(endpoint_host("[::1]:50051"), "::1");
        assert_eq!(to_abs("C:\\p.proto", "/ws"), "C:\\p.proto");
        assert_eq!(to_abs("a.proto", "/ws/"), "/ws/a.proto");
    }
}
