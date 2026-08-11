use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams,
        ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, ServerCapabilities,
        ServerInfo,
    },
    service::RequestContext,
    tool, tool_handler, tool_router, ErrorData as McpError, Json, RoleServer, ServerHandler,
};
use serde_json::json;

use crate::{
    runtime::BonkRuntime,
    types::{
        CreateFolderArgs, GetRequestArgs, GrpcCallArgs, GrpcTemplateArgs, JsonOutput,
        ListRequestsArgs, MoveNodeArgs, MutationResult, NodeArgs, RenameNodeArgs, RequestList,
        RunSavedRequestArgs, SaveRequestArgs, SendHttpArgs, ValidateHttpArgs,
    },
};

const INSTRUCTIONS: &str = "Bonk is the source of truth for API collections. Inspect workspace_info and list_workspace or list_requests before editing. Prefer placeholders such as {{TOKEN}} over literal secrets. Use validate_http before a new request. Network tools can call external systems and workspace mutation tools change files; obtain user approval when the client requires it. get_request redacts credentials unless includeSecrets=true and the operator explicitly enabled --expose-secrets.";

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
    ) -> Result<Json<crate::types::HttpRunOutput>, String> {
        let settings = args
            .settings
            .into_core(self.runtime.config().max_response_body_bytes);
        self.runtime
            .execute_http(
                args.request.into(),
                args.params
                    .map(|rows| rows.into_iter().map(Into::into).collect()),
                args.variables,
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
    ) -> Result<Json<JsonOutput>, String> {
        let settings = args
            .settings
            .into_core(self.runtime.config().max_response_body_bytes);
        self.runtime
            .run_saved_request(&args.id, args.variables, settings)
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
