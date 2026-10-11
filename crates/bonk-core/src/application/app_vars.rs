//! Globals and environments the Bonk app saved (state.json), with secret values from the
//! OS keychain. bonk-mcp and bonk-cli resolve `{{vars}}` from these.

use std::{collections::BTreeMap, path::Path};

use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;

pub type VariableMap = BTreeMap<String, String>;
/// (environment, globals, secret values to redact)
pub type Scopes = (VariableMap, VariableMap, Vec<String>);

/// Keychain service the Bonk app stores secret variables under (see src/app/secrets.ts).
const KEYCHAIN_SERVICE: &str = "io.github.nekidaz.bonk";

#[derive(Debug, Default, Deserialize)]
pub struct VarRow {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub secret: bool,
}

impl VarRow {
    pub fn active(&self) -> bool {
        self.enabled.unwrap_or(true) && !self.key.trim().is_empty()
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct AppEnvironment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub vars: Vec<VarRow>,
}

/// Postman-style globals and environments saved by the Bonk app.
#[derive(Debug, Default)]
pub struct AppVars {
    pub globals: Vec<VarRow>,
    pub environments: Vec<AppEnvironment>,
}

pub fn load_app_vars(path: Option<&Path>) -> AppVars {
    let Some(state) = path.and_then(|path| super::app_state::load_map(path).ok()) else {
        return AppVars::default();
    };
    AppVars {
        globals: state_field(&state, "globals"),
        environments: state_field(&state, "environments"),
    }
}

pub fn state_field<T: DeserializeOwned + Default>(state: &Value, name: &str) -> T {
    state
        .get(name)
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub fn keychain_secret(account: &str) -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .ok()?
        .get_password()
        .ok()
}

/// (environment, globals, secret values) from the app state. Secret rows saved
/// with an empty value live in the keychain under `globals:<key>` /
/// `env:<envId>:<key>`; only the selected environment is looked up.
pub fn app_scopes(
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
pub fn rows_scope(
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
