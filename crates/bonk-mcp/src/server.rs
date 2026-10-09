use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::Write,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rmcp::{
    handler::server::{router::tool::ToolRouter, tool::ToolCallContext, wrapper::Parameters},
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ElicitRequestParams,
        ElicitationAction, ElicitationSchema, Implementation, ListResourcesResult,
        PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResponse,
        ReadResourceResult, Resource, ResourceContents, ServerCapabilities, ServerInfo,
    },
    service::{ElicitationMode, RequestContext},
    tool, tool_handler, tool_router, ErrorData as McpError, Json, RoleServer, ServerHandler,
};
use serde_json::{json, Value};

use crate::{
    redact::redact_sensitive_url,
    runtime::{method_gate, BonkRuntime, MethodGate, DENIED},
    types::{
        CreateFolderArgs, GetRequestArgs, GrpcCallArgs, GrpcTemplateArgs, JournalEntry, JsonOutput,
        ListRequestsArgs, MoveNodeArgs, MutationResult, NodeArgs, RenameNodeArgs, RequestList,
        RunSavedRequestArgs, SaveRequestArgs, SendHttpArgs, ValidateHttpArgs,
    },
};

const INSTRUCTIONS: &str = "Bonk is the source of truth for API collections. Inspect workspace_info and list_workspace or list_requests before editing. Prefer placeholders such as {{TOKEN}} over literal secrets. Use validate_http before a new request. To use variables from a Bonk environment, pass its name (one of workspace_info.environments) as `environment`. Network tools can call external systems and workspace mutation tools change files; obtain user approval when the client requires it. get_request redacts credentials unless includeSecrets=true and the operator explicitly enabled --expose-secrets.";
const JOURNAL_MAX_BYTES: u64 = 1024 * 1024;
const ELICITATION_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone)]
pub struct BonkMcpServer {
    runtime: BonkRuntime,
    tool_router: ToolRouter<Self>,
}

impl BonkMcpServer {
    pub fn new(runtime: BonkRuntime) -> Self {
        Self {
            runtime,
            tool_router: Self::tool_router(),
        }
    }

    /// Apply --mutating-methods to an HTTP send, asking the user through
    /// elicitation when the client supports it.
    async fn confirm_method(
        &self,
        context: &RequestContext<RoleServer>,
        method: &str,
        url: &str,
        environment: Option<&str>,
    ) -> Result<(), String> {
        self.runtime.check_environment(environment)?;
        let can_elicit = context
            .peer
            .supported_elicitation_modes()
            .contains(&ElicitationMode::Form);
        match method_gate(self.runtime.config().mutating_methods, method, can_elicit) {
            MethodGate::Proceed => Ok(()),
            MethodGate::Refuse(message) => Err(message),
            MethodGate::Elicit => {
                let method = method.trim().to_ascii_uppercase();
                let url = redact_sensitive_url(url);
                let environment = environment.unwrap_or("без окружения");
                let message = format!("Bonk: разрешить {method} {url} в {environment}?");
                let answer = context
                    .peer
                    .create_elicitation_with_timeout(
                        ElicitRequestParams::FormElicitationParams {
                            meta: None,
                            message,
                            requested_schema: ElicitationSchema::new(BTreeMap::new()),
                        },
                        Some(ELICITATION_TIMEOUT),
                    )
                    .await
                    .map_err(|error| {
                        format!("{DENIED}could not ask the user to approve {method} {url}: {error}")
                    })?;
                if answer.action == ElicitationAction::Accept {
                    Ok(())
                } else {
                    Err(format!("{DENIED}the user did not approve {method} {url}"))
                }
            }
        }
    }

    fn journal_entry(
        &self,
        tool: String,
        args: &Value,
        response: &Result<CallToolResponse, McpError>,
    ) -> JournalEntry {
        let (failure, output) = match response {
            Ok(CallToolResponse::Complete(result)) if result.is_error == Some(true) => {
                (Some(first_text(result)), Value::Null)
            }
            Ok(CallToolResponse::Complete(result)) => {
                (None, result.structured_content.clone().unwrap_or_default())
            }
            Ok(_) => (None, Value::Null),
            Err(error) => (Some(error.message.to_string()), Value::Null),
        };
        let saved = args["id"]
            .as_str()
            .filter(|_| tool == "run_saved_request")
            .and_then(|id| self.runtime.get_request(id, false).ok());
        let method = if args["request"].is_object() {
            Some(
                args["request"]["method"]
                    .as_str()
                    .unwrap_or("GET")
                    .to_ascii_uppercase(),
            )
        } else if tool == "grpc_call" || saved.as_ref().is_some_and(|node| node.protocol == "grpc")
        {
            Some("gRPC".into())
        } else {
            saved.map(|node| node.request.method.to_ascii_uppercase())
        };
        let target = args["request"]["url"]
            .as_str()
            .map(redact_sensitive_url)
            .or_else(|| {
                ["id", "endpoint", "name"].iter().find_map(|key| {
                    args[key]
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned)
                })
            });
        let status = output["response"]["status"]
            .as_u64()
            .or_else(|| output["result"]["response"]["status"].as_u64());
        let outcome = match &failure {
            Some(text) if text.starts_with(DENIED) => "denied",
            Some(_) => "error",
            None => "ok",
        };
        let summary = failure
            .map(|text| text.chars().take(300).collect())
            .or_else(|| output["message"].as_str().map(str::to_owned));
        JournalEntry {
            at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis() as u64),
            client: self.runtime.config().client.clone(),
            tool,
            method,
            target,
            env: args["environment"].as_str().map(str::to_owned),
            status,
            outcome,
            summary,
        }
    }
}

fn first_text(result: &CallToolResult) -> String {
    result
        .content
        .iter()
        .find_map(|content| content.as_text().map(|text| text.text.clone()))
        .unwrap_or_default()
}

/// Append one JSON line; past JOURNAL_MAX_BYTES the file rotates to `<name>.1`.
// ponytail: servers of several clients may rotate at once and drop one older generation; fine for an activity log.
fn append_journal(path: &Path, entry: &JournalEntry) -> std::io::Result<()> {
    if std::fs::metadata(path).is_ok_and(|meta| meta.len() > JOURNAL_MAX_BYTES) {
        let _ = std::fs::rename(path, path.with_extension("jsonl.1"));
    }
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())
}

#[tool_router]
impl BonkMcpServer {
    #[tool(
        description = "Return the active Bonk workspace root, request/folder counts, safety mode, allowed API hosts, and names of available BONK variables. Values of variables are never returned.",
        annotations(
            title = "Bonk workspace info",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn workspace_info(&self) -> Result<Json<crate::types::WorkspaceInfo>, String> {
        self.runtime.workspace_info().map(Json)
    }

    #[tool(
        description = "Return the complete Bonk folder/request tree with stable fs: ids. Stored credentials and sensitive URL/header values are always redacted.",
        annotations(
            title = "List Bonk workspace tree",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_workspace(&self) -> Result<Json<JsonOutput>, String> {
        let tree = self.runtime.redacted_tree()?;
        serde_json::to_value(tree)
            .map(|result| Json(JsonOutput { result }))
            .map_err(|error| error.to_string())
    }

    #[tool(
        description = "List saved HTTP and gRPC requests in the Bonk workspace. Returns stable fs: ids used by the other tools. Optionally filter by text and protocol.",
        annotations(
            title = "List Bonk requests",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_requests(
        &self,
        Parameters(args): Parameters<ListRequestsArgs>,
    ) -> Result<Json<RequestList>, String> {
        self.runtime
            .list_requests(args.query.as_deref(), args.protocol.as_deref())
            .map(|requests| Json(RequestList { requests }))
    }

    #[tool(
        description = "Read one saved request by fs: id. Credentials and sensitive headers are redacted by default; set includeSecrets only when the user explicitly asks to expose stored credentials.",
        annotations(
            title = "Read Bonk request",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_request(
        &self,
        Parameters(args): Parameters<GetRequestArgs>,
    ) -> Result<Json<JsonOutput>, String> {
        let node = self.runtime.get_request(&args.id, args.include_secrets)?;
        serde_json::to_value(node)
            .map(|result| Json(JsonOutput { result }))
            .map_err(|error| error.to_string())
    }

    #[tool(
        description = "Create a folder in the Bonk workspace. Use parent='fs:' for the workspace root.",
        annotations(
            title = "Create Bonk folder",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn create_folder(
        &self,
        Parameters(args): Parameters<CreateFolderArgs>,
    ) -> Result<Json<MutationResult>, String> {
        self.runtime
            .create_folder(&args.parent, &args.name)
            .map(Json)
    }

    #[tool(
        description = "Create or replace a saved Bonk HTTP/gRPC request. Omit id to create. When updating, supply the complete request; prefer {{VARIABLE}} placeholders for credentials.",
        annotations(
            title = "Save Bonk request",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn save_request(
        &self,
        Parameters(args): Parameters<SaveRequestArgs>,
    ) -> Result<Json<MutationResult>, String> {
        let (existing, directory, node) = args.into_node()?;
        self.runtime
            .save_request(existing.as_deref(), &directory, node)
            .map(Json)
    }

    #[tool(
        description = "Rename a saved Bonk request or folder. Returns its new fs: id.",
        annotations(
            title = "Rename Bonk node",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn rename_node(
        &self,
        Parameters(args): Parameters<RenameNodeArgs>,
    ) -> Result<Json<MutationResult>, String> {
        self.runtime.rename_node(&args.id, &args.name).map(Json)
    }

    #[tool(
        description = "Move a saved Bonk request or folder into another folder. Use destination='fs:' for the root. Returns its new fs: id.",
        annotations(
            title = "Move Bonk node",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn move_node(
        &self,
        Parameters(args): Parameters<MoveNodeArgs>,
    ) -> Result<Json<MutationResult>, String> {
        self.runtime
            .move_node(&args.id, &args.destination)
            .map(Json)
    }

    #[tool(
        description = "Duplicate a saved Bonk request or folder beside the original and return the copy's fs: id.",
        annotations(
            title = "Duplicate Bonk node",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn duplicate_node(
        &self,
        Parameters(args): Parameters<NodeArgs>,
    ) -> Result<Json<MutationResult>, String> {
        self.runtime.duplicate_node(&args.id).map(Json)
    }

    #[tool(
        description = "Permanently delete a saved Bonk request or recursively delete a folder. Confirm the exact fs: id with the user before calling.",
        annotations(
            title = "Delete Bonk node",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn delete_node(
        &self,
        Parameters(args): Parameters<NodeArgs>,
    ) -> Result<Json<MutationResult>, String> {
        self.runtime.delete_node(&args.id).map(Json)
    }

    #[tool(
        description = "Validate and materialize an HTTP request without sending it. Checks method, URL, variables, auth, upload paths, and target-host policy. Process variable values remain redacted.",
        annotations(
            title = "Validate HTTP request",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn validate_http(
        &self,
        Parameters(args): Parameters<ValidateHttpArgs>,
    ) -> Result<Json<crate::types::ValidationResult>, String> {
        self.runtime
            .validate_http(
                args.request.into(),
                args.params
                    .map(|rows| rows.into_iter().map(Into::into).collect()),
                args.variables,
                args.environment.as_deref(),
            )
            .await
            .map(Json)
    }

    #[tool(
        description = "Send an inline HTTP request through Bonk. Runs pre-request and test scripts, resolves variables, applies auth/body modes, and returns the bounded response plus test results. This may change an external system.",
        annotations(
            title = "Send HTTP request",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn send_http(
        &self,
        Parameters(args): Parameters<SendHttpArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<Json<crate::types::HttpRunOutput>, String> {
        self.confirm_method(
            &context,
            &args.request.method,
            &args.request.url,
            args.environment.as_deref(),
        )
        .await?;
        let settings = args
            .settings
            .into_core(self.runtime.config().max_response_body_bytes);
        self.runtime
            .execute_http(
                args.request.into(),
                args.params
                    .map(|rows| rows.into_iter().map(Into::into).collect()),
                args.variables,
                args.environment.as_deref(),
                settings,
            )
            .await
            .map(Json)
    }

    #[tool(
        description = "Execute a saved Bonk HTTP or gRPC request by fs: id, including variables and pre-request/test scripts. This may change an external system.",
        annotations(
            title = "Run saved Bonk request",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn run_saved_request(
        &self,
        Parameters(args): Parameters<RunSavedRequestArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<Json<JsonOutput>, String> {
        let node = self.runtime.get_request(&args.id, false)?;
        if node.protocol != "grpc" {
            self.confirm_method(
                &context,
                &node.request.method,
                &node.request.url,
                args.environment.as_deref(),
            )
            .await?;
        }
        let settings = args
            .settings
            .into_core(self.runtime.config().max_response_body_bytes);
        self.runtime
            .run_saved_request(
                &args.id,
                args.variables,
                args.environment.as_deref(),
                settings,
            )
            .await
            .map(|result| Json(JsonOutput { result }))
    }

    #[tool(
        description = "List gRPC services and methods using server reflection, or compile workspace-local protoPaths when provided.",
        annotations(
            title = "Inspect gRPC schema",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        )
    )]
    async fn grpc_reflect(
        &self,
        Parameters(args): Parameters<crate::types::GrpcSchemaArgs>,
    ) -> Result<Json<JsonOutput>, String> {
        let tree = self.runtime.grpc_reflect(args).await?;
        serde_json::to_value(tree)
            .map(|result| Json(JsonOutput { result }))
            .map_err(|error| error.to_string())
    }

    #[tool(
        description = "Generate a type-correct JSON example for one gRPC method using reflection or workspace-local protoPaths.",
        annotations(
            title = "Generate gRPC template",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        )
    )]
    async fn grpc_template(
        &self,
        Parameters(args): Parameters<GrpcTemplateArgs>,
    ) -> Result<String, String> {
        self.runtime.grpc_template(args.schema, &args.method).await
    }

    #[tool(
        description = "Invoke a unary gRPC method through Bonk using reflection or workspace-local protoPaths. This may change an external system.",
        annotations(
            title = "Call gRPC method",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn grpc_call(
        &self,
        Parameters(args): Parameters<GrpcCallArgs>,
    ) -> Result<Json<crate::types::GrpcCallOutput>, String> {
        self.runtime
            .grpc_call(
                args.schema,
                args.method,
                args.message,
                args.metadata,
                args.timeout_ms,
            )
            .await
            .map(Json)
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for BonkMcpServer {
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let tool = request.name.to_string();
        let args = Value::Object(request.arguments.clone().unwrap_or_default());
        let response = self
            .tool_router
            .call(ToolCallContext::new(self, request, context))
            .await;
        if let Some(path) = &self.runtime.config().journal {
            let entry = self.journal_entry(tool, &args, &response);
            if let Err(error) = append_journal(path, &entry) {
                eprintln!(
                    "bonk-mcp: failed to write journal {}: {error}",
                    path.display()
                );
            }
        }
        response
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("bonk-mcp", env!("CARGO_PKG_VERSION")))
        .with_instructions(INSTRUCTIONS)
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let mut resources = vec![Resource::new("bonk://workspace", "Bonk workspace")
            .with_description("Redacted index of every saved request in the active workspace")
            .with_mime_type("application/json")];
        let requests = self
            .runtime
            .list_requests(None, None)
            .map_err(|error| McpError::internal_error(error, None))?;
        resources.extend(requests.into_iter().map(|request| {
            let mut uri = url::Url::parse("bonk://request").expect("valid resource URI");
            uri.query_pairs_mut().append_pair("id", &request.id);
            Resource::new(uri.to_string(), request.id)
                .with_title(request.name)
                .with_description(format!("{} {}", request.method, request.target))
                .with_mime_type("application/json")
        }));
        Ok(ListResourcesResult::with_all_items(resources))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let value = if request.uri == "bonk://workspace" {
            let info = self
                .runtime
                .workspace_info()
                .map_err(|error| McpError::internal_error(error, None))?;
            let requests = self
                .runtime
                .list_requests(None, None)
                .map_err(|error| McpError::internal_error(error, None))?;
            let tree = self
                .runtime
                .redacted_tree()
                .map_err(|error| McpError::internal_error(error, None))?;
            json!({ "workspace": info, "requests": requests, "tree": tree })
        } else {
            let uri = url::Url::parse(&request.uri)
                .map_err(|_| McpError::resource_not_found("invalid Bonk resource URI", None))?;
            if uri.scheme() != "bonk" || uri.host_str() != Some("request") {
                return Err(McpError::resource_not_found("unknown Bonk resource", None));
            }
            let id = uri
                .query_pairs()
                .find_map(|(name, value)| (name == "id").then(|| value.into_owned()))
                .ok_or_else(|| McpError::resource_not_found("request id is missing", None))?;
            let node = self
                .runtime
                .get_request(&id, false)
                .map_err(|error| McpError::resource_not_found(error, None))?;
            serde_json::to_value(node)
                .map_err(|error| McpError::internal_error(error.to_string(), None))?
        };
        let text = serde_json::to_string_pretty(&value)
            .map_err(|error| McpError::internal_error(error.to_string(), None))?;
        Ok(ReadResourceResult::new(vec![
            ResourceContents::text(text, request.uri).with_mime_type("application/json")
        ])
        .into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{MethodPolicy, RuntimeConfig};
    use rmcp::model::ContentBlock;

    #[test]
    fn journal_lines_are_camel_case_and_classify_denials() {
        let journal = std::env::temp_dir().join(format!(
            "bonk-mcp-journal-test-{}.jsonl",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&journal);
        let server = BonkMcpServer::new(BonkRuntime::new(RuntimeConfig {
            root: std::env::temp_dir(),
            read_only: false,
            expose_secrets: false,
            network_enabled: true,
            target_hosts: Vec::new(),
            variable_prefix: "BONK_MCP_TEST_VAR_".into(),
            max_response_body_bytes: 1024 * 1024,
            app_state: None,
            environments: vec!["Staging".into()],
            mutating_methods: MethodPolicy::Ask,
            client: Some("claude-code".into()),
            journal: Some(journal.clone()),
        }));
        let args = json!({
            "request": {"method": "post", "url": "https://api.test/items?api_key=abc"},
            "environment": "Staging"
        });
        let denied =
            Ok(CallToolResult::error(vec![ContentBlock::text(format!("{DENIED}nope"))]).into());
        let ok = Ok(CallToolResult::structured(json!({"response": {"status": 201}})).into());
        for response in [&denied, &ok] {
            append_journal(
                &journal,
                &server.journal_entry("send_http".into(), &args, response),
            )
            .unwrap();
        }
        let raw = std::fs::read_to_string(&journal).unwrap();
        let _ = std::fs::remove_file(&journal);
        let lines = raw
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["outcome"], "denied");
        assert_eq!(lines[0]["client"], "claude-code");
        assert_eq!(lines[0]["method"], "POST");
        assert_eq!(lines[0]["env"], "Staging");
        assert!(lines[0]["summary"].as_str().unwrap().contains("nope"));
        assert!(!lines[0]["target"].as_str().unwrap().contains("abc"));
        assert_eq!(lines[1]["outcome"], "ok");
        assert_eq!(lines[1]["status"], 201);
        assert_eq!(lines[1]["tool"], "send_http");
        assert!(lines[1]["at"].as_u64().unwrap() > 0);
    }
}
