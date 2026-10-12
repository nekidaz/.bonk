//! «Ask on send» definitions of a workspace: `.bonk/inputs.json`, one `InputDef` per
//! variable name. Committed with the requests, so the Runner, the CLI and teammates
//! ask for the same fields. Values are never stored here.

use std::{collections::BTreeMap, path::Path};

use serde::{Deserialize, Serialize};

use super::{scenarios::bonk_file, workspace};
use crate::domain::inputs::{valid_name, InputDef};

pub type Inputs = BTreeMap<String, InputDef>;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    version: u32,
    inputs: Inputs,
}

pub fn load(root: &Path) -> Result<Inputs, String> {
    let path = bonk_file(root, "inputs.json")?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Inputs::new()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let file: File = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    if file.version != 1 {
        return Err(format!("unsupported inputs version: {}", file.version));
    }
    if let Some(name) = file.inputs.keys().find(|name| !valid_name(name)) {
        return Err(format!("not a variable name: {name}"));
    }
    Ok(file.inputs)
}

/// Replace the whole set (an empty one removes the file).
pub fn save(root: &Path, inputs: Inputs) -> Result<(), String> {
    if let Some(name) = inputs.keys().find(|name| !valid_name(name)) {
        return Err(format!("not a variable name: {name}"));
    }
    for (name, def) in &inputs {
        if !def.pattern.is_empty() {
            regex::Regex::new(&def.pattern).map_err(|e| format!("{name}: invalid pattern: {e}"))?;
        }
    }
    let path = bonk_file(root, "inputs.json")?;
    if inputs.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("{}: {e}", path.display()))
            }
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(path.parent().ok_or("inputs path has no parent")?)
        .map_err(|e| e.to_string())?;
    let text =
        serde_json::to_string_pretty(&File { version: 1, inputs }).map_err(|e| e.to_string())?;
    workspace::atomic_write(&path, &(text + "\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::inputs::InputKind;
    use std::path::PathBuf;

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("bonk-inputs-{}", fastrand::u64(..)));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn otp() -> Inputs {
        let def = InputDef {
            kind: InputKind::Code,
            label: "Код из SMS".into(),
            ..InputDef::default()
        };
        Inputs::from([("otp".to_string(), def)])
    }

    #[test]
    fn saves_loads_and_removes_the_file_when_empty() {
        let dir = Dir::new();
        assert!(load(&dir.0).unwrap().is_empty());
        save(&dir.0, otp()).unwrap();
        assert_eq!(load(&dir.0).unwrap(), otp());
        save(&dir.0, Inputs::new()).unwrap();
        assert!(!dir.0.join(".bonk/inputs.json").exists());
    }

    #[test]
    fn refuses_bad_names_patterns_and_versions_without_touching_a_good_file() {
        let dir = Dir::new();
        save(&dir.0, otp()).unwrap();
        let path = dir.0.join(".bonk/inputs.json");
        let before = std::fs::read(&path).unwrap();
        let mut bad = otp();
        bad.insert("$guid".into(), InputDef::default());
        assert!(save(&dir.0, bad).is_err());
        let mut bad = otp();
        bad.get_mut("otp").unwrap().pattern = "(".into();
        assert!(save(&dir.0, bad).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::write(&path, r#"{"version":2,"inputs":{}}"#).unwrap();
        assert!(load(&dir.0)
            .unwrap_err()
            .contains("unsupported inputs version"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_file() {
        let root = Dir::new();
        let outside = Dir::new();
        std::fs::create_dir(root.0.join(".bonk")).unwrap();
        std::fs::write(outside.0.join("file.json"), "sentinel").unwrap();
        std::os::unix::fs::symlink(
            outside.0.join("file.json"),
            root.0.join(".bonk/inputs.json"),
        )
        .unwrap();
        assert!(save(&root.0, otp()).unwrap_err().contains("symlink"));
        assert_eq!(
            std::fs::read_to_string(outside.0.join("file.json")).unwrap(),
            "sentinel"
        );
    }
}
