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
    load_dir(root, root)
}

fn load_dir(root: &Path, dir: &Path) -> Result<Vec<TreeNode>, String> {
    let mut folders: Vec<TreeNode> = Vec::new();
    let mut requests: Vec<TreeNode> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
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
        } else if is_request_file(&path) {
            // A single corrupt/partial file (mid-merge-conflict, half-written)
            // must not blank the whole sidebar. Skip files we can't read/parse
            // and load the rest; this keeps a git-first, hand-editable workspace
            // resilient. Directory-read errors above still propagate.
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(file) = serde_json::from_str::<RequestFile>(&raw) else {
                continue;
            };
            requests.push(TreeNode::Request(Box::new(file.into_node(rel_id(root, &path)))));
        }
    }
    folders.sort_by_key(|a| node_name(a).to_lowercase());
    requests.sort_by_key(|a| node_name(a).to_lowercase());
    folders.extend(requests);
    Ok(folders)
}

fn node_name(n: &TreeNode) -> &str {
    match n {
        TreeNode::Folder(f) => &f.name,
        TreeNode::Request(r) => &r.name,
    }
}

fn rel_id(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let rel = rel.to_string_lossy().replace('\\', "/");
    format!("fs:{rel}")
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.'))
}

fn is_request_file(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(EXT))
}

fn sanitize(name: &str) -> String {
    let cleaned = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
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

/// Resolve a `fs:<rel>` id (or empty/"" for root) to an absolute path under `root`.
/// Rejects any `..` segment so ids from the frontend cannot escape the workspace.
fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.strip_prefix("fs:").unwrap_or(rel);
    let mut p = PathBuf::from(root);
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("invalid path".into());
        }
        p.push(seg);
    }
    Ok(p)
}

/// Pick a non-colliding path `<parent>/<stem><suffix>` (adds " 2", " 3", ...).
fn unique_path(parent: &Path, stem: &str, suffix: &str) -> PathBuf {
    let first = parent.join(format!("{stem}{suffix}"));
    if !first.exists() {
        return first;
    }
    for i in 2.. {
        let cand = parent.join(format!("{stem} {i}{suffix}"));
        if !cand.exists() {
            return cand;
        }
    }
    unreachable!()
}

/// Create `<parent>/<name>`; returns the new folder's `fs:` id.
pub fn create_folder(root: &str, parent_rel: &str, name: &str) -> Result<String, String> {
    let parent = resolve(root, parent_rel)?;
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let dir = unique_path(&parent, &sanitize(name), "");
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    Ok(rel_id(Path::new(root), &dir))
}

/// Write `node` as a request file inside `dir_rel`. If `existing_rel` is set,
/// overwrite/rename that file; else create a uniquely-named new file. Returns
/// the file's `fs:` id.
pub fn save_request(
    root: &str,
    dir_rel: &str,
    existing_rel: Option<&str>,
    node: RequestNode,
) -> Result<String, String> {
    let dir = resolve(root, dir_rel)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = sanitize(&node.name);
    let target = match existing_rel {
        Some(rel) => {
            let old = resolve(root, rel)?;
            let desired = dir.join(format!("{stem}.{EXT}"));
            if old == desired {
                desired
            } else if desired.exists() {
                // name taken by a different file — don't clobber it
                unique_path(&dir, &stem, &format!(".{EXT}"))
            } else if old.exists() {
                fs::rename(&old, &desired).map_err(|e| e.to_string())?;
                desired
            } else {
                desired // original gone (e.g. deleted externally) — write fresh
            }
        }
        None => unique_path(&dir, &stem, &format!(".{EXT}")),
    };
    let file = RequestFile::from_node(&node);
    let raw = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&target, format!("{raw}\n")).map_err(|e| e.to_string())?;
    // Renaming an existing request: if we diverted to a unique target (because
    // the desired name was occupied), the original source is still on disk —
    // remove it so the rename doesn't leave an orphan. No-op for the branches
    // that already renamed (`old` moved) or reused the same path (`old == target`).
    if let Some(rel) = existing_rel {
        let old = resolve(root, rel)?;
        if old.exists() && old != target {
            let _ = fs::remove_file(&old);
        }
    }
    Ok(rel_id(Path::new(root), &target))
}

/// Delete a node (recursive for folders).
pub fn delete(root: &str, rel: &str) -> Result<(), String> {
    let path = resolve(root, rel)?;
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// Rename a node within its parent; returns the new `fs:` id.
///
/// Folders are a plain directory rename (folder name == directory name).
/// Request files carry their display name in the file *content* (the
/// authoritative `RequestFile.name` that `load` reads), so renaming one must
/// rewrite that field too — otherwise the filename and content diverge.
pub fn rename(root: &str, rel: &str, new_name: &str) -> Result<String, String> {
    let path = resolve(root, rel)?;
    let parent = path.parent().ok_or("no parent")?.to_path_buf();
    if path.is_dir() {
        let dest = unique_path(&parent, &sanitize(new_name), "");
        fs::rename(&path, &dest).map_err(|e| e.to_string())?;
        Ok(rel_id(Path::new(root), &dest))
    } else {
        // Request file: rewrite the content `name` AND the filename.
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut file: RequestFile =
            serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
        file.name = new_name.to_string();
        let dest = unique_path(&parent, &sanitize(new_name), &format!(".{EXT}"));
        let out = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        fs::write(&dest, format!("{out}\n")).map_err(|e| e.to_string())?;
        if dest != path {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(rel_id(Path::new(root), &dest))
    }
}

/// Recursively copy directory `src` into `dst` (creating `dst` if needed).
fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Duplicate a node next to itself with a " copy" suffix. Returns the new fs id.
pub fn duplicate(root: &str, rel: &str) -> Result<String, String> {
    let path = resolve(root, rel)?;
    let parent = path.parent().ok_or("no parent")?.to_path_buf();
    if path.is_dir() {
        let base = path.file_name().and_then(|n| n.to_str()).unwrap_or("Folder");
        let dest = unique_path(&parent, &format!("{base} copy"), "");
        copy_dir(&path, &dest)?;
        Ok(rel_id(Path::new(root), &dest))
    } else if path.is_file() {
        // Read the request, bump its content name to match, write to a unique file.
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut file: RequestFile =
            serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
        file.name = format!("{} copy", file.name);
        let dest = unique_path(&parent, &sanitize(&file.name), &format!(".{EXT}"));
        let out = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        fs::write(&dest, format!("{out}\n")).map_err(|e| e.to_string())?;
        Ok(rel_id(Path::new(root), &dest))
    } else {
        Err("node not found".into())
    }
}

/// Move a node into `dest_dir_rel`. Returns the new fs id.
pub fn move_node(root: &str, rel: &str, dest_dir_rel: &str) -> Result<String, String> {
    let src = resolve(root, rel)?;
    let dest_dir = resolve(root, dest_dir_rel)?;
    if !src.exists() {
        return Err("node not found".into());
    }
    // Disallow moving a folder into itself or a descendant.
    if src.is_dir() && dest_dir.starts_with(&src) {
        return Err("cannot move a folder into itself".into());
    }
    // No-op if already in the destination.
    if src.parent() == Some(dest_dir.as_path()) {
        return Ok(rel_id(Path::new(root), &src));
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let name = src.file_name().and_then(|n| n.to_str()).ok_or("bad name")?;
    let dest = if src.is_dir() {
        unique_path(&dest_dir, name, "")
    } else {
        let stem = name.strip_suffix(&format!(".{EXT}")).unwrap_or(name);
        unique_path(&dest_dir, stem, &format!(".{EXT}"))
    };
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(rel_id(Path::new(root), &dest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::workspace::TreeNode;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> std::path::PathBuf {
        // Atomic counter guarantees a unique path per test even when parallel
        // tests call this within the same clock tick (avoids shared-tmp races).
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "bonk-ws-{}-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn write_request(dir: &std::path::Path, name: &str) {
        fs::create_dir_all(dir).unwrap();
        let body = format!(
            r#"{{"name":"{name}","protocol":"http","request":{{"method":"GET","url":"https://x"}}}}"#
        );
        fs::write(dir.join(format!("{name}.bonk.json")), body).unwrap();
    }

    #[test]
    fn load_reads_nested_tree() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        write_request(&root.join("API").join("Sub"), "Deep");
        let tree = load(root.to_str().unwrap()).unwrap();

        // one top-level folder "API"
        assert_eq!(tree.len(), 1);
        let api = match &tree[0] {
            TreeNode::Folder(f) => f,
            _ => panic!("expected folder"),
        };
        assert_eq!(api.name, "API");
        // API has a request "Top" and a subfolder "Sub"
        let folders: Vec<_> = api.children.iter().filter(|n| matches!(n, TreeNode::Folder(_))).collect();
        let reqs: Vec<_> = api.children.iter().filter(|n| matches!(n, TreeNode::Request(_))).collect();
        assert_eq!(folders.len(), 1);
        assert_eq!(reqs.len(), 1);
        let sub = match folders[0] { TreeNode::Folder(f) => f, _ => unreachable!() };
        assert_eq!(sub.name, "Sub");
        assert_eq!(sub.children.len(), 1); // "Deep"
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_skips_corrupt_request_files() {
        // A single malformed *.bonk.json (e.g. left mid-merge-conflict or
        // half-written) must NOT blank the whole workspace: the valid files and
        // folders still load.
        let root = temp_root();
        write_request(&root, "a");
        // Malformed JSON in a request file alongside the valid one.
        fs::write(root.join("bad.bonk.json"), "{ not valid json").unwrap();

        let tree = load(root.to_str().unwrap()).unwrap();
        let reqs: Vec<_> = tree
            .iter()
            .filter_map(|n| match n {
                TreeNode::Request(r) => Some(r),
                _ => None,
            })
            .collect();
        assert_eq!(reqs.len(), 1, "only the valid request should load");
        assert_eq!(reqs[0].id, "fs:a.bonk.json");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_assigns_path_ids() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        let tree = load(root.to_str().unwrap()).unwrap();
        let api = match &tree[0] { TreeNode::Folder(f) => f, _ => unreachable!() };
        assert_eq!(api.id, "fs:API");
        let req = match &api.children[0] { TreeNode::Request(r) => r, _ => unreachable!() };
        assert_eq!(req.id, "fs:API/Top.bonk.json");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_folder_makes_dir_and_returns_id() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let id = create_folder(root.to_str().unwrap(), "", "New Folder").unwrap();
        assert_eq!(id, "fs:New Folder");
        assert!(root.join("New Folder").is_dir());
        // collision -> " 2"
        let id2 = create_folder(root.to_str().unwrap(), "", "New Folder").unwrap();
        assert_eq!(id2, "fs:New Folder 2");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_request_writes_file_and_overwrites() {
        let root = temp_root();
        fs::create_dir_all(root.join("API")).unwrap();
        let node = RequestNode {
            id: String::new(),
            name: "Ping".into(),
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
        };
        let id = save_request(root.to_str().unwrap(), "API", None, node.clone()).unwrap();
        assert_eq!(id, "fs:API/Ping.bonk.json");
        assert!(root.join("API").join("Ping.bonk.json").is_file());
        // overwrite same path (no second file)
        let id2 = save_request(root.to_str().unwrap(), "API", Some("fs:API/Ping.bonk.json"), node).unwrap();
        assert_eq!(id2, "fs:API/Ping.bonk.json");
        let count = fs::read_dir(root.join("API")).unwrap().count();
        assert_eq!(count, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_request_rename_into_occupied_name_does_not_clobber() {
        let root = temp_root();
        let api = root.join("API");
        fs::create_dir_all(&api).unwrap();
        // Two distinct files exist.
        write_request(&api, "Ping");
        write_request(&api, "Pong");
        let pong_path = api.join("Pong.bonk.json");
        let pong_original = fs::read_to_string(&pong_path).unwrap();

        // Rename Ping -> Pong (a name already taken by a DIFFERENT file).
        let node = RequestNode {
            id: String::new(),
            name: "Pong".into(),
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
        };
        let id = save_request(
            root.to_str().unwrap(),
            "API",
            Some("fs:API/Ping.bonk.json"),
            node,
        )
        .unwrap();

        // The existing Pong file must NOT be overwritten.
        assert_eq!(
            fs::read_to_string(&pong_path).unwrap(),
            pong_original,
            "existing Pong file was clobbered"
        );
        // The returned id is a NEW unique path, not the occupied Pong path.
        assert_eq!(id, "fs:API/Pong 2.bonk.json");
        assert!(api.join("Pong 2.bonk.json").is_file());
        // This is a rename of an existing request: the non-clobbering branch
        // diverts to a fresh path (Pong 2) and then removes the original source
        // so it isn't left behind as an orphan. Final state: the preserved
        // occupant (Pong) and the new copy (Pong 2) — exactly two files.
        assert!(
            !api.join("Ping.bonk.json").exists(),
            "orphaned source Ping should have been removed"
        );
        assert_eq!(fs::read_dir(&api).unwrap().count(), 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_rejects_path_traversal() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        // Create a sibling target OUTSIDE the workspace root.
        let outside = root.parent().unwrap().join("bonk-escape-target");
        fs::create_dir_all(&outside).unwrap();
        let victim = outside.join("victim.txt");
        fs::write(&victim, "do not delete").unwrap();

        let rel = format!("fs:../{}/victim.txt", outside.file_name().unwrap().to_str().unwrap());
        let res = delete(root.to_str().unwrap(), &rel);
        assert!(res.is_err(), "traversal path should be rejected");
        // Nothing outside root was touched.
        assert!(victim.exists(), "file outside root was deleted via traversal");

        let _ = fs::remove_dir_all(&outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_removes_file_and_dir() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        delete(root.to_str().unwrap(), "fs:API/Top.bonk.json").unwrap();
        assert!(!root.join("API").join("Top.bonk.json").exists());
        delete(root.to_str().unwrap(), "fs:API").unwrap();
        assert!(!root.join("API").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_folder_and_request() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        let fid = rename(root.to_str().unwrap(), "fs:API", "Core").unwrap();
        assert_eq!(fid, "fs:Core");
        assert!(root.join("Core").is_dir());
        let rid = rename(root.to_str().unwrap(), "fs:Core/Top.bonk.json", "Health").unwrap();
        assert_eq!(rid, "fs:Core/Health.bonk.json");
        // The content `name` (the authoritative source `load` reads) must follow
        // the rename — not just the filename — or the sidebar shows the old name.
        let raw = fs::read_to_string(root.join("Core").join("Health.bonk.json")).unwrap();
        let file: RequestFile = serde_json::from_str(&raw).unwrap();
        assert_eq!(file.name, "Health", "content name should be updated on rename");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_file_makes_copy() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        let id = duplicate(root.to_str().unwrap(), "fs:API/Top.bonk.json").unwrap();
        assert_eq!(id, "fs:API/Top copy.bonk.json");
        let dest = root.join("API").join("Top copy.bonk.json");
        assert!(dest.is_file(), "duplicated file should exist");
        // The content `name` follows the copy suffix.
        let raw = fs::read_to_string(&dest).unwrap();
        let file: RequestFile = serde_json::from_str(&raw).unwrap();
        assert_eq!(file.name, "Top copy", "content name should be suffixed");
        // Original untouched.
        assert!(
            root.join("API").join("Top.bonk.json").is_file(),
            "original should still exist"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_folder_recursive() {
        let root = temp_root();
        write_request(&root.join("API").join("Sub"), "Deep");
        let id = duplicate(root.to_str().unwrap(), "fs:API").unwrap();
        assert_eq!(id, "fs:API copy");
        let copy = root.join("API copy");
        assert!(copy.is_dir(), "duplicated folder should exist");
        assert!(
            copy.join("Sub").join("Deep.bonk.json").is_file(),
            "nested request should be copied recursively"
        );
        // Original untouched.
        assert!(root.join("API").join("Sub").join("Deep.bonk.json").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_file_into_folder() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        fs::create_dir_all(root.join("Other")).unwrap();
        let id =
            move_node(root.to_str().unwrap(), "fs:API/Top.bonk.json", "fs:Other").unwrap();
        assert_eq!(id, "fs:Other/Top.bonk.json");
        assert!(
            root.join("Other").join("Top.bonk.json").is_file(),
            "file should be under Other"
        );
        assert!(
            !root.join("API").join("Top.bonk.json").exists(),
            "file should be gone from API"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_rejects_into_descendant() {
        let root = temp_root();
        write_request(&root.join("API").join("Sub"), "x");
        let res = move_node(root.to_str().unwrap(), "fs:API", "fs:API/Sub");
        assert!(res.is_err(), "moving a folder into its descendant should fail");
        let _ = fs::remove_dir_all(root);
    }
}
