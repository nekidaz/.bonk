//! Reading a file for the import window: a picked or dropped spec, collection, HAR or cURL file,
//! or a collection's saved source on «Обновить из спецификации».

use std::path::Path;

/// A file to import: base name, full path, size and text. The path is kept so the
/// import can be repeated from the same file.
#[derive(Debug, serde::Serialize)]
pub struct ImportedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub text: String,
}

/// Import files above this size are refused instead of freezing the webview.
const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// What the picker offers. A path from anywhere else (a drop, a saved collection source) must
/// match too, so a shared `.folder.bonk.json` can't point the importer at `~/.ssh/id_rsa`.
pub const EXTENSIONS: [&str; 7] = ["json", "yaml", "yml", "har", "txt", "sh", "curl"];

pub fn read(path: &Path) -> Result<ImportedFile, String> {
    let importable = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
    if !importable {
        return Err(format!(
            "{}: only .{} files can be imported",
            path.display(),
            EXTENSIONS.join(", .")
        ));
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{}: not a file", path.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("{}: file is larger than 50 MB", path.display()));
    }
    Ok(ImportedFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        text: std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_importable_files_only() {
        let dir = std::env::temp_dir().join(format!("bonk-import-{}", fastrand::u64(..)));
        std::fs::create_dir_all(dir.join("spec.json")).unwrap();
        std::fs::write(dir.join("api.YAML"), "openapi: 3.1.0\n").unwrap();
        std::fs::write(dir.join("id_rsa"), "secret").unwrap();

        let f = read(&dir.join("api.YAML")).unwrap();
        assert_eq!(
            (f.name.as_str(), f.size, f.text.as_str()),
            ("api.YAML", 15, "openapi: 3.1.0\n")
        );
        assert!(read(&dir.join("id_rsa"))
            .unwrap_err()
            .contains("files can be imported"));
        assert!(read(&dir.join("spec.json"))
            .unwrap_err()
            .contains("not a file"));
        assert!(read(&dir.join("missing.json")).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
