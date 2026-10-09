use std::collections::{BTreeMap, BTreeSet};

use bonk_core::{
    application::scripts,
    domain::http::{HttpRequest, HttpResponse},
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::types::ScriptTest;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptResultRaw {
    #[serde(default)]
    pub(crate) logs: Vec<String>,
    #[serde(default)]
    pub(crate) tests: Vec<ScriptTest>,
    #[serde(default)]
    pub(crate) env_set: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) env_unset: Vec<String>,
    #[serde(default)]
    pub(crate) globals_set: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) globals_unset: Vec<String>,
    #[serde(default)]
    pub(crate) request_patch: Option<RequestPatch>,
    #[serde(default)]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestPatch {
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) body: Option<String>,
    #[serde(default)]
    pub(crate) headers: Option<BTreeMap<String, String>>,
}

#[derive(Default)]
pub(crate) struct ScriptState {
    pub(crate) logs: Vec<String>,
    pub(crate) tests: Vec<ScriptTest>,
    pub(crate) script_error: Option<String>,
    pub(crate) changed: BTreeSet<String>,
}

impl ScriptState {
    pub(crate) fn apply(
        &mut self,
        result: &ScriptResultRaw,
        environment: &mut BTreeMap<String, String>,
        globals: &mut BTreeMap<String, String>,
    ) {
        self.logs.extend(result.logs.clone());
        self.tests.extend(result.tests.clone());
        for (name, value) in &result.env_set {
            environment.insert(name.clone(), value.clone());
            self.changed.insert(name.clone());
        }
        for name in &result.env_unset {
            environment.remove(name);
            self.changed.insert(name.clone());
        }
        for (name, value) in &result.globals_set {
            globals.insert(name.clone(), value.clone());
            self.changed.insert(name.clone());
        }
        for name in &result.globals_unset {
            globals.remove(name);
            self.changed.insert(name.clone());
        }
    }
}

pub(crate) async fn run_script(
    phase: &str,
    code: &str,
    context: Value,
) -> Result<ScriptResultRaw, String> {
    let phase = phase.to_string();
    let code = code.to_string();
    let context = serde_json::to_string(&context).map_err(|error| error.to_string())?;
    let raw = tokio::task::spawn_blocking(move || scripts::run_script(&phase, &code, &context))
        .await
        .map_err(|error| format!("script task failed: {error}"))??;
    serde_json::from_str(&raw).map_err(|error| format!("invalid script result: {error}"))
}

pub(crate) fn apply_request_patch(request: &mut HttpRequest, patch: Option<RequestPatch>) {
    let Some(patch) = patch else {
        return;
    };
    if let Some(value) = patch.url {
        request.url = value;
    }
    if let Some(value) = patch.body {
        request.body = Some(value);
    }
    if let Some(value) = patch.headers {
        request.headers = value;
    }
}

pub(crate) fn http_script_context(
    request: &HttpRequest,
    response: Option<&HttpResponse>,
    environment: &BTreeMap<String, String>,
    globals: &BTreeMap<String, String>,
) -> Value {
    json!({
        "request": {
            "method": request.method,
            "url": request.url,
            "headers": request.headers,
            "body": request.body,
        },
        "response": response.map(|response| json!({
            "code": response.status,
            "responseTime": response.elapsed_ms,
            "headers": response.headers,
            "body": response.body,
        })),
        "environment": environment,
        "globals": globals,
        "iterationData": {},
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn grpc_script_context(
    method: &str,
    endpoint: &str,
    message: &str,
    metadata: &BTreeMap<String, String>,
    response: Option<&bonk_core::domain::grpc::GrpcResult>,
    environment: &BTreeMap<String, String>,
    globals: &BTreeMap<String, String>,
) -> Value {
    json!({
        "request": {
            "method": method,
            "url": endpoint,
            "headers": metadata,
            "body": message,
        },
        "response": response.map(|response| json!({
            "code": if response.ok { 0 } else { 2 },
            "responseTime": response.elapsed_ms,
            "headers": {},
            "body": response.body,
        })),
        "environment": environment,
        "globals": globals,
        "iterationData": {},
    })
}
