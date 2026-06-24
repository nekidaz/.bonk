use crate::domain::workspace::{FolderNode, RequestFile, RequestNode, TreeNode};
use std::fs;
use std::path::{Path, PathBuf};

const EXT: &str = "bonk.json";

/// Recursively load the workspace tree rooted at `root`.
pub fn load(root: &str) -> Result<Vec<TreeNode>, String> {
    let root = Path::new(root);

    if !root.exists() {
        return Ok(vec![]);
    }

    if !root.is_dir() {
        return Err(format!("workspace root is not a directory: {}", root.display()));
    }

    load_dir(root, root)
}

fn load_dir(root: &Path, dir: &Path) -> Result<Vec<TreeNode>, String> {
    let mut folders: Vec<TreeNode> = Vec::new();
    let mut requests: Vec<TreeNode> = Vec::new();

    for entry in fs::read_dir(dir).map_err(|e| {
        format!("failed to read directory {}: {e}", dir.display())
    })? {
        let entry = entry.map_err(|e| {
            format!("failed to read entry in {}: {e}", dir.display())
        })?;

        let path = entry.path();

        if is_hidden(&path) {
            continue;
        }

        if path.is_dir() {
            let children = load_dir(root, &path)?;

            folders.push(TreeNode::Folder(FolderNode {
                id: rel_id(root, &path),
                name: file_name(&path),
                expanded: true,
                children,
            }));

            continue;
        }

        if !is_request_file(&path) {
            continue;
        }

        // A single corrupt or partially written request file must not prevent
        // the rest of the workspace from loading.
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };

        let Ok(file) = serde_json::from_str::<RequestFile>(&raw) else {
            continue;
        };

        requests.push(TreeNode::Request(Box::new(
            file.into_node(rel_id(root, &path)),
        )));
    }

    folders.sort_by_key(|node| node_name(node).to_lowercase());
    requests.sort_by_key(|node| node_name(node).to_lowercase());

    folders.extend(requests);

    Ok(folders)
}

fn node_name(node: &TreeNode) -> &str {
    match node {
        TreeNode::Folder(folder) => &folder.name,
        TreeNode::Request(request) => &request.name,
    }
}

fn rel_id(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let relative = relative.to_string_lossy().replace('\\', "/");

    format!("fs:{relative}")
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn is_request_file(path: &Path) -> bool {
    path.is_file()
        && path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(EXT))
}

fn sanitize(name: &str) -> String {
    let cleaned = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            character if character.is_control() => '-',
            character => character,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if cleaned.is_empty() {
        "Untitled".to_string()
    } else {
        cleaned
    }
}

/// Resolve an `fs:<relative-path>` id to a path under `root`.
///
/// This prevents lexical traversal through `..`.
/// It does not resolve or validate symbolic links.
fn resolve(root: &str, relative: &str) -> Result<PathBuf, String> {
    let relative = relative.strip_prefix("fs:").unwrap_or(relative);
    let mut path = PathBuf::from(root);

    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }

        if segment == ".." {
            return Err("invalid path: parent traversal is not allowed".into());
        }

        path.push(segment);
    }

    Ok(path)
}

/// Pick a non-colliding path `<parent>/<stem><suffix>`.
///
/// Adds ` 2`, ` 3`, and so on when the initial path already exists.
fn unique_path(parent: &Path, stem: &str, suffix: &str) -> PathBuf {
    let first = parent.join(format!("{stem}{suffix}"));

    if !first.exists() {
        return first;
    }

    for index in 2.. {
        let candidate = parent.join(format!("{stem} {index}{suffix}"));

        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("an available unique path should eventually be found")
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path)
            .map_err(|e| format!("failed to create directory {}: {e}", path.display()))?;
    }

    if !path.is_dir() {
        return Err(format!("path is not a directory: {}", path.display()));
    }

    Ok(())
}

/// Create `<parent>/<name>`.
///
/// Returns the new folder's `fs:` id.
pub fn create_folder(
    root: &str,
    parent_rel: &str,
    name: &str,
) -> Result<String, String> {
    let parent = resolve(root, parent_rel)?;

    ensure_directory(&parent)?;

    let name = sanitize(name);
    let directory = unique_path(&parent, &name, "");

    fs::create_dir(&directory).map_err(|e| {
        format!(
            "failed to create directory {}: {e}",
            directory.display()
        )
    })?;

    Ok(rel_id(Path::new(root), &directory))
}

/// Write `node` as a request file inside `dir_rel`.
///
/// If `existing_rel` is set, the existing request is overwritten or renamed.
/// Otherwise, a uniquely named request file is created.
///
/// Returns the request file's `fs:` id.
pub fn save_request(
    root: &str,
    dir_rel: &str,
    existing_rel: Option<&str>,
    node: RequestNode,
) -> Result<String, String> {
    let directory = resolve(root, dir_rel)?;

    ensure_directory(&directory)?;

    let stem = sanitize(&node.name);
    let suffix = format!(".{EXT}");

    let target = match existing_rel {
        Some(relative) => {
            let old = resolve(root, relative)?;
            let desired = directory.join(format!("{stem}{suffix}"));

            if old == desired {
                desired
            } else if desired.exists() {
                // The desired filename belongs to another request.
                // Use a unique name instead of overwriting it.
                unique_path(&directory, &stem, &suffix)
            } else if old.exists() {
                if !is_request_file(&old) {
                    return Err(format!(
                        "existing node is not a request file: {}",
                        old.display()
                    ));
                }

                fs::rename(&old, &desired).map_err(|e| {
                    format!(
                        "failed to rename {} to {}: {e}",
                        old.display(),
                        desired.display()
                    )
                })?;

                desired
            } else {
                // The original request may have been deleted externally.
                desired
            }
        }
        None => unique_path(&directory, &stem, &suffix),
    };

    let file = RequestFile::from_node(&node);
    let raw = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize request: {e}"))?;

    fs::write(&target, format!("{raw}\n")).map_err(|e| {
        format!("failed to write request {}: {e}", target.display())
    })?;

    if let Some(relative) = existing_rel {
        let old = resolve(root, relative)?;

        // If the desired name was occupied, the updated request was written
        // into a unique target. Remove the old source to complete the rename.
        if old.exists() && old != target {
            if !is_request_file(&old) {
                return Err(format!(
                    "existing node is not a request file: {}",
                    old.display()
                ));
            }

            fs::remove_file(&old).map_err(|e| {
                format!(
                    "failed to remove old request {}: {e}",
                    old.display()
                )
            })?;
        }
    }

    Ok(rel_id(Path::new(root), &target))
}

/// Delete a node.
///
/// Folder deletion is recursive.
pub fn delete(root: &str, rel: &str) -> Result<(), String> {
    let path = resolve(root, rel)?;

    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| {
            format!("failed to delete directory {}: {e}", path.display())
        })
    } else if path.is_file() {
        fs::remove_file(&path).map_err(|e| {
            format!("failed to delete file {}: {e}", path.display())
        })
    } else {
        Ok(())
    }
}

/// Rename a node within its parent.
///
/// Folders use their directory name as the display name.
///
/// Request files store their display name inside `RequestFile.name`, so both
/// the filename and file content must be updated.
///
/// Returns the new `fs:` id.
pub fn rename(
    root: &str,
    rel: &str,
    new_name: &str,
) -> Result<String, String> {
    let path = resolve(root, rel)?;

    if !path.exists() {
        return Err("node not found".into());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "node has no parent".to_string())?
        .to_path_buf();

    let sanitized_name = sanitize(new_name);

    if path.is_dir() {
        let desired = parent.join(&sanitized_name);

        // Renaming a folder to its existing name should be a no-op.
        if desired == path {
            return Ok(rel_id(Path::new(root), &path));
        }

        let destination = if desired.exists() {
            unique_path(&parent, &sanitized_name, "")
        } else {
            desired
        };

        fs::rename(&path, &destination).map_err(|e| {
            format!(
                "failed to rename directory {} to {}: {e}",
                path.display(),
                destination.display()
            )
        })?;

        return Ok(rel_id(Path::new(root), &destination));
    }

    if !is_request_file(&path) {
        return Err(format!(
            "unsupported node type: {}",
            path.display()
        ));
    }

    let raw = fs::read_to_string(&path).map_err(|e| {
        format!("failed to read request {}: {e}", path.display())
    })?;

    let mut file: RequestFile = serde_json::from_str(&raw).map_err(|e| {
        format!("failed to parse request {}: {e}", path.display())
    })?;

    file.name = new_name.to_string();

    let suffix = format!(".{EXT}");
    let desired = parent.join(format!("{sanitized_name}{suffix}"));

    // Renaming a request to its current filename must reuse the same path.
    let destination = if desired == path {
        desired
    } else if desired.exists() {
        unique_path(&parent, &sanitized_name, &suffix)
    } else {
        desired
    };

    let output = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize request: {e}"))?;

    if destination == path {
        fs::write(&path, format!("{output}\n")).map_err(|e| {
            format!("failed to update request {}: {e}", path.display())
        })?;
    } else {
        fs::write(&destination, format!("{output}\n")).map_err(|e| {
            format!(
                "failed to write renamed request {}: {e}",
                destination.display()
            )
        })?;

        fs::remove_file(&path).map_err(|e| {
            format!(
                "failed to remove old request {}: {e}",
                path.display()
            )
        })?;
    }

    Ok(rel_id(Path::new(root), &destination))
}

/// Recursively copy directory `src` into `dst`.
fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| {
        format!(
            "failed to create destination directory {}: {e}",
            dst.display()
        )
    })?;

    for entry in fs::read_dir(src).map_err(|e| {
        format!("failed to read directory {}: {e}", src.display())
    })? {
        let entry = entry.map_err(|e| {
            format!("failed to read entry in {}: {e}", src.display())
        })?;

        let from = entry.path();
        let to = dst.join(entry.file_name());

        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| {
                format!(
                    "failed to copy {} to {}: {e}",
                    from.display(),
                    to.display()
                )
            })?;
        }
    }

    Ok(())
}

/// Duplicate a node next to itself with a ` copy` suffix.
///
/// Returns the new `fs:` id.
pub fn duplicate(root: &str, rel: &str) -> Result<String, String> {
    let path = resolve(root, rel)?;

    if !path.exists() {
        return Err("node not found".into());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "node has no parent".to_string())?
        .to_path_buf();

    if path.is_dir() {
        let base = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Folder");

        let destination = unique_path(
            &parent,
            &format!("{base} copy"),
            "",
        );

        copy_dir(&path, &destination)?;

        return Ok(rel_id(Path::new(root), &destination));
    }

    if !is_request_file(&path) {
        return Err(format!(
            "unsupported node type: {}",
            path.display()
        ));
    }

    let raw = fs::read_to_string(&path).map_err(|e| {
        format!("failed to read request {}: {e}", path.display())
    })?;

    let mut file: RequestFile = serde_json::from_str(&raw).map_err(|e| {
        format!("failed to parse request {}: {e}", path.display())
    })?;

    file.name = format!("{} copy", file.name);

    let destination = unique_path(
        &parent,
        &sanitize(&file.name),
        &format!(".{EXT}"),
    );

    let output = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize request: {e}"))?;

    fs::write(&destination, format!("{output}\n")).map_err(|e| {
        format!(
            "failed to write duplicated request {}: {e}",
            destination.display()
        )
    })?;

    Ok(rel_id(Path::new(root), &destination))
}

/// Move a node into `dest_dir_rel`.
///
/// Returns the new `fs:` id.
pub fn move_node(
    root: &str,
    rel: &str,
    dest_dir_rel: &str,
) -> Result<String, String> {
    let source = resolve(root, rel)?;
    let destination_directory = resolve(root, dest_dir_rel)?;

    if !source.exists() {
        return Err("node not found".into());
    }

    if destination_directory.exists() && !destination_directory.is_dir() {
        return Err(format!(
            "destination is not a directory: {}",
            destination_directory.display()
        ));
    }

    // Disallow moving a folder into itself or one of its descendants.
    if source.is_dir() && destination_directory.starts_with(&source) {
        return Err("cannot move a folder into itself or its descendant".into());
    }

    // Already inside the requested destination.
    if source.parent() == Some(destination_directory.as_path()) {
        return Ok(rel_id(Path::new(root), &source));
    }

    ensure_directory(&destination_directory)?;

    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid node name".to_string())?;

    let destination = if source.is_dir() {
        unique_path(&destination_directory, name, "")
    } else if is_request_file(&source) {
        let suffix = format!(".{EXT}");
        let stem = name.strip_suffix(&suffix).unwrap_or(name);

        unique_path(&destination_directory, stem, &suffix)
    } else {
        return Err(format!(
            "unsupported node type: {}",
            source.display()
        ));
    };

    fs::rename(&source, &destination).map_err(|e| {
        format!(
            "failed to move {} to {}: {e}",
            source.display(),
            destination.display()
        )
    })?;

    Ok(rel_id(Path::new(root), &destination))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::workspace::TreeNode;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);

        std::env::temp_dir().join(format!(
            "bonk-ws-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn write_request(directory: &Path, name: &str) {
        fs::create_dir_all(directory).unwrap();

        let body = format!(
            r#"{{
                "name": "{name}",
                "protocol": "http",
                "request": {{
                    "method": "GET",
                    "url": "https://x"
                }}
            }}"#
        );

        fs::write(
            directory.join(format!("{name}.bonk.json")),
            body,
        )
            .unwrap();
    }

    fn request_node(name: &str) -> RequestNode {
        RequestNode {
            id: String::new(),
            name: name.into(),
            protocol: "http".into(),
            request: crate::domain::http::HttpRequest {
                method: "GET".into(),
                url: "https://x".into(),
                headers: Default::default(),
                body: None,
                body_mode: None,
                raw_body_format: None,
                body_params: None,
                auth: None,
            },
            params: None,
            grpc: None,
        }
    }

    #[test]
    fn load_reads_nested_tree() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");
        write_request(&root.join("API").join("Sub"), "Deep");

        let tree = load(root.to_str().unwrap()).unwrap();

        assert_eq!(tree.len(), 1);

        let api = match &tree[0] {
            TreeNode::Folder(folder) => folder,
            _ => panic!("expected folder"),
        };

        assert_eq!(api.name, "API");

        let folders: Vec<_> = api
            .children
            .iter()
            .filter(|node| matches!(node, TreeNode::Folder(_)))
            .collect();

        let requests: Vec<_> = api
            .children
            .iter()
            .filter(|node| matches!(node, TreeNode::Request(_)))
            .collect();

        assert_eq!(folders.len(), 1);
        assert_eq!(requests.len(), 1);

        let sub = match folders[0] {
            TreeNode::Folder(folder) => folder,
            _ => unreachable!(),
        };

        assert_eq!(sub.name, "Sub");
        assert_eq!(sub.children.len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_skips_corrupt_request_files() {
        let root = temp_root();

        write_request(&root, "a");
        fs::write(root.join("bad.bonk.json"), "{ not valid json").unwrap();

        let tree = load(root.to_str().unwrap()).unwrap();

        let requests: Vec<_> = tree
            .iter()
            .filter_map(|node| match node {
                TreeNode::Request(request) => Some(request),
                _ => None,
            })
            .collect();

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].id, "fs:a.bonk.json");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_assigns_path_ids() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let tree = load(root.to_str().unwrap()).unwrap();

        let api = match &tree[0] {
            TreeNode::Folder(folder) => folder,
            _ => unreachable!(),
        };

        assert_eq!(api.id, "fs:API");

        let request = match &api.children[0] {
            TreeNode::Request(request) => request,
            _ => unreachable!(),
        };

        assert_eq!(request.id, "fs:API/Top.bonk.json");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_folder_makes_directory_and_returns_id() {
        let root = temp_root();

        fs::create_dir_all(&root).unwrap();

        let id = create_folder(
            root.to_str().unwrap(),
            "",
            "New Folder",
        )
            .unwrap();

        assert_eq!(id, "fs:New Folder");
        assert!(root.join("New Folder").is_dir());

        let second_id = create_folder(
            root.to_str().unwrap(),
            "",
            "New Folder",
        )
            .unwrap();

        assert_eq!(second_id, "fs:New Folder 2");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_folder_sanitizes_empty_name() {
        let root = temp_root();

        fs::create_dir_all(&root).unwrap();

        let id = create_folder(
            root.to_str().unwrap(),
            "",
            "...",
        )
            .unwrap();

        assert_eq!(id, "fs:Untitled");
        assert!(root.join("Untitled").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_request_writes_file_and_overwrites() {
        let root = temp_root();

        fs::create_dir_all(root.join("API")).unwrap();

        let node = request_node("Ping");

        let id = save_request(
            root.to_str().unwrap(),
            "API",
            None,
            node.clone(),
        )
            .unwrap();

        assert_eq!(id, "fs:API/Ping.bonk.json");
        assert!(root.join("API").join("Ping.bonk.json").is_file());

        let second_id = save_request(
            root.to_str().unwrap(),
            "API",
            Some("fs:API/Ping.bonk.json"),
            node,
        )
            .unwrap();

        assert_eq!(second_id, "fs:API/Ping.bonk.json");
        assert_eq!(fs::read_dir(root.join("API")).unwrap().count(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_request_rename_into_occupied_name_does_not_clobber() {
        let root = temp_root();
        let api = root.join("API");

        fs::create_dir_all(&api).unwrap();

        write_request(&api, "Ping");
        write_request(&api, "Pong");

        let pong_path = api.join("Pong.bonk.json");
        let pong_original = fs::read_to_string(&pong_path).unwrap();

        let id = save_request(
            root.to_str().unwrap(),
            "API",
            Some("fs:API/Ping.bonk.json"),
            request_node("Pong"),
        )
            .unwrap();

        assert_eq!(
            fs::read_to_string(&pong_path).unwrap(),
            pong_original
        );

        assert_eq!(id, "fs:API/Pong 2.bonk.json");
        assert!(api.join("Pong 2.bonk.json").is_file());
        assert!(!api.join("Ping.bonk.json").exists());
        assert_eq!(fs::read_dir(&api).unwrap().count(), 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_rejects_path_traversal() {
        let root = temp_root();

        fs::create_dir_all(&root).unwrap();

        let outside = root
            .parent()
            .unwrap()
            .join(format!(
                "bonk-escape-target-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));

        fs::create_dir_all(&outside).unwrap();

        let victim = outside.join("victim.txt");
        fs::write(&victim, "do not delete").unwrap();

        let relative = format!(
            "fs:../{}/victim.txt",
            outside.file_name().unwrap().to_str().unwrap()
        );

        let result = delete(root.to_str().unwrap(), &relative);

        assert!(result.is_err());
        assert!(victim.exists());

        let _ = fs::remove_dir_all(&outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_removes_file_and_directory() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        delete(
            root.to_str().unwrap(),
            "fs:API/Top.bonk.json",
        )
            .unwrap();

        assert!(!root.join("API").join("Top.bonk.json").exists());

        delete(root.to_str().unwrap(), "fs:API").unwrap();

        assert!(!root.join("API").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_folder_and_request() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let folder_id = rename(
            root.to_str().unwrap(),
            "fs:API",
            "Core",
        )
            .unwrap();

        assert_eq!(folder_id, "fs:Core");
        assert!(root.join("Core").is_dir());

        let request_id = rename(
            root.to_str().unwrap(),
            "fs:Core/Top.bonk.json",
            "Health",
        )
            .unwrap();

        assert_eq!(request_id, "fs:Core/Health.bonk.json");

        let raw = fs::read_to_string(
            root.join("Core").join("Health.bonk.json"),
        )
            .unwrap();

        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Health");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_folder_to_same_name_is_noop() {
        let root = temp_root();

        fs::create_dir_all(root.join("API")).unwrap();

        let id = rename(
            root.to_str().unwrap(),
            "fs:API",
            "API",
        )
            .unwrap();

        assert_eq!(id, "fs:API");
        assert!(root.join("API").is_dir());
        assert!(!root.join("API 2").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_request_to_same_name_is_noop() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let id = rename(
            root.to_str().unwrap(),
            "fs:API/Top.bonk.json",
            "Top",
        )
            .unwrap();

        assert_eq!(id, "fs:API/Top.bonk.json");
        assert!(root.join("API").join("Top.bonk.json").is_file());
        assert!(!root.join("API").join("Top 2.bonk.json").exists());

        let raw = fs::read_to_string(
            root.join("API").join("Top.bonk.json"),
        )
            .unwrap();

        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Top");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_request_collision_uses_unique_name() {
        let root = temp_root();

        write_request(&root.join("API"), "Ping");
        write_request(&root.join("API"), "Pong");

        let id = rename(
            root.to_str().unwrap(),
            "fs:API/Ping.bonk.json",
            "Pong",
        )
            .unwrap();

        assert_eq!(id, "fs:API/Pong 2.bonk.json");
        assert!(root.join("API").join("Pong.bonk.json").is_file());
        assert!(root.join("API").join("Pong 2.bonk.json").is_file());
        assert!(!root.join("API").join("Ping.bonk.json").exists());

        let raw = fs::read_to_string(
            root.join("API").join("Pong 2.bonk.json"),
        )
            .unwrap();

        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Pong");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_file_makes_copy() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let id = duplicate(
            root.to_str().unwrap(),
            "fs:API/Top.bonk.json",
        )
            .unwrap();

        assert_eq!(id, "fs:API/Top copy.bonk.json");

        let destination = root
            .join("API")
            .join("Top copy.bonk.json");

        assert!(destination.is_file());

        let raw = fs::read_to_string(&destination).unwrap();
        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Top copy");
        assert!(root.join("API").join("Top.bonk.json").is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_folder_recursive() {
        let root = temp_root();

        write_request(
            &root.join("API").join("Sub"),
            "Deep",
        );

        let id = duplicate(
            root.to_str().unwrap(),
            "fs:API",
        )
            .unwrap();

        assert_eq!(id, "fs:API copy");

        let copy = root.join("API copy");

        assert!(copy.is_dir());
        assert!(
            copy.join("Sub")
                .join("Deep.bonk.json")
                .is_file()
        );

        assert!(
            root.join("API")
                .join("Sub")
                .join("Deep.bonk.json")
                .is_file()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_file_into_folder() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");
        fs::create_dir_all(root.join("Other")).unwrap();

        let id = move_node(
            root.to_str().unwrap(),
            "fs:API/Top.bonk.json",
            "fs:Other",
        )
            .unwrap();

        assert_eq!(id, "fs:Other/Top.bonk.json");
        assert!(root.join("Other").join("Top.bonk.json").is_file());
        assert!(!root.join("API").join("Top.bonk.json").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_collision_uses_unique_name() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");
        write_request(&root.join("Other"), "Top");

        let id = move_node(
            root.to_str().unwrap(),
            "fs:API/Top.bonk.json",
            "fs:Other",
        )
            .unwrap();

        assert_eq!(id, "fs:Other/Top 2.bonk.json");
        assert!(root.join("Other").join("Top.bonk.json").is_file());
        assert!(root.join("Other").join("Top 2.bonk.json").is_file());
        assert!(!root.join("API").join("Top.bonk.json").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_rejects_into_descendant() {
        let root = temp_root();

        write_request(
            &root.join("API").join("Sub"),
            "x",
        );

        let result = move_node(
            root.to_str().unwrap(),
            "fs:API",
            "fs:API/Sub",
        );

        assert!(result.is_err());
        assert!(root.join("API").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_into_current_directory_is_noop() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let id = move_node(
            root.to_str().unwrap(),
            "fs:API/Top.bonk.json",
            "fs:API",
        )
            .unwrap();

        assert_eq!(id, "fs:API/Top.bonk.json");
        assert!(root.join("API").join("Top.bonk.json").is_file());
        assert_eq!(fs::read_dir(root.join("API")).unwrap().count(), 1);

        let _ = fs::remove_dir_all(root);
    }
}