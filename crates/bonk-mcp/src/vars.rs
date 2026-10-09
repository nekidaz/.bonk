use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use bonk_core::domain::http::{AuthConfig, HttpRequest};
use regex::Regex;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;

pub(crate) type VariableMap = BTreeMap<String, String>;
/// (environment, globals, secret values to redact)
pub(crate) type Scopes = (VariableMap, VariableMap, Vec<String>);

/// Keychain service the Bonk app stores secret variables under (see src/app/secrets.ts).
const KEYCHAIN_SERVICE: &str = "io.github.nekidaz.bonk";

#[derive(Debug, Default, Deserialize)]
pub(crate) struct VarRow {
    #[serde(default)]
    pub(crate) key: String,
    #[serde(default)]
    pub(crate) value: String,
    #[serde(default)]
    pub(crate) enabled: Option<bool>,
    #[serde(default)]
    pub(crate) secret: bool,
}

impl VarRow {
    pub(crate) fn active(&self) -> bool {
        self.enabled.unwrap_or(true) && !self.key.trim().is_empty()
    }
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct AppEnvironment {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) vars: Vec<VarRow>,
}

/// Postman-style globals and environments saved by the Bonk app.
#[derive(Debug, Default)]
pub(crate) struct AppVars {
    pub(crate) globals: Vec<VarRow>,
    pub(crate) environments: Vec<AppEnvironment>,
}

pub(crate) fn load_app_vars(path: Option<&Path>) -> AppVars {
    let Some(state) = path.and_then(|path| bonk_core::application::app_state::load_map(path).ok())
    else {
        return AppVars::default();
    };
    AppVars {
        globals: state_field(&state, "globals"),
        environments: state_field(&state, "environments"),
    }
}

pub(crate) fn state_field<T: DeserializeOwned + Default>(state: &Value, name: &str) -> T {
    state
        .get(name)
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub(crate) fn keychain_secret(account: &str) -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .ok()?
        .get_password()
        .ok()
}

/// (environment, globals, secret values) from the app state. Secret rows saved
/// with an empty value live in the keychain under `globals:<key>` /
/// `env:<envId>:<key>`; only the selected environment is looked up.
pub(crate) fn app_scopes(
    app: &AppVars,
    environment: Option<&str>,
    keychain: &dyn Fn(&str) -> Option<String>,
) -> Result<Scopes, String> {
    let mut secrets = Vec::new();
    let globals = rows_scope(
        &app.globals,
        &|key| format!("globals:{key}"),
        keychain,
        &mut secrets,
    );
    let env = match environment {
        Some(name) => {
            let env = app
                .environments
                .iter()
                .find(|env| env.name == name)
                .ok_or_else(|| format!("environment `{name}` was not found in the Bonk app"))?;
            rows_scope(
                &env.vars,
                &|key| format!("env:{}:{key}", env.id),
                keychain,
                &mut secrets,
            )
        }
        None => VariableMap::new(),
    };
    Ok((env, globals, secrets))
}

/// Enabled rows with a non-empty key; on duplicates the last row wins (mirrors vars.ts).
pub(crate) fn rows_scope(
    rows: &[VarRow],
    account: &dyn Fn(&str) -> String,
    keychain: &dyn Fn(&str) -> Option<String>,
    secrets: &mut Vec<String>,
) -> VariableMap {
    let mut scope = VariableMap::new();
    for row in rows.iter().filter(|row| row.active()) {
        let value = if row.secret && row.value.is_empty() {
            keychain(&account(&row.key)).unwrap_or_default()
        } else {
            row.value.clone()
        };
        if row.secret {
            secrets.push(value.clone());
        }
        scope.insert(row.key.trim().to_string(), value);
    }
    scope
}

pub(crate) fn resolve_http_request(request: &mut HttpRequest, scope: &BTreeMap<String, String>) {
    request.url = resolve_text(&request.url, scope);
    request.body = request
        .body
        .as_ref()
        .map(|value| resolve_text(value, scope));
    request.binary_file_path = request
        .binary_file_path
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

pub(crate) fn resolve_auth(auth: &mut AuthConfig, scope: &BTreeMap<String, String>) {
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

pub(crate) fn variable_regex() -> Regex {
    Regex::new(r"\{\{\s*([^{}]*?)\s*\}\}").expect("valid variable regex")
}

pub(crate) fn resolve_text(value: &str, scope: &BTreeMap<String, String>) -> String {
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

pub(crate) fn merged_scope(
    globals: &BTreeMap<String, String>,
    environment: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut scope = globals.clone();
    scope.extend(environment.clone());
    scope
}

pub(crate) fn unresolved_in_request(request: &HttpRequest) -> Vec<String> {
    let mut names = BTreeSet::new();
    collect_unresolved(&request.url, &mut names);
    if let Some(body) = &request.body {
        collect_unresolved(body, &mut names);
    }
    if let Some(path) = &request.binary_file_path {
        collect_unresolved(path, &mut names);
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

pub(crate) fn collect_unresolved(value: &str, out: &mut BTreeSet<String>) {
    for captures in variable_regex().captures_iter(value) {
        if let Some(name) = captures.get(1) {
            out.insert(name.as_str().trim().to_string());
        }
    }
}

pub(crate) fn reject_unresolved(values: &[&str]) -> Result<(), String> {
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

pub(crate) fn reject_unresolved_grpc<'a>(
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
