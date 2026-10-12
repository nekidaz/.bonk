//! Portable Runner setups. Requests keep their existing filesystem format;
//! `.bonk/scenarios.json` stores only run intent, public defaults and required secret names.
use super::{
    runner::{self, RunPlan, RunVars},
    workspace,
};
use crate::domain::dynamic_vars::DynamicOptions;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenario {
    pub name: String,
    /// Workspace-relative request/folder paths, in execution order.
    pub paths: Vec<String>,
    #[serde(default)]
    pub variables: RunVars,
    /// Values are supplied by the selected local environment or CI; never stored here.
    #[serde(default)]
    pub required_variables: Vec<String>,
    #[serde(default)]
    pub environment_name: Option<String>,
    #[serde(default = "one")]
    pub iterations: u32,
    #[serde(default)]
    pub dynamic: DynamicOptions,
    #[serde(default)]
    pub data_rows: Vec<super::app_vars::VariableMap>,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default)]
    pub stop_on_failure: bool,
}
fn one() -> u32 {
    1
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    version: u32,
    scenarios: Vec<Scenario>,
}

/// A hidden path outside the request tree. Refuse symlinks so an imported/shared
/// workspace cannot redirect reads or writes outside itself.
pub(super) fn bonk_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| format!("workspace: {e}"))?;
    if !root.is_dir() {
        return Err("workspace is not a directory".into());
    }
    let dir = root.join(".bonk");
    let file = dir.join(name);
    for path in [&dir, &file] {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!("{name} path is a symlink: {}", path.display()))
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("{}: {e}", path.display()))
            }
            _ => {}
        }
    }
    Ok(file)
}

fn file_path(root: &Path) -> Result<PathBuf, String> {
    bonk_file(root, "scenarios.json")
}

fn path_id(path: &str) -> Result<String, String> {
    if path.contains(['\\', ':'])
        || path.starts_with('/')
        || path
            .split('/')
            .any(|p| p == ".." || p == "." || p.is_empty())
    {
        return Err(format!("scenario path must be workspace-relative: {path}"));
    }
    Ok(format!("fs:{path}"))
}

impl Scenario {
    fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() || self.paths.is_empty() {
            return Err("scenario needs a name and at least one path".into());
        }
        for path in &self.paths {
            path_id(path)?;
        }
        if !(1..=10_000).contains(&self.iterations)
            || self.delay_ms > 600_000
            || self.data_rows.len() > 10_000
        {
            return Err("scenario run settings are out of range".into());
        }
        if self
            .required_variables
            .iter()
            .any(|name| name.trim().is_empty())
        {
            return Err("required variable has an empty name".into());
        }
        Ok(())
    }

    pub fn plan(&self, root: &Path) -> Result<RunPlan, String> {
        self.validate()?;
        let tree = workspace::load(&root.to_string_lossy())?;
        let ids = self
            .paths
            .iter()
            .map(|p| path_id(p))
            .collect::<Result<Vec<_>, _>>()?;
        let requests = runner::plan_requests(&tree, &ids)?;
        if requests.is_empty() {
            return Err("scenario has no requests to run".into());
        }
        Ok(RunPlan {
            requests,
            required_variables: self.required_variables.clone(),
            iterations: self.iterations,
            dynamic: self.dynamic.clone(),
            data_rows: self.data_rows.clone(),
            delay_ms: self.delay_ms,
            stop_on_failure: self.stop_on_failure,
            workspace_root: root.to_string_lossy().into_owned(),
            ..RunPlan::default()
        })
    }

    pub fn require_variables(&self, vars: &RunVars) -> Result<(), String> {
        vars.require(&self.required_variables)
    }
}

pub fn load(root: &Path) -> Result<Vec<Scenario>, String> {
    let path = file_path(root)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let file: File = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    if file.version != 1 {
        return Err(format!("unsupported scenarios version: {}", file.version));
    }
    let mut names = BTreeSet::new();
    for scenario in &file.scenarios {
        scenario.validate()?;
        if !names.insert(&scenario.name) {
            return Err(format!("duplicate scenario: {}", scenario.name));
        }
    }
    Ok(file.scenarios)
}

pub fn save(root: &Path, scenario: Scenario) -> Result<(), String> {
    scenario.plan(root)?; // Don't publish a setup referring to missing requests.
    let mut list = load(root)?;
    list.retain(|s| s.name != scenario.name);
    list.push(scenario);
    write(root, list)
}

pub fn delete(root: &Path, name: &str) -> Result<(), String> {
    let mut list = load(root)?;
    list.retain(|s| s.name != name);
    write(root, list)
}

fn write(root: &Path, scenarios: Vec<Scenario>) -> Result<(), String> {
    let path = file_path(root)?;
    std::fs::create_dir_all(path.parent().ok_or("scenario path has no parent")?)
        .map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&File {
        version: 1,
        scenarios,
    })
    .map_err(|e| e.to_string())?;
    workspace::atomic_write(&path, &(text + "\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("bonk-scenarios-{}", fastrand::u64(..)));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(root: &Path) -> Scenario {
        workspace::import_collection(&root.to_string_lossy(), serde_json::from_value(json!({ "name": "api", "children": [
            { "kind": "request", "id": "", "name": "me", "protocol": "http", "request": { "method": "GET", "url": "{{base}}/me", "auth": { "type": "inherit" } } }
        ], "auth": { "type": "bearer", "bearerToken": "{{token}}" } })).unwrap()).unwrap();
        serde_json::from_value(json!({ "name": "smoke", "paths": ["api/me.bonk.json"],
            "variables": { "environment": { "base": "https://api.test" } }, "requiredVariables": ["token"],
            "iterations": 2, "dataRows": [{"id":"1"},{"id":"2"}], "stopOnFailure": true })).unwrap()
    }

    #[test]
    fn persists_run_intent_and_requires_local_secrets_before_execution() {
        let dir = Dir::new();
        let scenario = fixture(&dir.0);
        save(&dir.0, scenario).unwrap();
        let loaded = load(&dir.0).unwrap().remove(0);
        let plan = loaded.plan(&dir.0).unwrap();
        assert_eq!(
            plan.requests[0]
                .request
                .auth
                .as_ref()
                .unwrap()
                .bearer_token
                .as_deref(),
            Some("{{token}}")
        );
        assert_eq!(plan.iteration_count(), 2);
        assert!(plan.stop_on_failure);
        assert_eq!(plan.requests[0].id, "fs:api/me.bonk.json");
        assert_eq!(workspace::load(&dir.0.to_string_lossy()).unwrap().len(), 1); // hidden setup is not a collection
        assert!(loaded
            .require_variables(&loaded.variables)
            .unwrap_err()
            .contains("token"));
        let mut vars = loaded.variables.clone();
        vars.environment.insert("token".into(), "ci-secret".into());
        loaded.require_variables(&vars).unwrap();
        assert!(!std::fs::read_to_string(dir.0.join(".bonk/scenarios.json"))
            .unwrap()
            .contains("ci-secret"));
        delete(&dir.0, "smoke").unwrap();
        assert!(load(&dir.0).unwrap().is_empty());
    }

    #[test]
    fn refuses_invalid_paths_and_versions_without_replacing_a_good_file() {
        let dir = Dir::new();
        let scenario = fixture(&dir.0);
        save(&dir.0, scenario.clone()).unwrap();
        let path = dir.0.join(".bonk/scenarios.json");
        let before = std::fs::read(&path).unwrap();
        for bad in [
            "../outside",
            "/etc/passwd",
            "C:\\request.bonk.json",
            "api/missing.bonk.json",
        ] {
            let mut invalid = scenario.clone();
            invalid.paths = vec![bad.into()];
            assert!(save(&dir.0, invalid).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
        std::fs::write(&path, r#"{"version":2,"scenarios":[]}"#).unwrap();
        assert!(load(&dir.0)
            .unwrap_err()
            .contains("unsupported scenarios version"));
        assert!(save(&dir.0, scenario).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_scenario_directory_or_file() {
        let root = Dir::new();
        let outside = Dir::new();
        let scenario = fixture(&root.0);
        std::os::unix::fs::symlink(&outside.0, root.0.join(".bonk")).unwrap();
        assert!(load(&root.0).unwrap_err().contains("symlink"));
        assert!(save(&root.0, scenario.clone())
            .unwrap_err()
            .contains("symlink"));
        assert!(!outside.0.join("scenarios.json").exists());
        std::fs::remove_file(root.0.join(".bonk")).unwrap();
        std::fs::create_dir(root.0.join(".bonk")).unwrap();
        std::fs::write(outside.0.join("file.json"), "sentinel").unwrap();
        std::os::unix::fs::symlink(
            outside.0.join("file.json"),
            root.0.join(".bonk/scenarios.json"),
        )
        .unwrap();
        assert!(save(&root.0, scenario).unwrap_err().contains("symlink"));
        assert_eq!(
            std::fs::read_to_string(outside.0.join("file.json")).unwrap(),
            "sentinel"
        );
    }
}
