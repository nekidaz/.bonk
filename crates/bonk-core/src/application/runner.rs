//! Collection Runner: saved requests (HTTP + gRPC) through pre-request script, `{{vars}}`,
//! the network and the test script, iteration after iteration. Script writes to the
//! environment/globals carry over to the next request. The app runs collections through this (src-tauri `runner_run`); a CLI can do the same.
//!
//! The network comes in through `Transport`, the way a Go function takes an interface:
//! the app's sends through its proxy/mTLS/cookie settings and gRPC connection cache.

use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::oauth::{self, Keychain, TokenStore};
use super::{grpc_native, scripts};
use crate::conn::GrpcDescriptorCache;
use crate::domain::{
    dynamic_vars::{Dynamic, DynamicOptions, DynamicValue},
    grpc::{GrpcPrefs, GrpcResult, GrpcTls},
    http::{pick_client_cert, ClientCert, HttpRequest, HttpResponse},
    inputs::{placeholders, InputDef, InputKind},
    request_prep::{self, Scope},
    workspace::{RequestNode, TreeNode},
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
    /// Reject a missing secret before any request goes out.
    pub fn require(&self, names: &[String]) -> Result<(), String> {
        let missing: Vec<_> = names
            .iter()
            .filter(|key| {
                self.environment
                    .get(*key)
                    .or_else(|| self.globals.get(*key))
                    .is_none_or(|v| v.is_empty())
            })
            .cloned()
            .collect();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "scenario requires variables: {}",
                missing.join(", ")
            ))
        }
    }

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
    /// Resolves workspace-relative `.proto` and upload paths.
    #[serde(default)]
    pub workspace_root: String,
    /// The global `-I` list (Settings → gRPC), after each request's own imports.
    #[serde(default)]
    pub global_import_paths: Vec<String>,
    /// Settings client identities: a gRPC request without its own takes the one for its host.
    #[serde(default)]
    pub client_certs: Vec<ClientCert>,
    #[serde(default)]
    pub required_variables: Vec<String>,
    /// How `{{$dynamic}}` values are generated (Settings → Variables).
    #[serde(default)]
    pub dynamic: DynamicOptions,
    /// «Ask on send» variables of the workspace, by name (`.bonk/inputs.json`).
    #[serde(default)]
    pub inputs: BTreeMap<String, InputDef>,
    /// Input values given up front (`bonk run --input otp=123456`): not asked for.
    #[serde(default)]
    pub input_values: Scope,
    /// What a step does when it needs input nobody gave.
    #[serde(default)]
    pub input_mode: InputMode,
    /// Tries per step: a 4xx on a step with typed input opens the form again. 0 = 3.
    #[serde(default)]
    pub input_attempts: u32,
}

/// A step with an «ask on send» variable: wait for a person, or fail (CI).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InputMode {
    #[default]
    Wait,
    Fail,
}

impl RunPlan {
    fn attempts(&self) -> u32 {
        if self.input_attempts == 0 {
            3
        } else {
            self.input_attempts
        }
    }

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
    /// Typed input of the step as a log shows it: a code is masked, a secret hidden.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub inputs: BTreeMap<String, String>,
    /// How long the step waited for a person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waited_ms: Option<u64>,
}

/// Full execution details for an interactive editor. Collections keep only their row.
/// The pipeline is the same; the editor uses these to show headers, script lines and OAuth renewal.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionDetails {
    pub request: Option<HttpRequest>,
    pub response: Option<HttpResponse>,
    pub grpc_result: Option<GrpcResult>,
    pub pre: Option<Value>,
    pub post: Option<Value>,
    pub post_ms: Option<u64>,
    pub oauth: Option<oauth::Ensured>,
    pub dynamic: Vec<DynamicValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestExecution {
    pub row: RunResultRow,
    pub details: ExecutionDetails,
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
    /// The step waits for typed input (again, after a rejected try).
    Input(Box<InputRequest>),
}

/// One field of the input form.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputField {
    pub name: String,
    #[serde(flatten)]
    pub def: InputDef,
}

/// What the previous try of the step got back, shown above the form.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputAttempt {
    pub status: RowStatus,
    pub message: String,
    pub elapsed_ms: u64,
    /// The input of that try, masked as the log shows it.
    pub inputs: BTreeMap<String, String>,
}

/// The form a step needs before it can be sent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRequest {
    /// The answer comes back under this id.
    pub id: String,
    pub node_id: String,
    pub request_name: String,
    pub method: String,
    pub iteration: u32,
    pub fields: Vec<InputField>,
    /// 1-based; with `max_attempts` «attempt 2 of 3».
    pub attempt: u32,
    pub max_attempts: u32,
    /// Why the form is open again: a rejected value or the server's answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last: Option<InputAttempt>,
}

/// A person's reply to an `InputRequest`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputAnswer {
    Values {
        values: Scope,
    },
    /// Skip this step, keep running.
    Skip,
    /// End the run here.
    Stop,
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

    /// Resolves once the run is stopped (to leave an input prompt nobody answers).
    async fn wait_stopped(&self) {
        while !self.stopped() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
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

    /// Where OAuth tokens are kept (the keychain; memory in tests).
    fn token_store(&self) -> &dyn TokenStore {
        &Keychain
    }

    /// Show `request`'s form to a person and wait for the reply. `emit` is the run's event
    /// stream: the app sends `RunEvent::Input` through it and parks until the answer
    /// arrives. A transport without a person (CLI, MCP) can't ask.
    fn ask_input(
        &self,
        _request: InputRequest,
        _emit: &(dyn Fn(RunEvent) + Sync),
    ) -> impl Future<Output = Result<InputAnswer, String>> + Send {
        async { Err("this run can't ask for input".to_string()) }
    }

    /// Apply a script's cookie removal before the next stage/request.
    fn clear_script_cookies(&self, _url: &str) {}

    /// `pm.cookies` for `url`, as `(name, value)`; none without a cookie jar.
    fn script_cookies(
        &self,
        _url: &str,
        _response: Option<&HttpResponse>,
    ) -> Vec<(String, String)> {
        Vec::new()
    }
}

/// A target's schema, without policy: reflection over the network, or the `.proto`
/// files as given. For transports that dial directly (bonk-mcp, bonk-cli).
pub async fn load_grpc_schema(target: &GrpcTarget) -> Result<GrpcDescriptorCache, String> {
    match &target.schema {
        GrpcSchema::Reflection => grpc_native::reflect_with(
            &target.endpoint,
            target.plaintext,
            &target.tls,
            &GrpcPrefs::default(),
        )
        .await
        .map_err(|e| e.message),
        GrpcSchema::Proto { files, imports } => {
            let (files, imports) = (files.clone(), imports.clone());
            tokio::task::spawn_blocking(move || grpc_native::compile_protos(&files, &imports))
                .await
                .map_err(|e| format!("proto compile task failed: {e}"))?
        }
    }
}

/// Dial `target` and make one unary call, all within `timeout`.
pub async fn call_grpc(
    target: &GrpcTarget,
    cache: &GrpcDescriptorCache,
    method: &str,
    message: &str,
    metadata: &BTreeMap<String, String>,
    timeout: Duration,
) -> Result<GrpcResult, String> {
    let metadata: HashMap<String, String> = metadata.clone().into_iter().collect();
    let call = async {
        let prefs = GrpcPrefs::default();
        let channel =
            grpc_native::connect_with(&target.endpoint, target.plaintext, &target.tls, &prefs)
                .await?;
        grpc_native::call(channel, cache.clone(), method, message, &metadata).await
    };
    tokio::time::timeout(timeout, call)
        .await
        .map_err(|_| format!("gRPC call timed out after {} ms", timeout.as_millis()))?
        .map_err(|e| e.message)
}

/// The requests under each of `ids` (a folder, a request, or `fs:` for everything), in
/// tree order, each once, with effective auth (own or the folder's) — ready for `RunPlan`.
pub fn plan_requests(tree: &[TreeNode], ids: &[String]) -> Result<Vec<RequestNode>, String> {
    fn collect(nodes: &[TreeNode], out: &mut Vec<RequestNode>) {
        for node in nodes {
            match node {
                TreeNode::Folder(folder) => collect(&folder.children, out),
                TreeNode::Request(request) => out.push((**request).clone()),
            }
        }
    }
    fn find<'a>(nodes: &'a [TreeNode], id: &str) -> Option<&'a TreeNode> {
        nodes.iter().find_map(|node| match node {
            TreeNode::Request(r) if r.id == id => Some(node),
            TreeNode::Folder(f) if f.id == id => Some(node),
            TreeNode::Folder(f) => find(&f.children, id),
            TreeNode::Request(_) => None,
        })
    }
    let mut out: Vec<RequestNode> = Vec::new();
    for id in ids {
        let mut found = Vec::new();
        if id == "fs:" || id.is_empty() {
            collect(tree, &mut found);
        } else {
            let node = find(tree, id).ok_or_else(|| format!("not in the workspace: {id}"))?;
            collect(std::slice::from_ref(node), &mut found);
        }
        for node in found {
            if !out.iter().any(|n| n.id == node.id) {
                out.push(node);
            }
        }
    }
    for node in &mut out {
        let auth = request_prep::effective_auth(tree, &node.id, node.request.auth.as_ref());
        node.request.auth = Some(auth);
        if let Some(grpc) = node.grpc.as_mut() {
            grpc.auth = Some(request_prep::effective_auth(
                tree,
                &node.id,
                grpc.auth.as_ref(),
            ));
        }
    }
    Ok(out)
}

/// Run every request of `plan`, `iteration_count` times, streaming progress to `emit`.
/// Missing required variables refuse the run before any I/O. Individual request failures become rows.
pub async fn run_collection<T: Transport>(
    plan: &RunPlan,
    vars: &mut RunVars,
    transport: &T,
    control: &RunControl,
    emit: &(dyn Fn(RunEvent) + Sync),
) -> Result<RunStatus, String> {
    vars.require(&plan.required_variables)?;
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
                return Ok(RunStatus::Stopped);
            }
            idle += held.elapsed();
            emit(RunEvent::Call {
                node_id: node.id.clone(),
                name: node.name.clone(),
                method: display_method(node),
            });
            let start_offset = iteration_start.elapsed().saturating_sub(idle);
            let step = execute(
                plan,
                node,
                iteration_args(index, data),
                vars,
                transport,
                emit,
                Some(control),
                false,
            )
            .await;
            let mut row = step.execution.row;
            row.start_offset_ms = Some(millis(start_offset));
            row.end_ms = Some(millis(started.elapsed()));
            idle += step.waited;
            let ok = row.ok;
            emit(RunEvent::Row(Box::new(row)));
            if step.halt || control.stopped() || (plan.stop_on_failure && !ok) {
                return Ok(RunStatus::Stopped);
            }
            let last = index == iterations && j + 1 == plan.requests.len();
            if plan.delay_ms > 0 && !last {
                let slept = Instant::now();
                tokio::time::sleep(Duration::from_millis(plan.delay_ms)).await;
                idle += slept.elapsed();
            }
        }
    }
    Ok(RunStatus::Done)
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
    execute(
        plan,
        node,
        iteration_args(iteration, data),
        vars,
        transport,
        emit,
        None,
        false,
    )
    .await
    .execution
    .row
}

/// Interactive execution through the same pipeline used by collections, CLI and MCP.
pub async fn execute_node<T: Transport>(
    plan: &RunPlan,
    node: &RequestNode,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
) -> RequestExecution {
    execute(
        plan,
        node,
        iteration_args(1, &Scope::new()),
        vars,
        transport,
        emit,
        None,
        true,
    )
    .await
    .execution
}

/// Which iteration a step runs in and its data row.
#[derive(Clone, Copy)]
struct IterationArgs<'a> {
    iteration: u32,
    data: &'a Scope,
}

fn iteration_args(iteration: u32, data: &Scope) -> IterationArgs<'_> {
    IterationArgs { iteration, data }
}

/// A step's execution and what it cost beyond the network.
struct Step {
    execution: RequestExecution,
    /// Time spent waiting for a person: kept out of the waterfall.
    waited: Duration,
    /// The person ended the run at the prompt.
    halt: bool,
}

/// The step with its input (when it has any): ask, check, send, and ask again after a 4xx.
#[allow(clippy::too_many_arguments)]
async fn execute<T: Transport>(
    plan: &RunPlan,
    node: &RequestNode,
    at: IterationArgs<'_>,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
    control: Option<&RunControl>,
    capture: bool,
) -> Step {
    let fields = input_fields(plan, node);
    let skipped = |inputs, waited, message: &str, ok, halt| {
        let mut execution = refused(node, at.iteration, message, ok);
        execution.row.inputs = inputs;
        execution.row.waited_ms = Some(millis(waited));
        Step {
            execution,
            waited,
            halt,
        }
    };
    if fields.is_empty() {
        let execution = execute_once(
            plan,
            node,
            at,
            vars,
            transport,
            emit,
            &Scope::new(),
            capture,
        )
        .await;
        return Step {
            execution,
            waited: Duration::ZERO,
            halt: false,
        };
    }
    let mut values: Scope = plan
        .input_values
        .iter()
        .filter(|(name, _)| fields.iter().any(|f| &f.name == *name))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    let to_ask: Vec<InputField> = fields
        .iter()
        .filter(|f| !values.contains_key(&f.name))
        .cloned()
        .collect();
    if !to_ask.is_empty() && plan.input_mode == InputMode::Fail {
        let list = to_ask
            .iter()
            .map(|f| {
                if f.def.label.is_empty() {
                    f.name.clone()
                } else {
                    format!("{} ({})", f.name, f.def.label)
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let message = format!("input required: {list}. Pass it with --input NAME=VALUE");
        return skipped(BTreeMap::new(), Duration::ZERO, &message, false, false);
    }
    let attempts = if to_ask.is_empty() {
        1
    } else {
        plan.attempts()
    };
    let mut waited = Duration::ZERO;
    let mut last: Option<InputAttempt> = None;
    let mut error: Option<String> = None;
    for attempt in 1..=attempts {
        if !to_ask.is_empty() {
            // Ask until the values pass their checks; a typo is not a try.
            loop {
                let request = InputRequest {
                    id: new_id(),
                    node_id: node.id.clone(),
                    request_name: node.name.clone(),
                    method: display_method(node),
                    iteration: at.iteration,
                    fields: to_ask.clone(),
                    attempt,
                    max_attempts: attempts,
                    error: error.take(),
                    last: last.clone(),
                };
                let asked = Instant::now();
                let answer = ask(transport, request, emit, control).await;
                waited += asked.elapsed();
                let typed = match answer {
                    Ok(InputAnswer::Values { values }) => values,
                    Ok(InputAnswer::Skip) => {
                        return skipped(
                            shown(&fields, &values),
                            waited,
                            "skipped: no input given",
                            true,
                            false,
                        );
                    }
                    Ok(InputAnswer::Stop) => {
                        return skipped(
                            BTreeMap::new(),
                            waited,
                            "stopped at the input prompt",
                            false,
                            true,
                        );
                    }
                    Err(e) => return skipped(BTreeMap::new(), waited, &e, false, false),
                };
                let mut problem = None;
                for field in &to_ask {
                    let value = field
                        .def
                        .normalize(typed.get(&field.name).map_or("", String::as_str));
                    match field.def.check(&value) {
                        Ok(()) => {
                            values.insert(field.name.clone(), value);
                        }
                        Err(e) => {
                            problem = Some(format!("{}: {e}", field.name));
                            break;
                        }
                    }
                }
                match problem {
                    None => break,
                    Some(e) => error = Some(e),
                }
            }
            // A «no» to a confirmation ends the run instead of sending `false`.
            if to_ask.iter().any(|f| {
                f.def.kind == InputKind::Bool && values.get(&f.name).is_some_and(|v| v == "false")
            }) {
                return skipped(
                    shown(&fields, &values),
                    waited,
                    "declined at the confirmation",
                    false,
                    true,
                );
            }
        }
        let mut execution =
            execute_once(plan, node, at, vars, transport, emit, &values, capture).await;
        redact(&fields, &values, &mut execution);
        execution.row.inputs = shown(&fields, &values);
        let rejected =
            matches!(execution.row.status, RowStatus::Code(code) if (400..500).contains(&code));
        if rejected && attempt < attempts {
            last = Some(InputAttempt {
                status: execution.row.status.clone(),
                message: rejection(&execution.row),
                elapsed_ms: execution.row.elapsed_ms,
                inputs: execution.row.inputs.clone(),
            });
            error = Some(rejection(&execution.row));
            continue;
        }
        execution.row.waited_ms = (!waited.is_zero()).then(|| millis(waited));
        return Step {
            execution,
            waited,
            halt: false,
        };
    }
    unreachable!("the loop returns on its last attempt")
}

/// The form is shown through the transport; a stopped run closes it.
async fn ask<T: Transport>(
    transport: &T,
    request: InputRequest,
    emit: &(dyn Fn(RunEvent) + Sync),
    control: Option<&RunControl>,
) -> Result<InputAnswer, String> {
    let answer = transport.ask_input(request, emit);
    match control {
        Some(control) => tokio::select! {
            answer = answer => answer,
            () = control.wait_stopped() => Ok(InputAnswer::Stop),
        },
        None => answer.await,
    }
}

/// The «ask on send» variables `node` uses, in order of appearance.
fn input_fields(plan: &RunPlan, node: &RequestNode) -> Vec<InputField> {
    if plan.inputs.is_empty() {
        return Vec::new();
    }
    let text = serde_json::to_string(node).unwrap_or_default();
    placeholders(&text)
        .into_iter()
        .filter_map(|name| {
            plan.inputs.get(&name).map(|def| InputField {
                name,
                def: def.clone(),
            })
        })
        .collect()
}

/// A row for a step that never went out (refused, skipped, stopped).
fn refused(node: &RequestNode, iteration: u32, message: &str, ok: bool) -> RequestExecution {
    RequestExecution {
        row: RunResultRow {
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
            target: String::new(),
            status: RowStatus::Text(if ok { "SKIP" } else { "ERR" }.into()),
            ok,
            elapsed_ms: 0,
            tests: Vec::new(),
            logs: Vec::new(),
            error: (!ok).then(|| message.to_string()),
            response_body: None,
            node_id: node.id.clone(),
            start_offset_ms: None,
            size_bytes: None,
            end_ms: None,
            inputs: BTreeMap::new(),
            waited_ms: None,
        },
        details: ExecutionDetails::default(),
    }
}

/// Input as a log shows it: sensitive values masked.
fn shown(fields: &[InputField], values: &Scope) -> BTreeMap<String, String> {
    fields
        .iter()
        .filter_map(|f| {
            let value = values.get(&f.name)?;
            let text = if f.def.sensitive() {
                f.def.mask(value)
            } else {
                value.chars().take(80).collect()
            };
            Some((f.name.clone(), text))
        })
        .collect()
}

/// Replace sensitive input values in everything a row or the sent-request view keeps.
fn redact(fields: &[InputField], values: &Scope, execution: &mut RequestExecution) {
    let mut subs: Vec<(String, String)> = fields
        .iter()
        .filter(|f| f.def.sensitive())
        .filter_map(|f| {
            let value = values.get(&f.name).filter(|v| !v.is_empty())?;
            Some((value.clone(), f.def.mask(value)))
        })
        .collect();
    if subs.is_empty() {
        return;
    }
    subs.sort_by_key(|(raw, _)| std::cmp::Reverse(raw.len()));
    let hide = |text: &mut String| {
        for (raw, masked) in &subs {
            *text = text.replace(raw.as_str(), masked);
        }
    };
    let row = &mut execution.row;
    hide(&mut row.target);
    row.error.iter_mut().for_each(hide);
    row.logs.iter_mut().for_each(hide);
    // ponytail: JSON-escaped quotes/backslashes in a secret slip past this string replace.
    if let Some(request) = execution.details.request.as_mut() {
        if let Ok(mut text) = serde_json::to_string(request) {
            hide(&mut text);
            if let Ok(clean) = serde_json::from_str(&text) {
                *request = clean;
            }
        }
    }
}

/// «401 invalid_code» from a rejected answer: the status and the server's own reason.
fn rejection(row: &RunResultRow) -> String {
    let code = match &row.status {
        RowStatus::Code(code) => code.to_string(),
        RowStatus::Text(text) => text.clone(),
    };
    let reason = row
        .response_body
        .as_deref()
        .and_then(|body| serde_json::from_str::<Value>(body).ok())
        .and_then(|json| {
            ["error_description", "error", "message", "code"]
                .iter()
                .find_map(|key| json.get(key)?.as_str().map(str::to_string))
        })
        .unwrap_or_default();
    format!("{code} {reason}").trim().to_string()
}

#[allow(clippy::too_many_arguments)]
async fn execute_once<T: Transport>(
    plan: &RunPlan,
    node: &RequestNode,
    at: IterationArgs<'_>,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
    inputs: &Scope,
    capture: bool,
) -> RequestExecution {
    let IterationArgs { iteration, data } = at;
    // A fixed seed repeats the run, with distinct values per request/iteration.
    let mut dynamic = plan.dynamic.clone();
    dynamic.seed = dynamic.seed.map(|seed| {
        node.id
            .bytes()
            .fold(seed ^ u64::from(iteration), |hash, byte| {
                hash.wrapping_mul(31).wrapping_add(u64::from(byte))
            })
    });
    let mut ctx = NodeRun {
        data,
        inputs,
        vars,
        emit,
        tests: Vec::new(),
        logs: Vec::new(),
        capture,
        dynamic: Dynamic::new(&dynamic),
        details: ExecutionDetails::default(),
        target: None,
    };
    let row = if node.protocol == "grpc" {
        ctx.grpc(plan, node, iteration, transport).await
    } else {
        ctx.http(plan, node, iteration, transport).await
    };
    if capture {
        ctx.details.dynamic = ctx.dynamic.into_used();
    }
    RequestExecution {
        row,
        details: ctx.details,
    }
}

fn is_oauth(auth: Option<&crate::domain::http::AuthConfig>) -> bool {
    auth.is_some_and(|auth| auth.auth_type == "oauth2")
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
    /// Transport-level success (HTTP status is judged by the caller).
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
    /// Typed «ask on send» values: the last word in `{{var}}`, never written back.
    inputs: &'a Scope,
    vars: &'a mut RunVars,
    emit: &'a (dyn Fn(RunEvent) + Sync),
    /// `{{$dynamic}}` values of this request: one per name, shared by the row and the send.
    dynamic: Dynamic,
    tests: Vec<ScriptTest>,
    logs: Vec<String>,
    capture: bool,
    details: ExecutionDetails,
    target: Option<String>,
}

impl NodeRun<'_> {
    /// `{{var}}` scope: typed input over iteration data over environment over globals.
    fn scope(&self) -> Scope {
        let mut scope = self.vars.scope(self.data);
        scope.extend(self.inputs.clone());
        scope
    }

    async fn http<T: Transport>(
        &mut self,
        plan: &RunPlan,
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
        let target = request_prep::resolve_text(&url, &self.scope());
        let outcome = self.http_pipeline(plan, node, transport).await;
        let target = self.target.take().unwrap_or(target);
        self.row(node, iteration, target, outcome, |o| match o.status {
            RowStatus::Code(code) => o.ok && (200..400).contains(&code),
            RowStatus::Text(_) => false,
        })
    }

    async fn http_pipeline<T: Transport>(
        &mut self,
        plan: &RunPlan,
        node: &RequestNode,
        transport: &T,
    ) -> Result<Outcome, String> {
        let mut request = node.request.clone();
        request_prep::materialize(&mut request, node.params.as_deref());
        if let Some(code) = script(&request.pre_request_script) {
            let mut probe = request.clone();
            request_prep::resolve(&mut probe, &self.scope(), &mut Dynamic::default())?;
            let cookies = transport.script_cookies(&probe.url, None);
            let context = self.http_context(&request, None, &cookies);
            let pre = self
                .run_script("pre-request", code, context, transport)
                .await?;
            if let Some(error) = pre.error {
                return Ok(Outcome::not_sent(RowStatus::Code(0), error));
            }
            pre.request_patch.unwrap_or_default().apply(&mut request);
        }
        let scope = self.scope();
        let mut resolved = self.with_oauth(&request, &scope, transport, false).await?;
        request_prep::resolve(&mut resolved, &scope, &mut self.dynamic)?;
        resolve_upload_paths(&mut resolved, &plan.workspace_root);
        self.target = Some(resolved.url.clone());
        if self.capture {
            self.details.request = Some(resolved.clone());
        }
        let mut response = transport.send_http(resolved.clone()).await?;
        // A 401 with an OAuth token: renew it once and resend (the server may have revoked it).
        if response.status == 401 && is_oauth(request.auth.as_ref()) {
            match self.with_oauth(&request, &scope, transport, true).await {
                Ok(mut retry) => {
                    request_prep::resolve(&mut retry, &scope, &mut self.dynamic)?;
                    resolve_upload_paths(&mut retry, &plan.workspace_root);
                    response = transport.send_http(retry.clone()).await?;
                    resolved = retry;
                }
                Err(e) => self
                    .logs
                    .push(format!("401, and the token was not renewed: {e}")),
            }
        }
        self.target = Some(resolved.url.clone());
        if self.capture {
            self.details.request = Some(resolved.clone());
            self.details.response = Some(response.clone());
        }
        let mut error = None;
        if let Some(code) = script(&request.test_script) {
            let cookies = transport.script_cookies(&resolved.url, Some(&response));
            let context = self.http_context(&resolved, Some(&response), &cookies);
            error = self
                .run_script("test", code, context, transport)
                .await?
                .error;
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

    /// `request` with a valid OAuth token in its auth, when it uses OAuth.
    async fn with_oauth<T: Transport>(
        &mut self,
        request: &HttpRequest,
        scope: &Scope,
        transport: &T,
        force: bool,
    ) -> Result<HttpRequest, String> {
        let mut out = request.clone();
        let send = |request| transport.send_http(request);
        let got = oauth::prepare_auth(
            out.auth.as_mut(),
            scope,
            transport.token_store(),
            send,
            force,
        )
        .await
        .map_err(|e| e.to_string())?;
        if let Some(got) = got {
            self.note_oauth(&got);
        }
        Ok(out)
    }

    fn note_oauth(&mut self, got: &oauth::Ensured) {
        if self.capture {
            self.details.oauth = Some(got.clone());
        }
        if got.renewed {
            self.logs.push("OAuth: got a new access token".into());
        }
    }

    async fn grpc<T: Transport>(
        &mut self,
        plan: &RunPlan,
        node: &RequestNode,
        iteration: u32,
        transport: &T,
    ) -> RunResultRow {
        let grpc = node.grpc.as_ref();
        let endpoint =
            request_prep::resolve_text(grpc.map_or("", |g| g.endpoint.as_str()), &self.scope());
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
            let pre = self
                .run_script("pre-request", code, context, transport)
                .await?;
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
        let mut auth = g.auth.clone();
        let scope = self.scope();
        let send = |request| transport.send_http(request);
        if let Some(got) =
            oauth::prepare_auth(auth.as_mut(), &scope, transport.token_store(), send, false)
                .await
                .map_err(|e| e.to_string())?
        {
            self.note_oauth(&got);
        }
        let outgoing = request_prep::grpc_prepare(
            auth.as_ref(),
            &message,
            &metadata,
            &self.scope(),
            strip_authorization,
            &mut self.dynamic,
        );
        let result = transport
            .grpc_call(&conn, method, &outgoing.message, &outgoing.metadata)
            .await?;
        if self.capture {
            self.details.grpc_result = Some(result.clone());
        }
        let mut error = None;
        if let Some(code) = script(&g.test_script) {
            let context = self.grpc_context(
                method,
                endpoint,
                &outgoing.message,
                &outgoing.metadata,
                Some(&result),
            );
            error = self
                .run_script("test", code, context, transport)
                .await?
                .error;
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

    /// The row for `outcome`; a pipeline error retains earlier script output.
    fn row(
        &mut self,
        node: &RequestNode,
        iteration: u32,
        target: String,
        outcome: Result<Outcome, String>,
        transport_ok: impl Fn(&Outcome) -> bool,
    ) -> RunResultRow {
        let outcome =
            outcome.unwrap_or_else(|error| Outcome::not_sent(RowStatus::Text("ERR".into()), error));
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
            inputs: BTreeMap::new(),
            waited_ms: None,
        }
    }

    /// Run a script, keep its tests/logs, fold its variable writes into `vars` (and emit them).
    async fn run_script<T: Transport>(
        &mut self,
        phase: &'static str,
        code: &str,
        context: Value,
        transport: &T,
    ) -> Result<ScriptOutput, String> {
        let started = Instant::now();
        let code = code.to_string();
        let context = context.to_string();
        let raw =
            match tokio::task::spawn_blocking(move || scripts::run_script(phase, &code, &context))
                .await
            {
                Ok(Ok(raw)) => raw,
                Ok(Err(error)) => json!({ "error": error }).to_string(),
                Err(error) => {
                    json!({ "error": format!("script task failed: {error}") }).to_string()
                }
            };
        let mut out: ScriptOutput = serde_json::from_str(&raw).unwrap_or_else(|_| ScriptOutput {
            error: Some(format!(
                "script returned invalid output: {}",
                raw.chars().take(200).collect::<String>()
            )),
            ..ScriptOutput::default()
        });
        if self.capture {
            let value = serde_json::from_str::<Value>(&raw)
                .ok()
                .filter(Value::is_object)
                .unwrap_or_else(|| json!({ "error": out.error }));
            if phase == "pre-request" {
                self.details.pre = Some(value);
            } else {
                self.details.post = Some(value);
                self.details.post_ms = Some(millis(started.elapsed()));
            }
        }
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
        for url in &writes.cookie_clears {
            transport.clear_script_cookies(url);
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

/// Request-body attachments resolve from the workspace, independent of the caller's CWD.
fn resolve_upload_paths(request: &mut HttpRequest, root: &str) {
    if let Some(path) = request
        .binary_file_path
        .as_mut()
        .filter(|p| !p.trim().is_empty())
    {
        *path = to_abs(path, root);
    }
    for row in request
        .body_params
        .iter_mut()
        .flatten()
        .filter(|row| row.kind.as_deref() == Some("file"))
    {
        if let Some(path) = row.file_path.as_mut().filter(|p| !p.trim().is_empty()) {
            *path = to_abs(path, root);
        } else if !row.value.trim().is_empty() {
            row.value = to_abs(&row.value, root);
        }
    }
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
    // A canonicalized Windows root is verbatim (`\\?\C:\ws`), where `/` is not a separator.
    if root.starts_with(r"\\?\") {
        return format!(
            "{}\\{}",
            root.trim_end_matches('\\'),
            path.replace('/', "\\")
        );
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
        tokens: oauth::MemoryStore,
        /// Replies of the «person», in order; the forms they were shown.
        answers: Mutex<Vec<InputAnswer>>,
        asked: Mutex<Vec<InputRequest>>,
    }

    impl Transport for Fake {
        type Grpc = ();

        fn token_store(&self) -> &dyn TokenStore {
            &self.tokens
        }

        fn ask_input(
            &self,
            request: InputRequest,
            _emit: &(dyn Fn(RunEvent) + Sync),
        ) -> impl Future<Output = Result<InputAnswer, String>> + Send {
            self.asked.lock().unwrap().push(request);
            let mut answers = self.answers.lock().unwrap();
            let answer = if answers.is_empty() {
                Err("nobody answers".to_string())
            } else {
                Ok(answers.remove(0))
            };
            async move { answer }
        }

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
        .await
        .unwrap();
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
    async fn oauth_gets_a_token_and_renews_it_once_on_401() {
        let me = http(
            "me",
            json!({
                "method": "GET", "url": "https://api.test/me",
                "auth": {"type": "oauth2", "oauth": {
                    "grant": "client_credentials", "tokenUrl": "{{auth}}/token",
                    "clientId": "c", "clientSecret": "s",
                }},
            }),
        );
        let plan = RunPlan {
            requests: vec![me],
            ..RunPlan::default()
        };
        let fake = Fake::default();
        fake.responses.lock().unwrap().extend([
            (200, r#"{"access_token":"t1"}"#.to_string()),
            (401, String::new()),
            (200, r#"{"access_token":"t2"}"#.to_string()),
            (200, "{}".to_string()),
        ]);
        let mut vars = RunVars {
            environment: Scope::from([("auth".into(), "https://auth.test".into())]),
            globals: Scope::new(),
        };
        let (_, events) = run(&plan, &mut vars, &fake).await;
        let sent = fake.sent.lock().unwrap();
        let seen: Vec<_> = sent
            .iter()
            .map(|r| {
                (
                    r.url.as_str(),
                    r.headers.get("Authorization").map(String::as_str),
                )
            })
            .collect();
        assert_eq!(
            seen,
            [
                ("https://auth.test/token", Some("Basic Yzpz")),
                ("https://api.test/me", Some("Bearer t1")),
                ("https://auth.test/token", Some("Basic Yzpz")),
                ("https://api.test/me", Some("Bearer t2")),
            ]
        );
        assert_eq!(rows(&events)[0].status, RowStatus::Code(200));
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
        let a = http(
            "a",
            json!({"method": "GET", "url": "https://down.test/", "preRequestScript": "console.log('before send'); pm.test('pre succeeded', function(){ pm.expect(1).to.equal(1); });"}),
        );
        let plan = RunPlan {
            requests: vec![a],
            ..RunPlan::default()
        };
        let (status, events) = run(&plan, &mut RunVars::default(), &Fake::default()).await;
        assert_eq!(status, RunStatus::Done);
        let row = rows(&events)[0];
        assert_eq!(row.status, RowStatus::Text("ERR".into()));
        assert_eq!(row.error.as_deref(), Some("connection refused"));
        assert_eq!(row.logs, vec!["before send"]);
        assert_eq!(row.tests[0].name, "pre succeeded");
        assert!(row.tests[0].passed);
    }

    #[tokio::test]
    async fn reports_the_wire_url_after_a_pre_request_patch() {
        let node = http(
            "patched",
            json!({ "method": "GET", "url": "https://api.test/old",
            "preRequestScript": "pm.environment.set('id', '42'); pm.request.url = 'https://api.test/items/{{id}}';" }),
        );
        let fake = Fake {
            responses: Mutex::new(vec![(302, String::new())]),
            ..Fake::default()
        };
        let plan = RunPlan {
            requests: vec![node],
            ..RunPlan::default()
        };
        let (_, events) = run(&plan, &mut RunVars::default(), &fake).await;
        let row = rows(&events)[0];
        assert_eq!(
            fake.sent.lock().unwrap()[0].url,
            "https://api.test/items/42"
        );
        assert_eq!(row.target, "https://api.test/items/42");
        assert!(
            row.ok,
            "a 302 has the same success meaning in every frontend"
        );
    }

    #[tokio::test]
    async fn editor_details_keep_a_response_when_its_test_script_throws() {
        let node = http(
            "editor",
            json!({ "method": "GET", "url": "https://api.test/items/{{id}}",
            "preRequestScript": "pm.environment.set('id', '7'); console.log('pre');",
            "testScript": "pm.test('response', function(){ pm.expect(pm.response.code).to.equal(200); }); throw new Error('post failure');" }),
        );
        let result = execute_node(
            &RunPlan::default(),
            &node,
            &mut RunVars::default(),
            &Fake::default(),
            &|_| {},
        )
        .await;
        assert!(!result.row.ok);
        assert!(result.row.tests[0].passed);
        assert_eq!(result.row.logs, vec!["pre"]);
        assert_eq!(
            result.details.request.unwrap().url,
            "https://api.test/items/7"
        );
        assert_eq!(result.details.response.unwrap().status, 200);
        assert_eq!(result.details.pre.unwrap()["envSet"]["id"], "7");
        let post = result.details.post.unwrap();
        assert!(post["error"].as_str().unwrap().contains("post failure"));
        assert_eq!(post["errorLine"], 1);
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
        let status = run_collection(&plan, &mut RunVars::default(), &fake, &control, &|_| {})
            .await
            .unwrap();
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
    fn plan_requests_takes_folders_in_tree_order_once() {
        let tree: Vec<TreeNode> = serde_json::from_value(json!([
            {"kind": "folder", "id": "fs:api", "name": "api", "expanded": true,
             "auth": {"type": "bearer", "bearerToken": "t"},
             "children": [
                {"kind": "request", "id": "fs:api/a.bonk.json", "name": "a", "protocol": "http",
                 "request": {"method": "GET", "url": "x", "auth": {"type": "inherit"}}},
                {"kind": "request", "id": "fs:api/b.bonk.json", "name": "b", "protocol": "http",
                 "request": {"method": "GET", "url": "x"}}
             ]},
            {"kind": "request", "id": "fs:c.bonk.json", "name": "c", "protocol": "http",
             "request": {"method": "GET", "url": "x"}}
        ]))
        .unwrap();
        let ids = |ids: &[&str]| -> Vec<String> {
            let ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
            plan_requests(&tree, &ids)
                .unwrap()
                .into_iter()
                .map(|n| n.id)
                .collect()
        };
        assert_eq!(
            ids(&["fs:"]),
            ["fs:api/a.bonk.json", "fs:api/b.bonk.json", "fs:c.bonk.json"]
        );
        assert_eq!(
            ids(&["fs:api/b.bonk.json", "fs:api"]),
            ["fs:api/b.bonk.json", "fs:api/a.bonk.json"]
        );
        let planned = plan_requests(&tree, &["fs:api/a.bonk.json".into()]).unwrap();
        assert_eq!(
            planned[0].request.auth.as_ref().unwrap().auth_type,
            "bearer"
        );
        assert!(plan_requests(&tree, &["fs:nope".into()]).is_err());
    }

    fn typed(pairs: &[(&str, &str)]) -> InputAnswer {
        InputAnswer::Values {
            values: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    fn otp_plan() -> RunPlan {
        let verify = http(
            "verify",
            json!({
                "method": "POST", "url": "{{base}}/verify?c={{otp}}",
                "body": r#"{"code":"{{otp}}"}"#,
            }),
        );
        let code = InputDef {
            kind: InputKind::Code,
            label: "Код из SMS".into(),
            ..InputDef::default()
        };
        RunPlan {
            requests: vec![verify],
            inputs: BTreeMap::from([("otp".to_string(), code)]),
            ..RunPlan::default()
        }
    }

    fn base_vars() -> RunVars {
        RunVars {
            environment: Scope::from([("base".into(), "https://api.test".into())]),
            globals: Scope::new(),
        }
    }

    #[tokio::test]
    async fn typed_input_is_sent_but_never_stored_or_shown() {
        let plan = otp_plan();
        let fake = Fake::default();
        fake.answers
            .lock()
            .unwrap()
            .push(typed(&[("otp", "482913")]));
        let mut vars = base_vars();
        let (status, events) = run(&plan, &mut vars, &fake).await;

        assert_eq!(status, RunStatus::Done);
        let sent = fake.sent.lock().unwrap();
        assert_eq!(sent[0].url, "https://api.test/verify?c=482913");
        assert_eq!(sent[0].body.as_deref(), Some(r#"{"code":"482913"}"#));
        assert!(!vars.environment.contains_key("otp") && !vars.globals.contains_key("otp"));
        let row = rows(&events)[0];
        assert_eq!(row.target, "https://api.test/verify?c=••••13");
        assert_eq!(row.inputs["otp"], "••••13");
        let asked = fake.asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].fields[0].name, "otp");
        assert_eq!((asked[0].attempt, asked[0].max_attempts), (1, 3));
    }

    #[tokio::test]
    async fn a_rejected_code_opens_the_form_again_and_only_the_last_try_is_a_row() {
        let plan = otp_plan();
        let fake = Fake::default();
        *fake.answers.lock().unwrap() =
            vec![typed(&[("otp", "000071")]), typed(&[("otp", "482913")])];
        *fake.responses.lock().unwrap() = vec![
            (401, r#"{"error":"invalid_code"}"#.into()),
            (200, "{}".into()),
        ];
        let mut vars = base_vars();
        let (_, events) = run(&plan, &mut vars, &fake).await;

        let rows = rows(&events);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].ok);
        assert_eq!(rows[0].status, RowStatus::Code(200));
        let asked = fake.asked.lock().unwrap();
        assert_eq!(asked.len(), 2);
        assert_eq!(asked[1].attempt, 2);
        assert_eq!(asked[1].error.as_deref(), Some("401 invalid_code"));
        let last = asked[1].last.as_ref().unwrap();
        assert_eq!(last.status, RowStatus::Code(401));
        assert_eq!(last.inputs["otp"], "••••71");
    }

    #[tokio::test]
    async fn after_the_last_try_the_rejection_stands() {
        let mut plan = otp_plan();
        plan.input_attempts = 2;
        let fake = Fake::default();
        *fake.answers.lock().unwrap() =
            vec![typed(&[("otp", "111111")]), typed(&[("otp", "222222")])];
        *fake.responses.lock().unwrap() = vec![(401, "{}".into()), (401, "{}".into())];
        let mut vars = base_vars();
        let (_, events) = run(&plan, &mut vars, &fake).await;

        let rows = rows(&events);
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].ok);
        assert_eq!(fake.sent.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_value_that_fails_its_check_is_asked_again_without_sending() {
        let plan = otp_plan();
        let fake = Fake::default();
        *fake.answers.lock().unwrap() = vec![typed(&[("otp", "12")]), typed(&[("otp", "482913")])];
        let mut vars = base_vars();
        let (_, events) = run(&plan, &mut vars, &fake).await;

        assert_eq!(rows(&events).len(), 1);
        assert_eq!(fake.sent.lock().unwrap().len(), 1);
        let asked = fake.asked.lock().unwrap();
        assert_eq!(asked.len(), 2);
        assert_eq!(asked[1].attempt, 1);
        assert!(asked[1].error.as_deref().unwrap().starts_with("otp:"));
    }

    #[tokio::test]
    async fn given_input_is_not_asked_for_and_fail_mode_refuses_without_it() {
        let mut plan = otp_plan();
        plan.input_values = Scope::from([("otp".into(), "482913".into())]);
        let fake = Fake::default();
        let (_, events) = run(&plan, &mut base_vars(), &fake).await;
        assert!(rows(&events)[0].ok);
        assert!(fake.asked.lock().unwrap().is_empty());

        let mut plan = otp_plan();
        plan.input_mode = InputMode::Fail;
        let fake = Fake::default();
        let (_, events) = run(&plan, &mut base_vars(), &fake).await;
        let row = rows(&events)[0];
        assert!(!row.ok);
        assert!(row.error.as_deref().unwrap().contains("--input"));
        assert!(fake.sent.lock().unwrap().is_empty() && fake.asked.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn skip_moves_on_and_stop_or_a_declined_confirmation_ends_the_run() {
        let second = http("me", json!({ "method": "GET", "url": "{{base}}/me" }));
        let mut plan = otp_plan();
        plan.requests.push(second);
        let fake = Fake::default();
        fake.answers.lock().unwrap().push(InputAnswer::Skip);
        let (status, events) = run(&plan, &mut base_vars(), &fake).await;
        assert_eq!(status, RunStatus::Done);
        let rows = rows(&events);
        assert_eq!(rows[0].status, RowStatus::Text("SKIP".into()));
        assert!(rows[0].ok && rows[1].ok);
        assert_eq!(fake.sent.lock().unwrap().len(), 1);

        let fake = Fake::default();
        fake.answers.lock().unwrap().push(InputAnswer::Stop);
        let (status, events) = run(&plan, &mut base_vars(), &fake).await;
        assert_eq!(status, RunStatus::Stopped);
        assert_eq!(rows_len(&events), 1);

        let confirm = InputDef {
            kind: InputKind::Bool,
            ..InputDef::default()
        };
        plan.inputs.insert("otp".into(), confirm);
        let fake = Fake::default();
        fake.answers
            .lock()
            .unwrap()
            .push(typed(&[("otp", "false")]));
        let (status, _) = run(&plan, &mut base_vars(), &fake).await;
        assert_eq!(status, RunStatus::Stopped);
        assert!(fake.sent.lock().unwrap().is_empty());
    }

    fn rows_len(events: &[RunEvent]) -> usize {
        rows(events).len()
    }

    #[test]
    fn endpoint_hosts() {
        assert_eq!(endpoint_host("https://api.test:443/x"), "api.test");
        assert_eq!(endpoint_host("[::1]:50051"), "::1");
        assert_eq!(to_abs("C:\\p.proto", "/ws"), "C:\\p.proto");
        assert_eq!(to_abs("a.proto", "/ws/"), "/ws/a.proto");
        assert_eq!(to_abs("d/a.bin", r"\\?\C:\ws"), r"\\?\C:\ws\d\a.bin");
    }
}
