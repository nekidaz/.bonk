use std::collections::BTreeMap;

use bonk_core::domain::{
    http::{AuthConfig, BodyParam, HttpRequest, RequestSettings},
    workspace::{GrpcTabState, Param, RequestNode},
};
use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BodyParamSpec {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
}

impl From<BodyParamSpec> for BodyParam {
    fn from(value: BodyParamSpec) -> Self {
        Self {
            key: value.key,
            value: value.value,
            description: value.description,
            enabled: value.enabled,
            kind: value.kind,
            file_path: value.file_path,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthSpec {
    #[serde(rename = "type", default = "default_auth_type")]
    pub auth_type: String,
    #[serde(default)]
    pub bearer_token: Option<String>,
    #[serde(default)]
    pub basic_username: Option<String>,
    #[serde(default)]
    pub basic_password: Option<String>,
    #[serde(default)]
    pub api_key_name: Option<String>,
    #[serde(default)]
    pub api_key_value: Option<String>,
    #[serde(default)]
    pub api_key_in: Option<String>,
}

impl From<AuthSpec> for AuthConfig {
    fn from(value: AuthSpec) -> Self {
        Self {
            auth_type: value.auth_type,
            bearer_token: value.bearer_token,
            basic_username: value.basic_username,
            basic_password: value.basic_password,
            api_key_name: value.api_key_name,
            api_key_value: value.api_key_value,
            api_key_in: value.api_key_in,
            oauth: None,
            session: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSpec {
    #[serde(default = "default_method")]
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub graphql_variables: Option<String>,
    #[serde(default)]
    pub binary_file_path: Option<String>,
    #[serde(default)]
    pub body_mode: Option<String>,
    #[serde(default)]
    pub raw_body_format: Option<String>,
    #[serde(default)]
    pub body_params: Option<Vec<BodyParamSpec>>,
    #[serde(default)]
    pub auth: Option<AuthSpec>,
    #[serde(default)]
    pub pre_request_script: Option<String>,
    #[serde(default)]
    pub test_script: Option<String>,
}

impl From<HttpRequestSpec> for HttpRequest {
    fn from(value: HttpRequestSpec) -> Self {
        Self {
            method: value.method,
            url: value.url,
            headers: value.headers,
            body: value.body,
            graphql_variables: value.graphql_variables,
            binary_file_path: value.binary_file_path,
            body_mode: value.body_mode,
            raw_body_format: value.raw_body_format,
            body_params: value
                .body_params
                .map(|rows| rows.into_iter().map(Into::into).collect()),
            auth: value.auth.map(Into::into),
            pre_request_script: value.pre_request_script,
            test_script: value.test_script,
            header_notes: None,
            disabled_headers: None,
        }
    }
}

fn empty_http_request() -> HttpRequest {
    HttpRequest {
        method: default_method(),
        url: String::new(),
        headers: BTreeMap::new(),
        body: None,
        graphql_variables: None,
        binary_file_path: None,
        body_mode: None,
        raw_body_format: None,
        body_params: None,
        auth: None,
        pre_request_script: None,
        test_script: None,
        header_notes: None,
        disabled_headers: None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ParamSpec {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl From<ParamSpec> for Param {
    fn from(value: ParamSpec) -> Self {
        Self {
            key: value.key,
            value: value.value,
            description: value.description,
            enabled: value.enabled,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRequestSpec {
    /// `host:port`, optionally with a scheme and a path prefix (`host:443/api/svc`) when a gateway mounts the services below a path.
    pub endpoint: String,
    #[serde(default)]
    pub plaintext: bool,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default = "default_json_object")]
    pub message: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
    /// `proto` compiles protoPaths; `reflection` (the default) asks the server. Inferred as `proto` when protoPaths is set.
    #[serde(default)]
    pub source: Option<String>,
    /// Workspace-relative or absolute .proto files, for servers without reflection.
    #[serde(default)]
    pub proto_paths: Option<Vec<String>>,
    /// Extra import roots for the proto compiler.
    #[serde(default)]
    pub import_paths: Option<Vec<String>>,
    #[serde(default)]
    pub pre_request_script: Option<String>,
    #[serde(default)]
    pub test_script: Option<String>,
}

impl From<GrpcRequestSpec> for GrpcTabState {
    fn from(value: GrpcRequestSpec) -> Self {
        Self {
            endpoint: value.endpoint,
            plaintext: value.plaintext,
            connection_id: None,
            method: value.method,
            message: value.message,
            metadata: value.metadata,
            source: value.source,
            proto_paths: value.proto_paths,
            import_paths: value.import_paths,
            pre_request_script: value.pre_request_script,
            test_script: value.test_script,
            tls: None,
            auth: None,
            keep_auth_on_plaintext: None,
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceArgs {
    /// Return full request definitions (headers, bodies, auth; credentials redacted).
    /// Large on big workspaces: prefer get_request for one request.
    #[serde(default)]
    pub full: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListRequestsArgs {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetRequestArgs {
    /// Request id returned by list_requests, for example `fs:Auth/Login.bonk.json`.
    pub id: String,
    /// Return literal stored credentials. Keep false unless the user explicitly needs them.
    #[serde(default)]
    pub include_secrets: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderArgs {
    /// Parent folder id, or `fs:` for the workspace root.
    #[serde(default = "root_id")]
    pub parent: String,
    pub name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequestArgs {
    /// Existing request id to update. Omit to create a new request.
    #[serde(default)]
    pub id: Option<String>,
    /// Destination folder id. Omit when updating to keep the current folder; defaults to root for new requests.
    #[serde(default)]
    pub directory: Option<String>,
    pub name: String,
    /// Either `http` or `grpc`.
    pub protocol: String,
    #[serde(default)]
    pub request: Option<HttpRequestSpec>,
    #[serde(default)]
    pub params: Option<Vec<ParamSpec>>,
    #[serde(default)]
    pub grpc: Option<GrpcRequestSpec>,
}

impl SaveRequestArgs {
    pub fn into_node(self) -> Result<(Option<String>, String, RequestNode), String> {
        let protocol = self.protocol.to_ascii_lowercase();
        if protocol != "http" && protocol != "grpc" {
            return Err("protocol must be `http` or `grpc`".into());
        }
        if protocol == "http" && self.request.is_none() {
            return Err("an HTTP request requires the `request` object".into());
        }
        if protocol == "grpc" && self.grpc.is_none() {
            return Err("a gRPC request requires the `grpc` object".into());
        }
        let directory = self
            .directory
            .unwrap_or_else(|| self.id.as_deref().map(parent_id).unwrap_or_else(root_id));
        let node = RequestNode {
            id: self.id.clone().unwrap_or_default(),
            name: self.name,
            protocol,
            request: self
                .request
                .map(Into::into)
                .unwrap_or_else(empty_http_request),
            params: self
                .params
                .map(|rows| rows.into_iter().map(Into::into).collect()),
            grpc: self.grpc.map(Into::into),
            spec: None,
        };
        Ok((self.id, directory, node))
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NodeArgs {
    pub id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameNodeArgs {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveNodeArgs {
    pub id: String,
    /// Destination folder id, or `fs:` for the workspace root.
    pub destination: String,
}

#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestSettingsSpec {
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub follow_redirects: Option<bool>,
    #[serde(default)]
    pub validate_tls: Option<bool>,
    /// Most body bytes returned to the client (default 32 KiB). A longer body is cut
    /// and `bodyTruncated` is set; `sizeBytes` keeps the real size.
    #[serde(default)]
    pub max_response_body_bytes: Option<usize>,
}

/// Response body handed back to the model unless it asks for more.
pub const DEFAULT_OUTPUT_BODY_BYTES: usize = 32 * 1024;

impl RequestSettingsSpec {
    pub fn output_body_limit(&self) -> usize {
        self.max_response_body_bytes
            .unwrap_or(DEFAULT_OUTPUT_BODY_BYTES)
    }

    pub fn into_core(self, server_max: usize) -> RequestSettings {
        let defaults = RequestSettings::default();
        RequestSettings {
            timeout_ms: self.timeout_ms.unwrap_or(defaults.timeout_ms),
            follow_redirects: self.follow_redirects.unwrap_or(defaults.follow_redirects),
            validate_tls: self.validate_tls.unwrap_or(defaults.validate_tls),
            max_response_body_bytes: self
                .max_response_body_bytes
                .unwrap_or(defaults.max_response_body_bytes)
                .min(server_max),
            ..defaults
        }
        .normalized()
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunSavedRequestArgs {
    pub id: String,
    /// Values used for `{{name}}` placeholders. Process variables named with the configured prefix are also available.
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// Bonk app environment whose variables resolve `{{name}}` placeholders. Must be one of `environments` from workspace_info; omit to use globals only.
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub settings: RequestSettingsSpec,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunScenarioArgs {
    pub name: String,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub settings: RequestSettingsSpec,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendHttpArgs {
    pub request: HttpRequestSpec,
    #[serde(default)]
    pub params: Option<Vec<ParamSpec>>,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// Bonk app environment whose variables resolve `{{name}}` placeholders. Must be one of `environments` from workspace_info; omit to use globals only.
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub settings: RequestSettingsSpec,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ValidateHttpArgs {
    pub request: HttpRequestSpec,
    #[serde(default)]
    pub params: Option<Vec<ParamSpec>>,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// Bonk app environment whose variables resolve `{{name}}` placeholders. Must be one of `environments` from workspace_info; omit to use globals only.
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GrpcSchemaArgs {
    /// `host:port`, optionally with a scheme and a path prefix (`host:443/api/svc`) when a gateway mounts the services below a path.
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub plaintext: bool,
    /// Workspace-relative or absolute .proto files; when set, they are compiled instead of asking the server for reflection.
    #[serde(default)]
    pub proto_paths: Vec<String>,
    /// Extra import roots for the proto compiler.
    #[serde(default)]
    pub import_paths: Vec<String>,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// Bonk app environment whose variables resolve `{{name}}` placeholders. Must be one of `environments` from workspace_info; omit to use globals only.
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GrpcTemplateArgs {
    #[serde(flatten)]
    pub schema: GrpcSchemaArgs,
    pub method: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCallArgs {
    #[serde(flatten)]
    pub schema: GrpcSchemaArgs,
    pub method: String,
    #[serde(default = "default_value_object")]
    pub message: Value,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root: String,
    pub request_count: usize,
    pub folder_count: usize,
    pub read_only: bool,
    pub expose_secrets: bool,
    pub network_enabled: bool,
    pub target_hosts: Vec<String>,
    pub variable_names: Vec<String>,
    /// Bonk app environments the `environment` argument may name.
    pub environments: Vec<String>,
    /// allow | ask | deny for HTTP POST/PUT/PATCH/DELETE.
    pub mutating_methods: String,
}

/// One line of the --journal file (read by the Bonk app's Settings → AI / MCP).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    pub client: Option<String>,
    pub tool: String,
    pub method: Option<String>,
    pub target: Option<String>,
    pub env: Option<String>,
    pub status: Option<u64>,
    /// ok | error | denied
    pub outcome: &'static str,
    pub summary: Option<String>,
}

/// MCP requires every tool outputSchema to be `type: "object"`, so tools whose
/// payload is an array or free-form JSON return it under `result`.
#[derive(Debug, Serialize, JsonSchema)]
pub struct JsonOutput {
    pub result: Value,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestList {
    pub requests: Vec<RequestSummary>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestSummary {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub method: String,
    pub target: String,
}

/// list_workspace's default tree: names, ids and request targets, no request bodies.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TreeEntry {
    Folder {
        id: String,
        name: String,
        children: Vec<TreeEntry>,
    },
    Request(RequestSummary),
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub id: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub method: String,
    pub url: String,
    pub unresolved_variables: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTest {
    pub name: String,
    pub passed: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseOutput {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub final_url: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
    pub body_truncated: bool,
}

impl HttpResponseOutput {
    /// Cut the body to `limit` bytes on a char boundary; `size_bytes` keeps the real size.
    pub fn truncate_body(mut self, limit: usize) -> Self {
        if self.body.len() > limit {
            let mut end = limit;
            while !self.body.is_char_boundary(end) {
                end -= 1;
            }
            self.body.truncate(end);
            self.body_truncated = true;
        }
        self
    }
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HttpRunOutput {
    pub ok: bool,
    pub response: HttpResponseOutput,
    pub tests: Vec<ScriptTest>,
    pub logs: Vec<String>,
    pub script_error: Option<String>,
    pub changed_variables: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCallOutput {
    pub ok: bool,
    pub status: String,
    pub body: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
    pub tests: Vec<ScriptTest>,
    pub logs: Vec<String>,
    pub script_error: Option<String>,
    pub changed_variables: Vec<String>,
}

pub fn parent_id(id: &str) -> String {
    let relative = id.strip_prefix("fs:").unwrap_or(id);
    match relative.rsplit_once('/') {
        Some((parent, _)) if !parent.is_empty() => format!("fs:{parent}"),
        _ => root_id(),
    }
}

fn default_true() -> bool {
    true
}

fn default_method() -> String {
    "GET".into()
}

fn default_auth_type() -> String {
    "none".into()
}

fn default_json_object() -> String {
    "{}".into()
}

fn default_value_object() -> Value {
    Value::Object(Default::default())
}

fn root_id() -> String {
    "fs:".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(body: &str) -> HttpResponseOutput {
        HttpResponseOutput {
            status: 200,
            headers: BTreeMap::new(),
            body: body.into(),
            final_url: String::new(),
            elapsed_ms: 0,
            size_bytes: body.len(),
            body_truncated: false,
        }
    }

    #[test]
    fn truncate_body_cuts_on_a_char_boundary_and_keeps_the_real_size() {
        let cut = response("ab€cd").truncate_body(3);
        assert_eq!(cut.body, "ab");
        assert!(cut.body_truncated);
        assert_eq!(cut.size_bytes, 7);

        let whole = response("short").truncate_body(DEFAULT_OUTPUT_BODY_BYTES);
        assert_eq!(whole.body, "short");
        assert!(!whole.body_truncated);
    }
}
