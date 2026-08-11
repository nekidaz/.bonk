use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bonk_core::{
    application::{grpc_native, http, scripts, workspace},
    conn::GrpcDescriptorCache,
    domain::{
        http::{AuthConfig, BodyParam, HttpRequest, HttpResponse, RequestSettings},
        workspace::{GrpcTabState, Param, RequestNode, TreeNode},
    },
};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::types::{
    GrpcCallOutput, GrpcSchemaArgs, HttpResponseOutput, HttpRunOutput, MutationResult,
    RequestSummary, ScriptTest, ValidationResult, WorkspaceInfo,
};

type VariableMap = BTreeMap<String, String>;
type ResolvedGrpcScopes = (String, VariableMap, VariableMap);

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub root: PathBuf,
    pub read_only: bool,
    pub expose_secrets: bool,
    pub network_enabled: bool,
    pub target_hosts: Vec<String>,
    pub variable_prefix: String,
    pub max_response_body_bytes: usize,
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
        })
    }

    pub fn redacted_tree(&self) -> Result<Vec<TreeNode>, String> {
        let mut tree = self.tree()?;
        redact_tree(&mut tree);
        Ok(tree)
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
            .map(|node| {
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
            })
            .filter(|item| {
                query.as_deref().is_none_or(|needle| {
                    item.id.to_ascii_lowercase().contains(needle)
                        || item.name.to_ascii_lowercase().contains(needle)
                        || item.target.to_ascii_lowercase().contains(needle)
                })
            })
            .collect::<Vec<_>>();
        out.sort_by(|a, b| a.id.to_ascii_lowercase().cmp(&b.id.to_ascii_lowercase()));
        Ok(out)
    }

    pub fn get_request(&self, id: &str, include_secrets: bool) -> Result<RequestNode, String> {
        let node = self.find_request(id)?;
        if include_secrets && !self.config.expose_secrets {
            return Err(
                "literal stored credentials are disabled; restart bonk-mcp with --expose-secrets only if the user explicitly accepts that risk"
                    .into(),
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
            Err("workspace writes are disabled by --read-only".into())
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
        names.sort();
        names.dedup();
        names
    }

    fn scopes(
        &self,
        variables: BTreeMap<String, String>,
    ) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
        let globals = std::env::vars()
            .filter_map(|(name, value)| {
                name.strip_prefix(&self.config.variable_prefix)
                    .filter(|key| !key.is_empty())
                    .map(|key| (key.to_string(), value))
            })
            .collect();
        (variables, globals)
    }

    pub async fn validate_http(
        &self,
        mut request: HttpRequest,
        params: Option<Vec<Param>>,
        variables: BTreeMap<String, String>,
    ) -> Result<ValidationResult, String> {
        materialize_body_and_params(&mut request, params.as_deref());
        let (environment, globals) = self.scopes(variables);
        let secrets = globals.values().cloned().collect::<Vec<_>>();
        let scope = merged_scope(&globals, &environment);
        resolve_http_request(&mut request, &scope);
        apply_auth(&mut request)?;
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
        settings: RequestSettings,
    ) -> Result<HttpRunOutput, String> {
        self.require_network()?;
        materialize_body_and_params(&mut request, params.as_deref());
        let (mut environment, mut globals) = self.scopes(variables);
        let secrets = globals.values().cloned().collect::<Vec<_>>();
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
        resolve_http_request(&mut request, &scope);
        apply_auth(&mut request)?;
        self.normalize_file_paths(&mut request)
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let unresolved = unresolved_in_request(&request);
        if !unresolved.is_empty() {
            return Err(format!("unresolved variables: {}", unresolved.join(", ")));
        }
        self.check_http_target(&request.url)
            .map_err(|error| sanitize_error(&error, &secrets))?;

        let settings = settings.normalized();
        let client = build_http_client(&settings, &self.config.target_hosts)?;
        let response = http::http_send(client, request.clone(), settings)
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
            response: sanitize_http_response(response, &secrets),
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
        settings: RequestSettings,
    ) -> Result<Value, String> {
        let node = self.find_request(id)?;
        if node.protocol == "grpc" {
            let grpc = node
                .grpc
                .ok_or_else(|| "saved gRPC request has no grpc configuration".to_string())?;
            serde_json::to_value(self.execute_saved_grpc(grpc, variables).await?)
                .map_err(|error| error.to_string())
        } else {
            serde_json::to_value(
                self.execute_http(node.request, node.params, variables, settings)
                    .await?,
            )
            .map_err(|error| error.to_string())
        }
    }

    pub async fn grpc_reflect(
        &self,
        schema: GrpcSchemaArgs,
    ) -> Result<bonk_core::domain::grpc::ServiceTree, String> {
        let (endpoint, _, globals) = self.resolve_grpc_endpoint(&schema)?;
        let secrets = globals.values().cloned().collect::<Vec<_>>();
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
        let (endpoint, _, globals) = self.resolve_grpc_endpoint(&schema)?;
        let secrets = globals.values().cloned().collect::<Vec<_>>();
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
        let (endpoint, scope, globals) = self.resolve_grpc_endpoint(&schema)?;
        let secrets = globals.values().cloned().collect::<Vec<_>>();
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
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).min(600_000));
        let result = tokio::time::timeout(
            timeout,
            grpc_native::call(channel, cache, &method, &message, &metadata),
        )
        .await
        .map_err(|_| format!("gRPC call timed out after {} ms", timeout.as_millis()))?
        .map_err(|error| sanitize_error(&error, &secrets))?;
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
        variables: BTreeMap<String, String>,
    ) -> Result<GrpcCallOutput, String> {
        self.require_network()?;
        let (mut environment, mut globals) = self.scopes(variables);
        let secrets = globals.values().cloned().collect::<Vec<_>>();
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
        message = resolve_text(&message, &scope);
        metadata = metadata
            .into_iter()
            .map(|(key, value)| (resolve_text(&key, &scope), resolve_text(&value, &scope)))
            .collect();
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
        };
        let cache = self
            .load_grpc_schema(&schema, &endpoint)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let channel = grpc_native::connect(&endpoint, grpc.plaintext)
            .await
            .map_err(|error| sanitize_error(&error, &secrets))?;
        let metadata_map = metadata.clone().into_iter().collect::<HashMap<_, _>>();
        let result = tokio::time::timeout(
            Duration::from_secs(30),
            grpc_native::call(channel, cache, &method, &message, &metadata_map),
        )
        .await
        .map_err(|_| "gRPC call timed out after 30000 ms".to_string())?
        .map_err(|error| sanitize_error(&error, &secrets))?;

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
        let (environment, globals) = self.scopes(schema.variables.clone());
        let scope = merged_scope(&globals, &environment);
        let endpoint = resolve_text(&schema.endpoint, &scope);
        reject_unresolved(&[&endpoint])?;
        Ok((endpoint, scope, globals))
    }

    async fn load_grpc_schema(
        &self,
        schema: &GrpcSchemaArgs,
        endpoint: &str,
    ) -> Result<GrpcDescriptorCache, String> {
        if schema.proto_paths.is_empty() {
            self.require_network()?;
            grpc_native::reflect(endpoint, schema.plaintext).await
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
            row.file_path = Some(canonical.to_string_lossy().into_owned());
        }
        Ok(())
    }

    fn require_network(&self) -> Result<(), String> {
        if self.config.network_enabled {
            Ok(())
        } else {
            Err("network calls are disabled by --no-network".into())
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
                "target host `{host}` is not allowed; add --target-host {host}"
            ))
        }
    }
}

fn count_tree(nodes: &[TreeNode], requests: &mut usize, folders: &mut usize) {
    for node in nodes {
        match node {
            TreeNode::Folder(folder) => {
                *folders += 1;
                count_tree(&folder.children, requests, folders);
            }
            TreeNode::Request(_) => *requests += 1,
        }
    }
}

fn collect_requests(nodes: &[TreeNode], out: &mut Vec<RequestNode>) {
    for node in nodes {
        match node {
            TreeNode::Folder(folder) => collect_requests(&folder.children, out),
            TreeNode::Request(request) => out.push((**request).clone()),
        }
    }
}

fn redact_tree(nodes: &mut [TreeNode]) {
    for node in nodes {
        match node {
            TreeNode::Folder(folder) => redact_tree(&mut folder.children),
            TreeNode::Request(request) => {
                **request = redact_node((**request).clone());
            }
        }
    }
}

fn redact_node(mut node: RequestNode) -> RequestNode {
    node.request.url = redact_sensitive_url(&node.request.url);
    for (name, value) in &mut node.request.headers {
        if is_sensitive_header(name) {
            *value = "<redacted>".into();
        }
    }
    if let Some(auth) = node.request.auth.as_mut() {
        redact_option(&mut auth.bearer_token);
        redact_option(&mut auth.basic_password);
        redact_option(&mut auth.api_key_value);
    }
    if let Some(grpc) = node.grpc.as_mut() {
        for (name, value) in &mut grpc.metadata {
            if is_sensitive_header(name) {
                *value = "<redacted>".into();
            }
        }
    }
    node
}

fn redact_option(value: &mut Option<String>) {
    if value.as_deref().is_some_and(|value| !value.is_empty()) {
        *value = Some("<redacted>".into());
    }
}

fn is_sensitive_header(name: &str) -> bool {
    let name = name.to_ascii_lowercase().replace('_', "-");
    matches!(
        name.as_str(),
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "set-cookie"
            | "x-api-key"
            | "api-key"
            | "apikey"
            | "key"
            | "password"
            | "passwd"
            | "credential"
    ) || name.contains("token")
        || name.contains("secret")
        || name.contains("api-key")
        || name.contains("password")
}

fn materialize_body_and_params(request: &mut HttpRequest, params: Option<&[Param]>) {
    if let Some(rows) = params.filter(|rows| !rows.is_empty()) {
        request.url = sync_url_with_params(&request.url, rows);
    }
    match request.body_mode.as_deref().unwrap_or("raw") {
        "none" => request.body = None,
        "urlencoded" => {
            let rows = enabled_body_params(request);
            if !rows.is_empty() {
                request.body = Some(
                    rows.into_iter()
                        .map(|row| {
                            format!(
                                "{}={}",
                                encode_preserving_vars(&row.key, true),
                                encode_preserving_vars(&row.value, true)
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("&"),
                );
                set_header_if_missing(
                    &mut request.headers,
                    "Content-Type",
                    "application/x-www-form-urlencoded",
                );
            }
        }
        "form-data" => request.body = None,
        "graphql" => {
            if request.body.as_deref().is_some_and(|body| !body.is_empty()) {
                set_header_if_missing(&mut request.headers, "Content-Type", "application/json");
            }
        }
        "raw" => {
            if request.raw_body_format.as_deref() == Some("JSON")
                && request.body.as_deref().is_some_and(|body| !body.is_empty())
            {
                set_header_if_missing(&mut request.headers, "Content-Type", "application/json");
            }
        }
        _ => {}
    }
}

fn enabled_body_params(request: &HttpRequest) -> Vec<&BodyParam> {
    request
        .body_params
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .collect()
}

fn set_header_if_missing(headers: &mut BTreeMap<String, String>, name: &str, value: &str) {
    if !headers.keys().any(|key| key.eq_ignore_ascii_case(name)) {
        headers.insert(name.into(), value.into());
    }
}

fn apply_auth(request: &mut HttpRequest) -> Result<(), String> {
    let Some(auth) = request.auth.clone() else {
        return Ok(());
    };
    match auth.auth_type.as_str() {
        "none" | "" => {}
        "bearer" => {
            if let Some(token) = auth.bearer_token.filter(|value| !value.trim().is_empty()) {
                set_header_if_missing(
                    &mut request.headers,
                    "Authorization",
                    &format!("Bearer {}", token.trim()),
                );
            }
        }
        "basic" => {
            let username = auth.basic_username.unwrap_or_default();
            let password = auth.basic_password.unwrap_or_default();
            if !username.is_empty() || !password.is_empty() {
                let value = BASE64.encode(format!("{username}:{password}"));
                set_header_if_missing(
                    &mut request.headers,
                    "Authorization",
                    &format!("Basic {value}"),
                );
            }
        }
        "apiKey" | "apikey" | "api-key" => {
            let name = auth.api_key_name.unwrap_or_default();
            let value = auth.api_key_value.unwrap_or_default();
            if !name.trim().is_empty() {
                if auth.api_key_in.as_deref().unwrap_or("header") == "query" {
                    request.url = append_query(&request.url, name.trim(), &value);
                } else {
                    set_header_if_missing(&mut request.headers, name.trim(), &value);
                }
            }
        }
        other => return Err(format!("unsupported auth type: {other}")),
    }
    Ok(())
}

fn sync_url_with_params(url: &str, params: &[Param]) -> String {
    let pairs = params
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .map(|row| {
            format!(
                "{}={}",
                encode_preserving_vars(row.key.trim(), false),
                encode_preserving_vars(&row.value, false)
            )
        })
        .collect::<Vec<_>>();
    let (without_hash, hash) = url
        .split_once('#')
        .map_or((url, ""), |(left, right)| (left, right));
    let base = without_hash
        .split_once('?')
        .map_or(without_hash, |(left, _)| left);
    let query = if pairs.is_empty() {
        String::new()
    } else {
        format!("?{}", pairs.join("&"))
    };
    let hash = if hash.is_empty() {
        String::new()
    } else {
        format!("#{hash}")
    };
    format!("{base}{query}{hash}")
}

fn append_query(url: &str, name: &str, value: &str) -> String {
    let (before_hash, hash) = url
        .split_once('#')
        .map_or((url, ""), |(left, right)| (left, right));
    let joiner = if before_hash.contains('?') {
        if before_hash.ends_with('?') || before_hash.ends_with('&') {
            ""
        } else {
            "&"
        }
    } else {
        "?"
    };
    let hash = if hash.is_empty() {
        String::new()
    } else {
        format!("#{hash}")
    };
    format!(
        "{before_hash}{joiner}{}={}{hash}",
        encode_preserving_vars(name, false),
        encode_preserving_vars(value, false)
    )
}

fn encode_preserving_vars(value: &str, space_as_plus: bool) -> String {
    let re = variable_regex();
    let mut out = String::new();
    let mut last = 0;
    for matched in re.find_iter(value) {
        out.push_str(&percent_encode(
            &value[last..matched.start()],
            space_as_plus,
        ));
        out.push_str(matched.as_str());
        last = matched.end();
    }
    out.push_str(&percent_encode(&value[last..], space_as_plus));
    out
}

fn percent_encode(value: &str, space_as_plus: bool) -> String {
    let encoded = url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
    if space_as_plus {
        encoded
    } else {
        encoded.replace('+', "%20")
    }
}

fn resolve_http_request(request: &mut HttpRequest, scope: &BTreeMap<String, String>) {
    request.url = resolve_text(&request.url, scope);
    request.body = request
        .body
        .as_ref()
        .map(|value| resolve_text(value, scope));
    request.headers = std::mem::take(&mut request.headers)
        .into_iter()
        .map(|(key, value)| (resolve_text(&key, scope), resolve_text(&value, scope)))
        .collect();
    if let Some(rows) = request.body_params.as_mut() {
        for row in rows {
            row.key = resolve_text(&row.key, scope);
            row.value = resolve_text(&row.value, scope);
            row.file_path = row
                .file_path
                .as_ref()
                .map(|value| resolve_text(value, scope));
        }
    }
    if let Some(auth) = request.auth.as_mut() {
        resolve_auth(auth, scope);
    }
}

fn resolve_auth(auth: &mut AuthConfig, scope: &BTreeMap<String, String>) {
    for value in [
        &mut auth.bearer_token,
        &mut auth.basic_username,
        &mut auth.basic_password,
        &mut auth.api_key_name,
        &mut auth.api_key_value,
    ] {
        if let Some(current) = value.as_ref() {
            *value = Some(resolve_text(current, scope));
        }
    }
}

fn variable_regex() -> Regex {
    Regex::new(r"\{\{\s*([^{}]*?)\s*\}\}").expect("valid variable regex")
}

fn resolve_text(value: &str, scope: &BTreeMap<String, String>) -> String {
    variable_regex()
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let name = captures.get(1).map_or("", |value| value.as_str()).trim();
            scope
                .get(name)
                .cloned()
                .unwrap_or_else(|| captures[0].to_string())
        })
        .into_owned()
}

fn merged_scope(
    globals: &BTreeMap<String, String>,
    environment: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut scope = globals.clone();
    scope.extend(environment.clone());
    scope
}

fn unresolved_in_request(request: &HttpRequest) -> Vec<String> {
    let mut names = BTreeSet::new();
    collect_unresolved(&request.url, &mut names);
    if let Some(body) = &request.body {
        collect_unresolved(body, &mut names);
    }
    for (key, value) in &request.headers {
        collect_unresolved(key, &mut names);
        collect_unresolved(value, &mut names);
    }
    if let Some(rows) = &request.body_params {
        for row in rows {
            collect_unresolved(&row.key, &mut names);
            collect_unresolved(&row.value, &mut names);
            if let Some(path) = &row.file_path {
                collect_unresolved(path, &mut names);
            }
        }
    }
    names.into_iter().collect()
}

fn collect_unresolved(value: &str, out: &mut BTreeSet<String>) {
    for captures in variable_regex().captures_iter(value) {
        if let Some(name) = captures.get(1) {
            out.insert(name.as_str().trim().to_string());
        }
    }
}

fn reject_unresolved(values: &[&str]) -> Result<(), String> {
    let mut names = BTreeSet::new();
    for value in values {
        collect_unresolved(value, &mut names);
    }
    if names.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "unresolved variables: {}",
            names.into_iter().collect::<Vec<_>>().join(", ")
        ))
    }
}

fn reject_unresolved_grpc<'a>(
    endpoint: &str,
    method: &str,
    message: &str,
    metadata: impl Iterator<Item = (&'a String, &'a String)>,
) -> Result<(), String> {
    let mut names = BTreeSet::new();
    for value in [endpoint, method, message] {
        collect_unresolved(value, &mut names);
    }
    for (name, value) in metadata {
        collect_unresolved(name, &mut names);
        collect_unresolved(value, &mut names);
    }
    if names.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "unresolved variables: {}",
            names.into_iter().collect::<Vec<_>>().join(", ")
        ))
    }
}

fn target_host_allowed(patterns: &[String], host: &str, port: Option<u16>) -> bool {
    if patterns.is_empty() {
        return true;
    }
    let host = host.to_ascii_lowercase();
    let authority = port.map(|port| format!("{host}:{port}"));
    patterns.iter().any(|candidate| {
        let candidate = candidate.to_ascii_lowercase();
        candidate == host
            || authority.as_deref() == Some(candidate.as_str())
            || candidate
                .strip_prefix("*.")
                .is_some_and(|suffix| host.ends_with(&format!(".{suffix}")))
    })
}

fn build_http_client(
    settings: &RequestSettings,
    target_hosts: &[String],
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("bonk-mcp/{}", env!("CARGO_PKG_VERSION")))
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true)
        .danger_accept_invalid_certs(!settings.validate_tls);
    if settings.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(settings.timeout_ms));
    }
    if settings.follow_redirects {
        let target_hosts = target_hosts.to_vec();
        builder = builder.redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error(std::io::Error::other("too many redirects"));
            }
            let target = attempt.url();
            if !matches!(target.scheme(), "http" | "https") {
                return attempt.error(std::io::Error::other(
                    "redirect target must use http or https",
                ));
            }
            let Some(host) = target.host_str().map(str::to_owned) else {
                return attempt.error(std::io::Error::other("redirect target has no host"));
            };
            let port = target.port();
            if target_host_allowed(&target_hosts, &host, port) {
                attempt.follow()
            } else {
                attempt.error(std::io::Error::other(format!(
                    "redirect target host `{host}` is not allowed"
                )))
            }
        }));
    } else {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    builder
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptResultRaw {
    #[serde(default)]
    logs: Vec<String>,
    #[serde(default)]
    tests: Vec<ScriptTest>,
    #[serde(default)]
    env_set: BTreeMap<String, String>,
    #[serde(default)]
    env_unset: Vec<String>,
    #[serde(default)]
    globals_set: BTreeMap<String, String>,
    #[serde(default)]
    globals_unset: Vec<String>,
    #[serde(default)]
    request_patch: Option<RequestPatch>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestPatch {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    headers: Option<BTreeMap<String, String>>,
}

#[derive(Default)]
struct ScriptState {
    logs: Vec<String>,
    tests: Vec<ScriptTest>,
    script_error: Option<String>,
    changed: BTreeSet<String>,
}

impl ScriptState {
    fn apply(
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

async fn run_script(phase: &str, code: &str, context: Value) -> Result<ScriptResultRaw, String> {
    let phase = phase.to_string();
    let code = code.to_string();
    let context = serde_json::to_string(&context).map_err(|error| error.to_string())?;
    let raw = tokio::task::spawn_blocking(move || scripts::run_script(&phase, &code, &context))
        .await
        .map_err(|error| format!("script task failed: {error}"))??;
    serde_json::from_str(&raw).map_err(|error| format!("invalid script result: {error}"))
}

fn apply_request_patch(request: &mut HttpRequest, patch: Option<RequestPatch>) {
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

fn http_script_context(
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
fn grpc_script_context(
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

fn sanitize_http_response(response: HttpResponse, secrets: &[String]) -> HttpResponseOutput {
    let headers = response
        .headers
        .into_iter()
        .map(|(name, value)| {
            let value = if is_sensitive_header(&name) {
                "<redacted>".into()
            } else {
                sanitize_text(&value, secrets)
            };
            (name, value)
        })
        .collect();
    HttpResponseOutput {
        status: response.status,
        headers,
        body: sanitize_text(&response.body, secrets),
        final_url: redact_url(&response.final_url, secrets),
        elapsed_ms: response.elapsed_ms,
        size_bytes: response.size_bytes,
        body_truncated: response.body_truncated,
    }
}

fn sanitize_tests(tests: Vec<ScriptTest>, secrets: &[String]) -> Vec<ScriptTest> {
    tests
        .into_iter()
        .map(|mut test| {
            test.name = sanitize_text(&test.name, secrets);
            test.error = test.error.map(|value| sanitize_text(&value, secrets));
            test
        })
        .collect()
}

fn sanitize_text(value: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(value.to_string(), |text, secret| {
            let encoded = percent_encode(secret, false);
            text.replace(secret, "<redacted>")
                .replace(&encoded, "<redacted>")
        })
}

fn sanitize_error(value: &str, secrets: &[String]) -> String {
    let sanitized = sanitize_text(value, secrets);
    let url_pattern = Regex::new(r#"https?://[^\s\"'<>]+"#).expect("valid URL regex");
    url_pattern
        .replace_all(&sanitized, |captures: &regex::Captures<'_>| {
            redact_sensitive_url(&captures[0])
        })
        .into_owned()
}

fn redact_url(value: &str, secrets: &[String]) -> String {
    sanitize_text(&redact_sensitive_url(value), secrets)
}

fn redact_sensitive_url(value: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(value) else {
        return value.to_string();
    };
    let pairs = parsed
        .query_pairs()
        .map(|(name, value)| {
            let value = if is_sensitive_header(&name) {
                "<redacted>".into()
            } else {
                value.into_owned()
            };
            (name.into_owned(), value)
        })
        .collect::<Vec<_>>();
    if parsed.password().is_some() {
        let _ = parsed.set_password(Some("<redacted>"));
    }
    if !pairs.is_empty() {
        parsed.query_pairs_mut().clear().extend_pairs(pairs);
    }
    parsed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestWorkspace(PathBuf);

    impl TestWorkspace {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("bonk-mcp-test-{}-{nonce}", std::process::id()));
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
            body_mode: None,
            raw_body_format: None,
            body_params: None,
            auth: None,
            pre_request_script: None,
            test_script: None,
        }
    }

    #[test]
    fn resolves_variables_across_request_fields() {
        let mut request = request("{{base}}/users/{{id}}");
        request
            .headers
            .insert("x-{{name}}".into(), "{{token}}".into());
        let scope = BTreeMap::from([
            ("base".into(), "https://example.com".into()),
            ("id".into(), "42".into()),
            ("name".into(), "api".into()),
            ("token".into(), "secret".into()),
        ]);
        resolve_http_request(&mut request, &scope);
        assert_eq!(request.url, "https://example.com/users/42");
        assert_eq!(request.headers.get("x-api").unwrap(), "secret");
    }

    #[test]
    fn query_encoder_preserves_placeholders() {
        assert_eq!(
            encode_preserving_vars("hello {{ token }} world", false),
            "hello%20{{ token }}%20world"
        );
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
    fn redacts_process_secret_values() {
        assert_eq!(
            sanitize_text("token=abcd1234", &["abcd1234".into()]),
            "token=<redacted>"
        );
    }

    #[test]
    fn redacts_sensitive_url_parts() {
        let redacted = redact_sensitive_url(
            "https://user:pass@example.com/items?api_key=abc&search=visible&access_token=xyz",
        );
        assert!(!redacted.contains("pass"));
        assert!(!redacted.contains("abc"));
        assert!(!redacted.contains("xyz"));
        assert!(redacted.contains("search=visible"));
    }

    #[test]
    fn redacts_secrets_from_transport_errors() {
        let error = sanitize_error(
            "request failed for https://example.com/items?api_key=literal: token short",
            &["short".into()],
        );
        assert!(!error.contains("literal"));
        assert!(!error.contains("short"));
        assert!(error.contains("<redacted>"));
    }

    #[test]
    fn rejects_unresolved_grpc_metadata() {
        let metadata = BTreeMap::from([("authorization".into(), "Bearer {{TOKEN}}".into())]);
        let error = reject_unresolved_grpc(
            "api.example.com:443",
            "/demo.Echo/Say",
            "{}",
            metadata.iter(),
        )
        .expect_err("metadata variable must be resolved");
        assert!(error.contains("TOKEN"));
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
        assert!(runtime.get_request(&id, true).is_err());

        let read_only = workspace.runtime(true, false);
        assert!(read_only.delete_node(&id).is_err());
        assert_eq!(read_only.list_requests(None, None).unwrap().len(), 1);
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
            })
            .await
            .expect("compile local proto");
        assert_eq!(tree.services[0].name, "demo.Echo");
    }
}
