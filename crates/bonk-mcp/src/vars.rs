use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use bonk_core::domain::{http::HttpRequest, request_prep::VAR_RE};
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
    for captures in VAR_RE.captures_iter(value) {
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
