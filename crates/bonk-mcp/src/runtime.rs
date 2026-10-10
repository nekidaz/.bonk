use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use bonk_core::{
    application::{grpc_native, http, workspace},
    conn::GrpcDescriptorCache,
    domain::{
        http::{AuthConfig, HttpRequest, RequestSettings},
        request_prep::{self, resolve_text},
        workspace::{GrpcTabState, Param, RequestNode, TreeNode},
    },
    infra::cookie_jar::{jar_path, CookieJar, JarProvider},
};
use serde_json::Value;

use crate::{
    redact::{
        redact_node, redact_sensitive_url, redact_tree, redact_url, sanitize_error,
        sanitize_http_response, sanitize_tests, sanitize_text,
    },
    request_prep::{build_http_client, collect_requests, count_tree, target_host_allowed},
    scripts::{
        apply_request_patch, grpc_script_context, http_script_context, run_script, ScriptState,
    },
    types::{
        GrpcCallOutput, GrpcSchemaArgs, HttpRunOutput, MutationResult, RequestSummary, TreeEntry,
        ValidationResult, WorkspaceInfo,
    },
    vars::{
        app_scopes, keychain_secret, load_app_vars, merged_scope, reject_unresolved,
        reject_unresolved_grpc, state_field, unresolved_in_request, Scopes, VariableMap,
    },
};

/// (endpoint, merged scope, secret values to redact)
type ResolvedGrpcScopes = (String, VariableMap, Vec<String>);

/// Prefix of every policy refusal; the journal records these as `denied`.
pub const DENIED: &str = "Denied by Bonk settings: ";

/// What to do with mutating HTTP methods (POST, PUT, PATCH, DELETE).
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum MethodPolicy {
    Allow,
    Ask,
    Deny,
}

impl MethodPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Ask => "ask",
            Self::Deny => "deny",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MethodGate {
    Proceed,
    /// Ask the user through MCP elicitation.
    Elicit,
    Refuse(String),
}

/// Decide whether an HTTP send may go ahead. With `ask`, only the user can
/// approve, through MCP elicitation in the client. A client without elicitation
/// is refused: any approval flag would be set by the model itself, so a prompt
/// injection could set it too.
pub fn method_gate(policy: MethodPolicy, method: &str, can_elicit: bool) -> MethodGate {
    let method = method.trim().to_ascii_uppercase();
    if policy == MethodPolicy::Allow
        || !matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE")
    {
        return MethodGate::Proceed;
    }
    match policy {
        MethodPolicy::Deny => MethodGate::Refuse(format!(
            "{DENIED}{method} requests are disabled for AI clients. Do not retry; the user can change this in Bonk → Settings → AI / MCP."
        )),
        _ if can_elicit => MethodGate::Elicit,
        _ => MethodGate::Refuse(format!(
            "{DENIED}{method} requests need the user's approval, and this client can't ask for it. Do not retry; the user can allow these methods in Bonk → Settings → AI / MCP."
        )),
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub root: PathBuf,
    pub read_only: bool,
    pub expose_secrets: bool,
    pub network_enabled: bool,
    pub target_hosts: Vec<String>,
    pub variable_prefix: String,
    pub max_response_body_bytes: usize,
    /// Bonk app state.json with Postman-style globals and environments.
    pub app_state: Option<PathBuf>,
    /// App environment names the model may select; every other name is denied.
    pub environments: Vec<String>,
    pub mutating_methods: MethodPolicy,
    /// Id of the AI client that launched this server (journal only).
    pub client: Option<String>,
    /// JSON-lines file receiving one entry per tool call.
    pub journal: Option<PathBuf>,
}

#[derive(Clone)]
pub struct BonkRuntime {
    config: Arc<RuntimeConfig>,
}

impl BonkRuntime {
    pub fn new(config: RuntimeConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    /// The app's cookie jar for this workspace, read-only: its cookies go out with the agent's
    /// requests, but Set-Cookie from them is not stored (the app owns the file and rewrites it
    /// from memory). Follows Settings → Cookies in state.json: off when sending is off, the
    /// app-wide jar when that scope is chosen, excluded domains honoured. `None` without
    /// `--app-state` or when the jar can't be read.
    fn read_only_jar(&self) -> Option<JarProvider> {
        let state_path = self.config.app_state.as_deref()?;
        let state = bonk_core::application::app_state::load_map(state_path).ok()?;
        if state.get("cookiesSend").and_then(Value::as_bool) == Some(false) {
            return None;
        }
        let workspace = if state.get("cookieJarScope").and_then(Value::as_str) == Some("app") {
            String::new()
        } else {
            self.config.root.to_string_lossy().into_owned()
        };
        let jar = CookieJar::open(jar_path(state_path.parent()?, &workspace)).ok()?;
        Some(JarProvider {
            jar: Arc::new(jar),
            save: false,
            send: true,
            exclude: state_field(&state, "cookiesExclude"),
        })
    }

    fn root_str(&self) -> String {
        self.config.root.to_string_lossy().into_owned()
    }

    pub fn tree(&self) -> Result<Vec<TreeNode>, String> {
        workspace::load(&self.root_str())
    }

    pub fn workspace_info(&self) -> Result<WorkspaceInfo, String> {
        let tree = self.tree()?;
        let mut requests = 0;
        let mut folders = 0;
        count_tree(&tree, &mut requests, &mut folders);
        Ok(WorkspaceInfo {
            root: self.root_str(),
            request_count: requests,
            folder_count: folders,
            read_only: self.config.read_only,
            expose_secrets: self.config.expose_secrets,
            network_enabled: self.config.network_enabled,
            target_hosts: self.config.target_hosts.clone(),
            variable_names: self.process_variable_names(),
            environments: self.config.environments.clone(),
            mutating_methods: self.config.mutating_methods.as_str().into(),
        })
    }

    pub fn redacted_tree(&self) -> Result<Vec<TreeNode>, String> {
        let mut tree = self.tree()?;
        redact_tree(&mut tree);
        Ok(tree)
    }

    /// The tree with each request reduced to its summary (no headers, bodies or auth).
    pub fn compact_tree(&self) -> Result<Vec<TreeEntry>, String> {
        Ok(compact(self.tree()?))
    }

    pub fn list_requests(
        &self,
        query: Option<&str>,
        protocol: Option<&str>,
    ) -> Result<Vec<RequestSummary>, String> {
        let mut nodes = Vec::new();
        collect_requests(&self.tree()?, &mut nodes);
        let query = query.map(str::to_ascii_lowercase);
        let protocol = protocol.map(str::to_ascii_lowercase);
        let mut out = nodes
            .into_iter()
            .filter(|node| {
                protocol
                    .as_deref()
                    .is_none_or(|wanted| node.protocol.eq_ignore_ascii_case(wanted))
            })
            .map(summarize)
            .filter(|item| {
                query.as_deref().is_none_or(|needle| {
                    item.id.to_ascii_lowercase().contains(needle)
                        || item.name.to_ascii_lowercase().contains(needle)
                        || item.target.to_ascii_lowercase().contains(needle)
                })
            })
            .collect::<Vec<_>>();
        out.sort_by_key(|item| item.id.to_ascii_lowercase());
        Ok(out)
    }

    pub fn get_request(&self, id: &str, include_secrets: bool) -> Result<RequestNode, String> {
        let node = self.find_request(id)?;
        if include_secrets && !self.config.expose_secrets {
            return Err(
                format!("{DENIED}literal stored credentials are disabled; restart bonk-mcp with --expose-secrets only if the user explicitly accepts that risk"),
            );
        }
        Ok(if include_secrets && self.config.expose_secrets {
            node
        } else {
            redact_node(node)
        })
    }

    fn find_request(&self, id: &str) -> Result<RequestNode, String> {
        let mut nodes = Vec::new();
        collect_requests(&self.tree()?, &mut nodes);
        nodes
            .into_iter()
            .find(|node| node.id == id)
            .ok_or_else(|| format!("request not found: {id}"))
    }

    fn require_write(&self) -> Result<(), String> {
        if self.config.read_only {
            Err(format!(
                "{DENIED}workspace writes are disabled by --read-only"
            ))
        } else {
            Ok(())
        }
    }

    pub fn create_folder(&self, parent: &str, name: &str) -> Result<MutationResult, String> {
        self.require_write()?;
        self.require_workspace_directory(parent)?;
        let id = workspace::create_folder(&self.root_str(), parent, name)?;
        Ok(MutationResult {
            id: Some(id),
            message: "folder created".into(),
        })
    }

    pub fn save_request(
        &self,
        existing: Option<&str>,
        directory: &str,
        node: RequestNode,
    ) -> Result<MutationResult, String> {
        self.require_write()?;
        self.require_workspace_directory(directory)?;
        if let Some(id) = existing {
            self.require_workspace_node(id)?;
        }
        let id = workspace::save_request(&self.root_str(), directory, existing, node)?;
        Ok(MutationResult {
            id: Some(id),
            message: if existing.is_some() {
                "request updated".into()
            } else {
                "request created".into()
            },
        })
    }

    pub fn rename_node(&self, id: &str, name: &str) -> Result<MutationResult, String> {
        self.require_write()?;
        self.require_workspace_node(id)?;
        let id = workspace::rename(&self.root_str(), id, name)?;
        Ok(MutationResult {
            id: Some(id),
            message: "node renamed".into(),
        })
    }

    pub fn move_node(&self, id: &str, destination: &str) -> Result<MutationResult, String> {
        self.require_write()?;
        self.require_workspace_node(id)?;
        self.require_workspace_directory(destination)?;
        let id = workspace::move_node(&self.root_str(), id, destination)?;
        Ok(MutationResult {
            id: Some(id),
            message: "node moved".into(),
        })
    }

    pub fn duplicate_node(&self, id: &str) -> Result<MutationResult, String> {
        self.require_write()?;
        self.require_workspace_node(id)?;
        let id = workspace::duplicate(&self.root_str(), id)?;
        Ok(MutationResult {
            id: Some(id),
            message: "node duplicated".into(),
        })
    }

    pub fn delete_node(&self, id: &str) -> Result<MutationResult, String> {
        self.require_write()?;
        self.require_workspace_node(id)?;
        workspace::delete(&self.root_str(), id)?;
        Ok(MutationResult {
            id: None,
            message: format!("deleted {id}"),
        })
    }

    pub fn process_variable_names(&self) -> Vec<String> {
        let mut names = std::env::vars()
            .filter_map(|(name, _)| {
                name.strip_prefix(&self.config.variable_prefix)
                    .map(str::to_owned)
            })
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>();
        let app = load_app_vars(self.config.app_state.as_deref());
        names.extend(
            app.globals
                .iter()
                .filter(|row| row.active())
                .map(|row| row.key.trim().to_string()),
        );
        names.sort();
        names.dedup();
        names
    }

    /// Refuse an app environment the operator did not allow.
    pub fn check_environment(&self, name: Option<&str>) -> Result<(), String> {
        match name {
            Some(name)
                if !self
                    .config
                    .environments
                    .iter()
                    .any(|allowed| allowed == name) =>
            {
                let allowed = if self.config.environments.is_empty() {
                    "none".to_string()
                } else {
                    self.config.environments.join(", ")
                };
                Err(format!(
                    "{DENIED}environment `{name}` is not allowed for AI clients (allowed: {allowed})"
                ))
            }
            _ => Ok(()),
        }
    }

    /// Explicit `variables` override the selected app environment; process
    /// variables override app globals. Process values are always redacted, app
    /// secrets unless --expose-secrets.
    fn scopes(&self, variables: VariableMap, environment: Option<&str>) -> Result<Scopes, String> {
        self.check_environment(environment)?;
        let process = std::env::vars()
            .filter_map(|(name, value)| {
                name.strip_prefix(&self.config.variable_prefix)
                    .filter(|key| !key.is_empty())
                    .map(|key| (key.to_string(), value))
            })
            .collect::<VariableMap>();
        let app = load_app_vars(self.config.app_state.as_deref());
        // ponytail: keychain reads are blocking and may show an OS prompt; fine on the multi-thread runtime.
        let (mut env, mut globals, app_secrets) = app_scopes(&app, environment, &keychain_secret)?;
        let mut secrets = process.values().cloned().collect::<Vec<_>>();
        if !self.config.expose_secrets {
            secrets.extend(app_secrets);
        }
        globals.extend(process);
        env.extend(variables);
        Ok((env, globals, secrets))
    }

    pub async fn validate_http(
        &self,
        mut request: HttpRequest,
        params: Option<Vec<Param>>,
        variables: BTreeMap<String, String>,
        environment: Option<&str>,
    ) -> Result<ValidationResult, String> {
        request_prep::materialize(&mut request, params.as_deref());
        let (environment, globals, secrets) = self.scopes(variables, environment)?;
        let scope = merged_scope(&globals, &environment);
        request_prep::resolve(&mut request, &scope)?;
        self.normalize_file_paths(&mut request)
            .map_err(|error| sanitize_error(&error, &secrets))?;

        let unresolved = unresolved_in_request(&request);
        let mut warnings = Vec::new();
        if request.url.trim().is_empty() {
            warnings.push("URL is empty".into());
        }
        if !self.config.network_enabled {
            warnings.push("network calls are disabled by --no-network".into());
        }
        let url_check = self.check_http_target(&request.url);
        if let Err(error) = &url_check {
            warnings.push(error.clone());
        }
        let method_check = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
            .map_err(|error| format!("invalid HTTP method: {error}"));
        if let Err(error) = &method_check {
            warnings.push(error.clone());
        }
        let client = reqwest::Client::new();
        let build_check = match (url_check.is_ok(), method_check) {
            (true, Ok(method)) => {
                let url = bonk_core::domain::url::normalize_url(&request.url);
                bonk_core::infra::reqwest_client::build_request_to(&client, &request, method, &url)
                    .map(|_| ())
            }
            _ => Err("request target is invalid".into()),
        };
        if let Err(error) = build_check {
            if !warnings.contains(&error) {
                warnings.push(error);
            }
        }
        warnings = warnings
            .into_iter()
            .map(|warning| sanitize_error(&warning, &secrets))
            .collect();
        Ok(ValidationResult {
            valid: warnings.is_empty() && unresolved.is_empty(),
            method: request.method,
            url: redact_url(&request.url, &secrets),
            unresolved_variables: unresolved,
            warnings,
        })
    }

    pub async fn execute_http(
        &self,
        mut request: HttpRequest,
        params: Option<Vec<Param>>,
        variables: BTreeMap<String, String>,
        environment: Option<&str>,
        settings: RequestSettings,
        body_limit: usize,
    ) -> Result<HttpRunOutput, String> {
        self.require_network()?;
        request_prep::materialize(&mut request, params.as_deref());
        let (mut environment, mut globals, secrets) = self.scopes(variables, environment)?;
        let mut state = ScriptState::default();

        if let Some(code) = request
            .pre_request_script
            .as_deref()
            .filter(|code| !code.trim().is_empty())
        {
            let context = http_script_context(&request, None, &environment, &globals);
            let result = run_script("pre-request", code, context)
                .await
                .map_err(|error| sanitize_error(&error, &secrets))?;
            state.apply(&result, &mut environment, &mut globals);
            apply_request_patch(&mut request, result.request_patch);
            if let Some(error) = result.error {
                return Err(sanitize_text(&error, &secrets));
            }
        }

        let scope = merged_scope(&globals, &environment);
        request_prep::resolve(&mut request, &scope)?;
        self.normalize_file_paths(&mut request)
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let unresolved = unresolved_in_request(&request);
        if !unresolved.is_empty() {
            return Err(format!("unresolved variables: {}", unresolved.join(", ")));
        }
        self.check_http_target(&request.url)
            .map_err(|error| sanitize_error(&error, &secrets))?;

        let settings = settings.normalized();
        let client = build_http_client(&settings, &self.config.target_hosts, self.read_only_jar())?;
        let response = http::http_send(client, request.clone(), settings, None)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;

        if let Some(code) = request
            .test_script
            .as_deref()
            .filter(|code| !code.trim().is_empty())
        {
            let context = http_script_context(&request, Some(&response), &environment, &globals);
            let result = run_script("test", code, context)
                .await
                .map_err(|error| sanitize_error(&error, &secrets))?;
            state.apply(&result, &mut environment, &mut globals);
            state.script_error = result.error;
        }

        let tests_ok = state.tests.iter().all(|test| test.passed);
        let script_ok = state.script_error.is_none();
        let transport_ok = (200..400).contains(&response.status);
        Ok(HttpRunOutput {
            ok: transport_ok && tests_ok && script_ok,
            // Cut after sanitizing, so a secret is never split past the redaction.
            response: sanitize_http_response(response, &secrets).truncate_body(body_limit),
            tests: sanitize_tests(state.tests, &secrets),
            logs: state
                .logs
                .into_iter()
                .map(|value| sanitize_text(&value, &secrets))
                .collect(),
            script_error: state
                .script_error
                .map(|value| sanitize_text(&value, &secrets)),
            changed_variables: state.changed.into_iter().collect(),
        })
    }

    pub async fn run_saved_request(
        &self,
        id: &str,
        variables: BTreeMap<String, String>,
        environment: Option<&str>,
        settings: RequestSettings,
        body_limit: usize,
    ) -> Result<Value, String> {
        let tree = self.tree()?;
        let mut node = self.find_request(id)?;
        if node.protocol == "grpc" {
            let grpc = node
                .grpc
                .ok_or_else(|| "saved gRPC request has no grpc configuration".to_string())?;
            let auth = request_prep::effective_auth(&tree, id, grpc.auth.as_ref());
            serde_json::to_value(
                self.execute_saved_grpc(grpc, auth, variables, environment)
                    .await?,
            )
            .map_err(|error| error.to_string())
        } else {
            // A request set to `inherit` sends its folder's auth, as in the app.
            node.request.auth = Some(request_prep::effective_auth(
                &tree,
                id,
                node.request.auth.as_ref(),
            ));
            serde_json::to_value(
                self.execute_http(
                    node.request,
                    node.params,
                    variables,
                    environment,
                    settings,
                    body_limit,
                )
                .await?,
            )
            .map_err(|error| error.to_string())
        }
    }

    pub async fn grpc_reflect(
        &self,
        schema: GrpcSchemaArgs,
    ) -> Result<bonk_core::domain::grpc::ServiceTree, String> {
        let (endpoint, _, secrets) = self.resolve_grpc_endpoint(&schema)?;
        if schema.proto_paths.is_empty() {
            self.check_grpc_target(&endpoint)
                .map_err(|error| sanitize_error(&error, &secrets))?;
        }
        let cache = self
            .load_grpc_schema(&schema, &endpoint)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let mut tree = cache.tree;
        for service in &mut tree.services {
            service.name = sanitize_text(&service.name, &secrets);
        }
        Ok(tree)
    }

    pub async fn grpc_template(
        &self,
        schema: GrpcSchemaArgs,
        method: &str,
    ) -> Result<String, String> {
        let (endpoint, _, secrets) = self.resolve_grpc_endpoint(&schema)?;
        if schema.proto_paths.is_empty() {
            self.check_grpc_target(&endpoint)
                .map_err(|error| sanitize_error(&error, &secrets))?;
        }
        let mut cache = self
            .load_grpc_schema(&schema, &endpoint)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;
        grpc_native::template(&mut cache, method)
    }

    pub async fn grpc_call(
        &self,
        schema: GrpcSchemaArgs,
        method: String,
        message: Value,
        metadata: BTreeMap<String, String>,
        timeout_ms: Option<u64>,
    ) -> Result<GrpcCallOutput, String> {
        self.require_network()?;
        let (endpoint, scope, secrets) = self.resolve_grpc_endpoint(&schema)?;
        self.check_grpc_target(&endpoint)
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let cache = self
            .load_grpc_schema(&schema, &endpoint)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let method = resolve_text(&method, &scope);
        let message = resolve_text(
            &serde_json::to_string(&message).map_err(|e| e.to_string())?,
            &scope,
        );
        let metadata = metadata
            .into_iter()
            .map(|(key, value)| (resolve_text(&key, &scope), resolve_text(&value, &scope)))
            .collect::<HashMap<_, _>>();
        reject_unresolved_grpc(&endpoint, &method, &message, metadata.iter())?;
        let channel = grpc_native::connect(&endpoint, schema.plaintext)
            .await
            .map_err(|error| sanitize_error(&error.message, &secrets))?;
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).min(600_000));
        let result = tokio::time::timeout(
            timeout,
            grpc_native::call(channel, cache, &method, &message, &metadata),
        )
        .await
        .map_err(|_| format!("gRPC call timed out after {} ms", timeout.as_millis()))?
        .map_err(|error| sanitize_error(&error.message, &secrets))?;
        Ok(GrpcCallOutput {
            ok: result.ok,
            status: result.status,
            body: sanitize_text(&result.body, &secrets),
            elapsed_ms: result.elapsed_ms,
            size_bytes: result.size_bytes,
            tests: vec![],
            logs: vec![],
            script_error: None,
            changed_variables: vec![],
        })
    }

    async fn execute_saved_grpc(
        &self,
        grpc: GrpcTabState,
        auth: AuthConfig,
        variables: BTreeMap<String, String>,
        environment: Option<&str>,
    ) -> Result<GrpcCallOutput, String> {
        self.require_network()?;
        let (mut environment, mut globals, secrets) = self.scopes(variables, environment)?;
        let mut state = ScriptState::default();
        let mut endpoint = grpc.endpoint.clone();
        let mut message = grpc.message.clone();
        let mut metadata = grpc.metadata.clone();
        let method = grpc
            .method
            .clone()
            .ok_or_else(|| "saved gRPC request has no method".to_string())?;

        if let Some(code) = grpc
            .pre_request_script
            .as_deref()
            .filter(|code| !code.trim().is_empty())
        {
            let context = grpc_script_context(
                &method,
                &endpoint,
                &message,
                &metadata,
                None,
                &environment,
                &globals,
            );
            let result = run_script("pre-request", code, context)
                .await
                .map_err(|error| sanitize_error(&error, &secrets))?;
            state.apply(&result, &mut environment, &mut globals);
            if let Some(patch) = result.request_patch {
                if let Some(value) = patch.url {
                    endpoint = value;
                }
                if let Some(value) = patch.body {
                    message = value;
                }
                if let Some(value) = patch.headers {
                    metadata = value;
                }
            }
            if let Some(error) = result.error {
                return Err(sanitize_text(&error, &secrets));
            }
        }

        let scope = merged_scope(&globals, &environment);
        endpoint = resolve_text(&endpoint, &scope);
        let strip_authorization = grpc.plaintext && !grpc.keep_auth_on_plaintext.unwrap_or(false);
        let outgoing = request_prep::grpc_prepare(
            Some(&auth),
            &message,
            &metadata,
            &scope,
            strip_authorization,
        );
        message = outgoing.message;
        metadata = outgoing.metadata;
        let method = resolve_text(&method, &scope);
        reject_unresolved_grpc(&endpoint, &method, &message, metadata.iter())?;
        self.check_grpc_target(&endpoint)
            .map_err(|error| sanitize_error(&error, &secrets))?;

        let schema = GrpcSchemaArgs {
            endpoint: endpoint.clone(),
            plaintext: grpc.plaintext,
            proto_paths: grpc.proto_paths.clone().unwrap_or_default(),
            import_paths: grpc.import_paths.clone().unwrap_or_default(),
            variables: BTreeMap::new(),
            environment: None,
        };
        let cache = self
            .load_grpc_schema(&schema, &endpoint)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let channel = grpc_native::connect(&endpoint, grpc.plaintext)
            .await
            .map_err(|error| sanitize_error(&error.message, &secrets))?;
        let metadata_map = metadata.clone().into_iter().collect::<HashMap<_, _>>();
        let result = tokio::time::timeout(
            Duration::from_secs(30),
            grpc_native::call(channel, cache, &method, &message, &metadata_map),
        )
        .await
        .map_err(|_| "gRPC call timed out after 30000 ms".to_string())?
        .map_err(|error| sanitize_error(&error.message, &secrets))?;

        if let Some(code) = grpc
            .test_script
            .as_deref()
            .filter(|code| !code.trim().is_empty())
        {
            let context = grpc_script_context(
                &method,
                &endpoint,
                &message,
                &metadata,
                Some(&result),
                &environment,
                &globals,
            );
            let script_result = run_script("test", code, context)
                .await
                .map_err(|error| sanitize_error(&error, &secrets))?;
            state.apply(&script_result, &mut environment, &mut globals);
            state.script_error = script_result.error;
        }

        let tests_ok = state.tests.iter().all(|test| test.passed);
        Ok(GrpcCallOutput {
            ok: result.ok && tests_ok && state.script_error.is_none(),
            status: result.status,
            body: sanitize_text(&result.body, &secrets),
            elapsed_ms: result.elapsed_ms,
            size_bytes: result.size_bytes,
            tests: sanitize_tests(state.tests, &secrets),
            logs: state
                .logs
                .into_iter()
                .map(|value| sanitize_text(&value, &secrets))
                .collect(),
            script_error: state
                .script_error
                .map(|value| sanitize_text(&value, &secrets)),
            changed_variables: state.changed.into_iter().collect(),
        })
    }

    fn resolve_grpc_endpoint(&self, schema: &GrpcSchemaArgs) -> Result<ResolvedGrpcScopes, String> {
        let (environment, globals, secrets) =
            self.scopes(schema.variables.clone(), schema.environment.as_deref())?;
        let scope = merged_scope(&globals, &environment);
        let endpoint = resolve_text(&schema.endpoint, &scope);
        reject_unresolved(&[&endpoint])?;
        Ok((endpoint, scope, secrets))
    }

    async fn load_grpc_schema(
        &self,
        schema: &GrpcSchemaArgs,
        endpoint: &str,
    ) -> Result<GrpcDescriptorCache, String> {
        if schema.proto_paths.is_empty() {
            self.require_network()?;
            Ok(grpc_native::reflect(endpoint, schema.plaintext).await?)
        } else {
            let files = self.normalize_proto_paths(&schema.proto_paths)?;
            let includes = self.normalize_proto_paths(&schema.import_paths)?;
            tokio::task::spawn_blocking(move || grpc_native::compile_protos(&files, &includes))
                .await
                .map_err(|error| format!("proto compile task failed: {error}"))?
        }
    }

    fn normalize_proto_paths(&self, paths: &[String]) -> Result<Vec<String>, String> {
        paths
            .iter()
            .map(|path| {
                let path = Path::new(path);
                let joined = if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    self.config.root.join(path)
                };
                let canonical = joined.canonicalize().map_err(|error| {
                    format!("failed to resolve proto path {}: {error}", joined.display())
                })?;
                if !canonical.starts_with(&self.config.root) {
                    return Err(format!(
                        "proto path is outside the workspace: {}",
                        canonical.display()
                    ));
                }
                Ok(canonical.to_string_lossy().into_owned())
            })
            .collect()
    }

    fn normalize_file_paths(&self, request: &mut HttpRequest) -> Result<(), String> {
        if request.body_mode.as_deref() == Some("binary") {
            if let Some(raw) = request
                .binary_file_path
                .clone()
                .filter(|value| !value.trim().is_empty())
            {
                request.binary_file_path = Some(self.confine_upload_path(&raw)?);
            }
        }
        let Some(rows) = request.body_params.as_mut() else {
            return Ok(());
        };
        for row in rows {
            if row.kind.as_deref() != Some("file") {
                continue;
            }
            let raw = row
                .file_path
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&row.value);
            if raw.trim().is_empty() {
                continue;
            }
            row.file_path = Some(self.confine_upload_path(raw)?);
        }
        Ok(())
    }

    /// Resolve an upload path against the workspace root and refuse anything
    /// that lands outside it once symlinks are followed.
    fn confine_upload_path(&self, raw: &str) -> Result<String, String> {
        let path = Path::new(raw);
        let joined = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.config.root.join(path)
        };
        let canonical = joined.canonicalize().map_err(|error| {
            format!(
                "failed to resolve upload file {}: {error}",
                joined.display()
            )
        })?;
        if !canonical.starts_with(&self.config.root) {
            return Err(format!(
                "upload file is outside the workspace: {}",
                canonical.display()
            ));
        }
        Ok(canonical.to_string_lossy().into_owned())
    }

    fn require_network(&self) -> Result<(), String> {
        if self.config.network_enabled {
            Ok(())
        } else {
            Err(format!(
                "{DENIED}network calls are disabled by --no-network"
            ))
        }
    }

    fn require_workspace_node(&self, id: &str) -> Result<PathBuf, String> {
        let path = self.resolve_existing_workspace_id(id, false)?;
        let is_request = path.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".bonk.json"));
        if path.is_dir() || is_request {
            Ok(path)
        } else {
            Err(format!(
                "workspace id is not a Bonk request or folder: {id}"
            ))
        }
    }

    fn require_workspace_directory(&self, id: &str) -> Result<PathBuf, String> {
        let path = self.resolve_existing_workspace_id(id, true)?;
        if path.is_dir() {
            Ok(path)
        } else {
            Err(format!("workspace id is not a directory: {id}"))
        }
    }

    fn resolve_existing_workspace_id(&self, id: &str, allow_root: bool) -> Result<PathBuf, String> {
        let relative = id
            .strip_prefix("fs:")
            .ok_or_else(|| "workspace ids must start with `fs:`".to_string())?;
        if relative.is_empty() {
            return if allow_root {
                Ok(self.config.root.clone())
            } else {
                Err("the workspace root cannot be renamed, moved, duplicated, or deleted".into())
            };
        }
        if relative.contains('\\') {
            return Err("workspace ids must use forward slashes".into());
        }

        let relative_path = Path::new(relative);
        let mut lexical = self.config.root.clone();
        for component in relative_path.components() {
            let std::path::Component::Normal(segment) = component else {
                return Err("workspace id contains an invalid path component".into());
            };
            if segment.to_string_lossy().starts_with('.') {
                return Err("hidden workspace paths cannot be mutated through MCP".into());
            }
            lexical.push(segment);
            let metadata = std::fs::symlink_metadata(&lexical)
                .map_err(|_| format!("workspace node not found: {id}"))?;
            if metadata.file_type().is_symlink() {
                return Err(format!("workspace id traverses a symbolic link: {id}"));
            }
        }

        let canonical = lexical
            .canonicalize()
            .map_err(|_| format!("workspace node not found: {id}"))?;
        if !canonical.starts_with(&self.config.root) {
            return Err(format!("workspace id is outside the configured root: {id}"));
        }
        Ok(canonical)
    }

    fn check_http_target(&self, target: &str) -> Result<(), String> {
        self.require_network()?;
        let normalized = bonk_core::domain::url::normalize_url(target);
        let url = url::Url::parse(&normalized).map_err(|error| format!("invalid URL: {error}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("only http:// and https:// targets are allowed".into());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "request URL has no host".to_string())?;
        self.check_target_host(host, url.port())
    }

    fn check_grpc_target(&self, target: &str) -> Result<(), String> {
        self.require_network()?;
        let normalized = if target.contains("://") {
            target.to_string()
        } else {
            format!("http://{target}")
        };
        let url = url::Url::parse(&normalized)
            .map_err(|error| format!("invalid gRPC endpoint: {error}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("only http:// and https:// gRPC endpoints are allowed".into());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "gRPC endpoint has no host".to_string())?;
        self.check_target_host(host, url.port())
    }

    fn check_target_host(&self, host: &str, port: Option<u16>) -> Result<(), String> {
        if target_host_allowed(&self.config.target_hosts, host, port) {
            Ok(())
        } else {
            let host = host.to_ascii_lowercase();
            Err(format!(
                "{DENIED}target host `{host}` is not allowed; add --target-host {host}"
            ))
        }
    }
}

fn summarize(node: RequestNode) -> RequestSummary {
    let (method, target) = if node.protocol == "grpc" {
        let grpc = node.grpc.as_ref();
        (
            "gRPC".into(),
            grpc.map(|value| {
                let method = value.method.as_deref().unwrap_or_default();
                format!("{} {method}", value.endpoint).trim().to_string()
            })
            .unwrap_or_default(),
        )
    } else {
        (
            node.request.method.clone(),
            redact_sensitive_url(&node.request.url),
        )
    };
    RequestSummary {
        id: node.id,
        name: node.name,
        protocol: node.protocol,
        method,
        target,
    }
}

fn compact(nodes: Vec<TreeNode>) -> Vec<TreeEntry> {
    nodes
        .into_iter()
        .map(|node| match node {
            TreeNode::Folder(folder) => TreeEntry::Folder {
                id: folder.id,
                name: folder.name,
                children: compact(folder.children),
            },
            TreeNode::Request(request) => TreeEntry::Request(summarize(*request)),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_jar_follows_the_app_cookie_settings() {
        use reqwest::cookie::CookieStore as _;
        let workspace = TestWorkspace::new();
        let data = workspace.0.join("appdata");
        std::fs::create_dir_all(&data).unwrap();
        let state = data.join("state.json");
        let mut runtime = workspace.runtime(false, true);
        assert!(runtime.read_only_jar().is_none(), "no --app-state, no jar");
        Arc::make_mut(&mut runtime.config).app_state = Some(state.clone());

        // The app saved a cookie into this workspace's jar.
        let root = runtime.config.root.to_string_lossy().into_owned();
        let app_jar = CookieJar::open(jar_path(&data, &root)).unwrap();
        app_jar
            .add("sid=1; Max-Age=3600", "https://api.a.kz/")
            .unwrap();
        app_jar.save().unwrap();
        let url = reqwest::Url::parse("https://api.a.kz/x").unwrap();
        let header = |p: &JarProvider| p.cookies(&url).map(|v| v.to_str().unwrap().to_string());

        std::fs::write(&state, "{}").unwrap();
        let jar = runtime.read_only_jar().expect("jar");
        assert_eq!(header(&jar).as_deref(), Some("sid=1"));
        // Read-only: a response's Set-Cookie does not reach the file.
        let set = reqwest::header::HeaderValue::from_static("new=1");
        jar.set_cookies(&mut std::iter::once(&set), &url);
        assert_eq!(
            CookieJar::open(jar_path(&data, &root))
                .unwrap()
                .list()
                .len(),
            1
        );

        std::fs::write(&state, r#"{"cookiesExclude":["a.kz"]}"#).unwrap();
        assert_eq!(header(&runtime.read_only_jar().unwrap()), None);
        std::fs::write(&state, r#"{"cookieJarScope":"app"}"#).unwrap();
        assert_eq!(
            header(&runtime.read_only_jar().unwrap()),
            None,
            "app-wide jar is empty"
        );
        std::fs::write(&state, r#"{"cookiesSend":false}"#).unwrap();
        assert!(runtime.read_only_jar().is_none());
    }

    struct TestWorkspace(PathBuf);

    impl TestWorkspace {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            static SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "bonk-mcp-test-{}-{nonce}-{seq}",
                std::process::id()
            ));
            std::fs::create_dir(&path).expect("create test workspace");
            Self(path)
        }

        fn runtime(&self, read_only: bool, network_enabled: bool) -> BonkRuntime {
            BonkRuntime::new(RuntimeConfig {
                root: self.0.canonicalize().expect("canonical test workspace"),
                read_only,
                expose_secrets: false,
                network_enabled,
                target_hosts: Vec::new(),
                variable_prefix: "BONK_MCP_TEST_VAR_".into(),
                max_response_body_bytes: 1024 * 1024,
                app_state: None,
                environments: Vec::new(),
                mutating_methods: MethodPolicy::Ask,
                client: None,
                journal: None,
            })
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn request(url: &str) -> HttpRequest {
        HttpRequest {
            method: "GET".into(),
            url: url.into(),
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

    #[test]
    fn target_host_policy_supports_exact_port_and_wildcard() {
        let runtime = BonkRuntime::new(RuntimeConfig {
            root: std::env::temp_dir(),
            read_only: false,
            expose_secrets: false,
            network_enabled: true,
            target_hosts: vec!["api.example.com:8443".into(), "*.internal.test".into()],
            variable_prefix: "BONK_VAR_".into(),
            max_response_body_bytes: 1024 * 1024,
            app_state: None,
            environments: Vec::new(),
            mutating_methods: MethodPolicy::Ask,
            client: None,
            journal: None,
        });
        assert!(runtime
            .check_target_host("api.example.com", Some(8443))
            .is_ok());
        assert!(runtime
            .check_target_host("users.internal.test", None)
            .is_ok());
        assert!(runtime.check_target_host("example.org", None).is_err());
    }

    #[test]
    fn workspace_crud_honors_redaction_and_read_only_mode() {
        let workspace = TestWorkspace::new();
        let runtime = workspace.runtime(false, false);
        assert!(runtime.delete_node("fs:").is_err());
        std::fs::write(workspace.0.join("notes.txt"), "keep").expect("write unrelated file");
        assert!(runtime.delete_node("fs:notes.txt").is_err());
        assert!(workspace.0.join("notes.txt").exists());
        let mut node = RequestNode {
            id: String::new(),
            name: "Health".into(),
            protocol: "http".into(),
            request: request("https://example.com/health?api_key=literal"),
            params: None,
            grpc: None,
            spec: Some(
                serde_json::json!({ "op": "health", "base": { "headers": { "Authorization": "Bearer literal" } } }),
            ),
        };
        node.request
            .headers
            .insert("Authorization".into(), "Bearer literal".into());
        let saved = runtime
            .save_request(None, "fs:", node)
            .expect("save request");
        let id = saved.id.expect("saved id");
        let loaded = runtime.get_request(&id, false).expect("read request");
        assert_eq!(
            loaded
                .request
                .headers
                .get("Authorization")
                .map(String::as_str),
            Some("<redacted>")
        );
        assert!(!loaded.request.url.contains("literal"));
        assert!(
            loaded.spec.is_none(),
            "the import link copies headers: never shown"
        );
        assert!(runtime.get_request(&id, true).is_err());

        let read_only = workspace.runtime(true, false);
        assert!(read_only.delete_node(&id).is_err());
        assert_eq!(read_only.list_requests(None, None).unwrap().len(), 1);
    }

    #[test]
    fn compact_tree_keeps_names_and_targets_but_drops_request_details() {
        let workspace = TestWorkspace::new();
        let runtime = workspace.runtime(false, false);
        let folder = runtime
            .create_folder("fs:", "Payments")
            .expect("create folder")
            .id
            .expect("folder id");
        let mut node = RequestNode {
            id: String::new(),
            name: "Charge".into(),
            protocol: "http".into(),
            request: request("https://example.com/charge?api_key=literal"),
            params: None,
            grpc: None,
            spec: None,
        };
        node.request.method = "POST".into();
        node.request.body = Some("{\"amount\": 12900}".into());
        runtime
            .save_request(None, &folder, node)
            .expect("save request");

        let tree = serde_json::to_value(runtime.compact_tree().expect("compact tree")).unwrap();
        let charge = &tree[0]["children"][0];
        assert_eq!(tree[0]["kind"], "folder");
        assert_eq!(tree[0]["name"], "Payments");
        assert_eq!(charge["kind"], "request");
        assert_eq!(charge["method"], "POST");
        assert!(charge["target"]
            .as_str()
            .is_some_and(|target| target.starts_with("https://example.com/charge")
                && !target.contains("literal")));
        assert!(charge.get("request").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn workspace_mutations_reject_symbolic_links() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new();
        let outside = TestWorkspace::new();
        symlink(&outside.0, workspace.0.join("linked")).expect("create symlink");
        let runtime = workspace.runtime(false, false);
        assert!(runtime.create_folder("fs:linked", "escaped").is_err());
        assert!(!outside.0.join("escaped").exists());
    }

    #[tokio::test]
    async fn binary_upload_must_stay_inside_the_workspace() {
        let workspace = TestWorkspace::new();
        let outside = TestWorkspace::new();
        let secret = outside.0.join("id_rsa");
        std::fs::write(&secret, "secret").expect("write outside file");
        let mut upload = request("https://example.com/upload");
        upload.method = "POST".into();
        upload.body_mode = Some("binary".into());
        upload.binary_file_path = Some(secret.to_string_lossy().into_owned());

        let error = workspace
            .runtime(false, false)
            .validate_http(upload, None, BTreeMap::new(), None)
            .await
            .expect_err("a binary body outside the workspace must be rejected");
        assert!(error.contains("outside the workspace"), "{error}");
    }

    #[test]
    fn method_policy_gates_only_mutating_methods() {
        use MethodGate::*;
        assert_eq!(method_gate(MethodPolicy::Deny, "get", false), Proceed);
        assert_eq!(method_gate(MethodPolicy::Allow, "DELETE", false), Proceed);
        assert!(matches!(
            method_gate(MethodPolicy::Deny, "post", true),
            Refuse(message) if message.starts_with(DENIED) && message.contains("POST")
        ));
        assert_eq!(method_gate(MethodPolicy::Ask, "PATCH", true), Elicit);
        // No elicitation = no way for the user to approve: refuse, never trust the model.
        assert!(matches!(
            method_gate(MethodPolicy::Ask, "PUT", false),
            Refuse(message) if message.starts_with(DENIED)
        ));
    }

    #[tokio::test]
    async fn app_environments_resolve_and_respect_the_allow_list() {
        let workspace = TestWorkspace::new();
        let state = workspace.0.join("state.json");
        std::fs::write(
            &state,
            r#"{
              "globals": [
                {"key": "base", "value": "https://global.test", "enabled": true},
                {"key": "off", "value": "x", "enabled": false}
              ],
              "environments": [
                {"id": "e1", "name": "Staging", "vars": [
                  {"key": "base", "value": "https://staging.test", "enabled": true},
                  {"key": "token", "value": "", "enabled": true, "secret": true}
                ]},
                {"id": "e2", "name": "Prod", "vars": []}
              ]
            }"#,
        )
        .expect("write state");
        let app = load_app_vars(Some(&state));
        let keychain = |account: &str| (account == "env:e1:token").then(|| "s3cret".to_string());
        let (env, globals, secrets) =
            app_scopes(&app, Some("Staging"), &keychain).expect("staging scopes");
        let scope = merged_scope(&globals, &env);
        assert_eq!(
            resolve_text("{{base}}/{{token}}", &scope),
            "https://staging.test/s3cret"
        );
        assert!(!scope.contains_key("off"));
        assert_eq!(secrets, vec!["s3cret".to_string()]);
        assert!(app_scopes(&app, Some("Missing"), &keychain).is_err());

        let mut runtime = workspace.runtime(false, true);
        let config = Arc::make_mut(&mut runtime.config);
        config.app_state = Some(state);
        config.environments = vec!["Staging".into()];
        let denied = runtime
            .validate_http(request("{{base}}/x"), None, BTreeMap::new(), Some("Prod"))
            .await
            .expect_err("Prod is not allowed");
        assert!(denied.starts_with(DENIED), "{denied}");
        let validated = runtime
            .validate_http(request("{{base}}/x"), None, BTreeMap::new(), None)
            .await
            .expect("globals only");
        assert_eq!(validated.url, "https://global.test/x");
        assert_eq!(
            runtime.workspace_info().unwrap().environments,
            vec!["Staging"]
        );
    }

    #[tokio::test]
    async fn local_proto_schema_works_with_network_disabled() {
        let workspace = TestWorkspace::new();
        std::fs::write(
            workspace.0.join("echo.proto"),
            r#"syntax = "proto3";
package demo;
service Echo { rpc Say (SayRequest) returns (SayReply); }
message SayRequest { string text = 1; }
message SayReply { string text = 1; }
"#,
        )
        .expect("write proto");
        let runtime = workspace.runtime(false, false);
        let tree = runtime
            .grpc_reflect(GrpcSchemaArgs {
                endpoint: String::new(),
                plaintext: false,
                proto_paths: vec!["echo.proto".into()],
                import_paths: Vec::new(),
                variables: BTreeMap::new(),
                environment: None,
            })
            .await
            .expect("compile local proto");
        assert_eq!(tree.services[0].name, "demo.Echo");
    }
}
