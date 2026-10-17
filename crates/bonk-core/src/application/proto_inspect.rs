//! Per-file `.proto` inspection for the import dialog: compiles every input
//! file on its own so one broken file doesn't hide the others.

use std::path::{Path, PathBuf};

use serde::Serialize;

const WELL_KNOWN_PREFIX: &str = "google/protobuf/";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoInspection {
    pub files: Vec<ProtoFileInfo>,
    pub import_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoFileInfo {
    pub path: String,
    pub name: String,
    pub ok: bool,
    pub error: Option<ProtoFileError>,
    pub services: Vec<ProtoServiceInfo>,
    pub well_known_deps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoFileError {
    /// `"missing_import"` or `"compile"`.
    pub kind: String,
    pub message: String,
    /// The import path that could not be resolved (kind = missing_import).
    pub import: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoServiceInfo {
    pub name: String,
    pub methods: Vec<ProtoMethodInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoMethodInfo {
    pub name: String,
    /// `unary` | `server_stream` | `client_stream` | `bidi`.
    pub kind: String,
}

fn collect_protos(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            collect_protos(&p, out);
        } else if p.extension().is_some_and(|e| e == "proto") {
            out.push(p);
        }
    }
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

pub fn inspect_protos(paths: &[String], import_paths: &[String]) -> ProtoInspection {
    let mut roots: Vec<String> = import_paths.to_vec();
    let mut inputs: Vec<PathBuf> = Vec::new();
    for raw in paths {
        let p = PathBuf::from(raw);
        if p.is_dir() {
            if !roots.contains(raw) {
                roots.push(raw.clone());
            }
            collect_protos(&p, &mut inputs);
        } else {
            inputs.push(p);
        }
    }
    let mut seen = std::collections::HashSet::new();
    inputs.retain(|p| seen.insert(p.clone()));

    let files = inputs
        .iter()
        .map(|file| inspect_one(file, &roots))
        .collect();
    ProtoInspection {
        files,
        import_paths: roots,
    }
}

fn inspect_one(file: &Path, roots: &[String]) -> ProtoFileInfo {
    let path = s(file);
    // Name relative to the first import root containing the file, else the
    // bare file name (its parent becomes an implicit root below).
    let name = roots
        .iter()
        .find_map(|r| file.strip_prefix(r).ok())
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| {
            file.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    let mut includes = roots.to_vec();
    if let Some(parent) = file.parent() {
        let parent = s(parent);
        if !includes.contains(&parent) {
            includes.push(parent);
        }
    }

    let mut info = ProtoFileInfo {
        path: path.clone(),
        name,
        ok: false,
        error: None,
        services: Vec::new(),
        well_known_deps: Vec::new(),
    };

    let compiled = protox::Compiler::new(&includes).and_then(|mut c| {
        c.include_source_info(false).open_file(file)?;
        Ok(c)
    });
    let compiler = match compiled {
        Ok(c) => c,
        Err(e) => {
            info.error = Some(describe_error(&e));
            return info;
        }
    };
    // Root file only (include_imports is off by default).
    let set = compiler.file_descriptor_set();
    if let Some(fd) = set.file.first() {
        let pkg = fd.package();
        for svc in &fd.service {
            info.services.push(ProtoServiceInfo {
                name: if pkg.is_empty() {
                    svc.name().to_string()
                } else {
                    format!("{pkg}.{}", svc.name())
                },
                methods: svc
                    .method
                    .iter()
                    .map(|m| ProtoMethodInfo {
                        name: m.name().to_string(),
                        kind: match (m.client_streaming(), m.server_streaming()) {
                            (false, false) => "unary",
                            (false, true) => "server_stream",
                            (true, false) => "client_stream",
                            (true, true) => "bidi",
                        }
                        .to_string(),
                    })
                    .collect(),
            });
        }
        // Built-in well-known types, unless the user ships their own copy.
        info.well_known_deps = fd
            .dependency
            .iter()
            .filter(|d| {
                d.starts_with(WELL_KNOWN_PREFIX)
                    && !includes.iter().any(|r| Path::new(r).join(d).is_file())
            })
            .cloned()
            .collect();
    }
    info.ok = true;
    info
}

fn describe_error(e: &protox::Error) -> ProtoFileError {
    let message = e.to_string();
    // Limit: protox exposes no structured missing-import info, so parse the
    // quoted name out of the message ("import 'x' not found"); falls back to
    // the raw compiler text if the wording changes.
    if e.is_file_not_found() {
        if let Some(import) = message.split(['\'', '"']).nth(1) {
            return ProtoFileError {
                kind: "missing_import".into(),
                message: format!("import \"{import}\" not found"),
                import: Some(import.to_string()),
            };
        }
    }
    ProtoFileError {
        kind: "compile".into(),
        message,
        import: None,
    }
}

/// Source text for the viewer. Well-known `google/protobuf/*` sources are not
/// embedded in protox (descriptors only), so those are an error.
pub fn proto_read(path: &str) -> Result<String, String> {
    if path.starts_with(WELL_KNOWN_PREFIX) && !Path::new(path).exists() {
        return Err("well-known type: its source is built into the compiler".into());
    }
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("bonk-inspect-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const OK: &str = r#"syntax = "proto3";
package greet;
import "google/protobuf/timestamp.proto";
message Req { google.protobuf.Timestamp at = 1; }
service Greeter {
  rpc One (Req) returns (Req);
  rpc Two (Req) returns (stream Req);
}"#;

    #[test]
    fn ok_file_lists_services_and_well_known() {
        let d = tmp();
        let f = d.join("a.proto");
        std::fs::write(&f, OK).unwrap();
        let r = inspect_protos(&[s(&f)], &[]);
        let fi = &r.files[0];
        assert!(fi.ok, "{:?}", fi.error);
        assert_eq!(fi.name, "a.proto");
        assert_eq!(fi.services[0].name, "greet.Greeter");
        assert_eq!(fi.services[0].methods[1].kind, "server_stream");
        assert_eq!(fi.well_known_deps, vec!["google/protobuf/timestamp.proto"]);
    }

    #[test]
    fn missing_import_is_reported_and_isolated() {
        let d = tmp();
        std::fs::write(d.join("good.proto"), OK).unwrap();
        std::fs::write(
            d.join("bad.proto"),
            "syntax = \"proto3\";\nimport \"google/type/money.proto\";\nmessage M { google.type.Money m = 1; }",
        )
        .unwrap();
        let r = inspect_protos(&[s(&d)], &[]);
        assert_eq!(r.files.len(), 2);
        assert_eq!(r.import_paths, vec![s(&d)]);
        let bad = r.files.iter().find(|f| f.name == "bad.proto").unwrap();
        let err = bad.error.as_ref().unwrap();
        assert_eq!(err.kind, "missing_import", "{err:?}");
        assert_eq!(err.import.as_deref(), Some("google/type/money.proto"));
        assert!(r.files.iter().find(|f| f.name == "good.proto").unwrap().ok);
    }

    #[test]
    fn directory_input_is_recursive_with_relative_names() {
        let d = tmp();
        std::fs::create_dir_all(d.join("p/v1")).unwrap();
        std::fs::write(d.join("p/v1/x.proto"), OK).unwrap();
        let r = inspect_protos(&[s(&d)], &[]);
        assert_eq!(r.files[0].name, "p/v1/x.proto");
        assert!(r.files[0].ok);
    }
}
