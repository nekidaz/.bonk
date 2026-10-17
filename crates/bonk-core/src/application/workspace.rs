use super::workspace_watch::note_own_write;
use crate::domain::http::AuthConfig;
use crate::domain::workspace::{FolderFile, FolderNode, RequestFile, RequestNode, TreeNode};
use crate::infra::metrics::{DiskKind, METRICS};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const EXT: &str = "bonk.json";

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Atomically write `contents` to `target` by writing to a uniquely named temp
/// file in the SAME directory and then renaming it into place. A crash or write
/// failure leaves `target` untouched (it either holds the old content or does
/// not exist yet) rather than a half-written file. Mirrors the safe pattern in
/// `app_state::set_key`.
pub(super) fn atomic_write(target: &Path, contents: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("target has no parent directory: {}", target.display()))?;

    // Unique tmp name in the destination directory so the rename is atomic (same
    // filesystem) and a concurrent writer can't clobber an in-flight temp file.
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("request");
    let tmp = parent.join(format!(".{file_name}.tmp.{}.{seq}", std::process::id()));

    // fsync before the rename, or a power loss can leave `target` renamed but empty.
    let written = fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(contents.as_bytes())?;
        f.sync_all()
    });
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(format!("failed to write {}: {e}", tmp.display()));
    }
    METRICS.record_disk_write(DiskKind::Workspace, contents.len() as u64);

    note_own_write(target);
    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("failed to write {}: {e}", target.display()));
    }

    Ok(())
}

/// Recursively load the workspace tree rooted at `root`.
pub fn load(root: &str) -> Result<Vec<TreeNode>, String> {
    logged(load_with_skipped(root, false))
}

/// The tree plus the workspace-relative paths of `*.bonk.json` files that could not be read or parsed and so are
/// missing from it (a merge conflict, a half-written file): warnings for the user. `light` drops
/// request bodies, scripts and spec links (`RequestNode::into_light`): what the sidebar needs, a
/// few MB instead of the whole workspace. `read_requests` gives the full node.
pub fn load_with_skipped(root: &str, light: bool) -> Result<(Vec<TreeNode>, Vec<String>), String> {
    let root = Path::new(root);
    if !root.exists() {
        return Ok((vec![], vec![]));
    }
    if !root.is_dir() {
        return Err(format!(
            "workspace root is not a directory: {}",
            root.display()
        ));
    }
    let mut skipped = Vec::new();
    let tree = load_dir(root, root, &[], light, &mut skipped)?;
    Ok((tree, skipped))
}

// ponytail: headless callers (CLI, MCP) and folder refreshes only log skipped files to stderr;
// the app's full load (`load_with_skipped`) shows them in a toast.
fn logged(loaded: Result<(Vec<TreeNode>, Vec<String>), String>) -> Result<Vec<TreeNode>, String> {
    let (tree, skipped) = loaded?;
    for path in skipped {
        eprintln!("workspace: skipped unreadable request file {path}");
    }
    Ok(tree)
}

/// Load the children of folder `dir_rel` (`""` = root) after a change in it. Subfolders whose
/// ids are in `keep` come back with no children (the caller already has them); the rest load whole.
pub fn load_children(root: &str, dir_rel: &str, keep: &[String]) -> Result<Vec<TreeNode>, String> {
    load_children_in(root, dir_rel, keep, false)
}

/// [`load_children`] with light request nodes (see [`load_light`]).
pub fn load_children_light(
    root: &str,
    dir_rel: &str,
    keep: &[String],
) -> Result<Vec<TreeNode>, String> {
    load_children_in(root, dir_rel, keep, true)
}

fn load_children_in(
    root: &str,
    dir_rel: &str,
    keep: &[String],
    light: bool,
) -> Result<Vec<TreeNode>, String> {
    let dir = resolve(root, dir_rel)?;
    if !dir.is_dir() {
        return Err(format!("not a folder: {}", dir.display()));
    }
    let mut skipped = Vec::new();
    let tree = load_dir(Path::new(root), &dir, keep, light, &mut skipped)?;
    logged(Ok((tree, skipped)))
}

/// The full nodes of the request files `rels` (workspace-relative paths), with their `content_hash`.
/// A missing or unreadable file is an error: the caller asked for it by name.
pub fn read_requests(root: &str, rels: &[String]) -> Result<Vec<RequestNode>, String> {
    rels.iter()
        .map(|rel| {
            let path = resolve(root, rel)?;
            if !is_request_file(&path) {
                return Err(format!("not a request file: {rel}"));
            }
            let raw = fs::read_to_string(&path).map_err(|e| format!("{rel}: {e}"))?;
            let file =
                serde_json::from_str::<RequestFile>(&raw).map_err(|e| format!("{rel}: {e}"))?;
            let mut node = file.into_node(rel_id(Path::new(root), &path)?);
            node.content_hash = Some(crate::domain::workspace::file_hash(&raw));
            Ok(node)
        })
        .collect()
}

fn load_dir(
    root: &Path,
    dir: &Path,
    keep: &[String],
    light: bool,
    skipped: &mut Vec<String>,
) -> Result<Vec<TreeNode>, String> {
    let mut folders: Vec<TreeNode> = Vec::new();
    let mut requests: Vec<TreeNode> = Vec::new();

    for entry in
        fs::read_dir(dir).map_err(|e| format!("failed to read directory {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("failed to read entry in {}: {e}", dir.display()))?;

        let path = entry.path();

        if is_hidden(&path) {
            continue;
        }

        // Skip symlinks (without following them): a symlink inside the workspace
        // could otherwise traverse outside the root. Use `symlink_metadata` so we
        // inspect the link itself, not its target.
        if is_symlink(&path) {
            continue;
        }

        if path.is_dir() {
            let id = rel_id(root, &path)?;
            let children = if keep.contains(&id) {
                vec![]
            } else {
                load_dir(root, &path, &[], light, skipped)?
            };

            let settings = read_folder_file(&path);
            folders.push(TreeNode::Folder(FolderNode {
                id,
                name: file_name(&path),
                // Collapsed: a big collection would otherwise render every row at once.
                expanded: false,
                auth: settings.auth.map(Box::new),
                source: settings.source,
                pre_request_script: settings.pre_request_script,
                test_script: settings.test_script,
                children,
            }));

            continue;
        }

        if !is_request_file(&path) {
            continue;
        }

        // A single corrupt or partially written request file must not prevent
        // the rest of the workspace from loading; it is reported in `skipped`.
        let Some((raw, file)) = fs::read_to_string(&path).ok().and_then(|raw| {
            let file = serde_json::from_str::<RequestFile>(&raw).ok()?;
            Some((raw, file))
        }) else {
            skipped.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .display()
                    .to_string(),
            );
            continue;
        };

        let node = file.into_node(rel_id(root, &path)?);
        requests.push(TreeNode::Request(Box::new(if light {
            node.into_light(&raw)
        } else {
            node
        })));
    }

    folders.sort_by_key(|node| node_name(node).to_lowercase());
    requests.sort_by_key(|node| node_name(node).to_lowercase());

    folders.extend(requests);

    // Manual order (drag & drop) wins; unlisted entries keep the alphabetical order after it.
    let order = read_folder_file(dir).order;
    if !order.is_empty() {
        let rank = |node: &TreeNode| {
            let id = match node {
                TreeNode::Folder(folder) => &folder.id,
                TreeNode::Request(request) => &request.id,
            };
            let base = id.rsplit(['/', ':']).next().unwrap_or(id);
            order
                .iter()
                .position(|name| name == base)
                .unwrap_or(usize::MAX)
        };
        folders.sort_by_key(rank);
    }

    Ok(folders)
}

pub(crate) const FOLDER_FILE: &str = ".folder.bonk.json";

/// Folder settings for display; a missing or corrupt file means "no settings".
fn read_folder_file(dir: &Path) -> FolderFile {
    read_folder_file_strict(dir).unwrap_or_default()
}

/// Folder settings for a read-modify-write: a missing file means "no settings", but a corrupt
/// one (e.g. merge-conflict markers) is an error, so the write doesn't replace its auth,
/// scripts and order with defaults.
fn read_folder_file_strict(dir: &Path) -> Result<FolderFile, String> {
    let path = dir.join(FOLDER_FILE);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(FolderFile::default()),
        Err(e) => return Err(format!("failed to read {}: {e}", path.display())),
    };
    serde_json::from_str(&raw).map_err(|e| format!("{} is not valid JSON: {e}", path.display()))
}

/// Set (or clear, with `None`) the collection-level auth of folder `dir_rel`.
pub fn save_folder_auth(root: &str, dir_rel: &str, auth: Option<AuthConfig>) -> Result<(), String> {
    let directory = resolve(root, dir_rel)?;

    ensure_directory(&directory)?;

    let mut file = read_folder_file_strict(&directory)?;
    file.auth = auth;
    write_folder_file(&directory, &file)
}

/// Set (or clear, with `None`) where folder `dir_rel` was imported from.
pub fn save_folder_source(
    root: &str,
    dir_rel: &str,
    source: Option<serde_json::Value>,
) -> Result<(), String> {
    let directory = resolve(root, dir_rel)?;

    ensure_directory(&directory)?;

    let mut file = read_folder_file_strict(&directory)?;
    file.source = source;
    write_folder_file(&directory, &file)
}

/// Set (or clear, with `None` / an empty string) the scripts every request under `dir_rel` inherits.
pub fn save_folder_scripts(
    root: &str,
    dir_rel: &str,
    pre_request_script: Option<String>,
    test_script: Option<String>,
) -> Result<(), String> {
    let directory = resolve(root, dir_rel)?;

    ensure_directory(&directory)?;

    let mut file = read_folder_file_strict(&directory)?;
    file.pre_request_script = pre_request_script.filter(|code| !code.trim().is_empty());
    file.test_script = test_script.filter(|code| !code.trim().is_empty());
    write_folder_file(&directory, &file)
}

/// Persist the manual order of folder `dir_rel`'s entries (file/dir names, top to bottom).
pub fn reorder(root: &str, dir_rel: &str, names: Vec<String>) -> Result<(), String> {
    let directory = resolve(root, dir_rel)?;

    if !directory.is_dir() {
        return Err("folder not found".into());
    }

    let mut file = read_folder_file_strict(&directory)?;
    file.order = names;
    write_folder_file(&directory, &file)
}

/// Write folder settings; an empty file is removed instead of left behind.
fn write_folder_file(directory: &Path, file: &FolderFile) -> Result<(), String> {
    let path = directory.join(FOLDER_FILE);

    if file.is_empty() {
        note_own_write(&path);
        return match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("failed to remove {}: {e}", path.display()))
            }
            _ => Ok(()),
        };
    }

    let json = serde_json::to_string_pretty(file)
        .map_err(|e| format!("failed to serialize folder settings: {e}"))?;

    atomic_write(&path, &json)
}

/// Keep a renamed entry at its manual position in the parent's order.
fn rename_in_order(old: &Path, new: &Path) {
    let Some(parent) = old.parent() else { return };
    let Ok(mut file) = read_folder_file_strict(parent) else {
        return;
    };
    let old_name = file_name(old);

    if let Some(slot) = file.order.iter_mut().find(|name| **name == old_name) {
        *slot = file_name(new);
        let _ = write_folder_file(parent, &file);
    }
}

fn node_name(node: &TreeNode) -> &str {
    match node {
        TreeNode::Folder(folder) => &folder.name,
        TreeNode::Request(request) => &request.name,
    }
}

fn rel_id(root: &Path, path: &Path) -> Result<String, String> {
    // A path that is not under `root` must not leak its absolute location into an
    // `fs:` id; treat it as an error instead of silently falling back.
    let relative = path
        .strip_prefix(root)
        .map_err(|_| format!("path is outside the workspace root: {}", path.display()))?;
    let relative = relative.to_string_lossy().replace('\\', "/");

    Ok(format!("fs:{relative}"))
}

/// Whether `path` is a symbolic link, inspecting the link itself rather than its
/// target. Returns `false` if the metadata can't be read (the caller then treats
/// it like any other entry).
fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
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
/// Adds ` 2`, ` 3`, and so on when the initial path already exists. The search is
/// capped so a directory already saturated with collisions yields a clear error
/// instead of looping unbounded.
fn unique_path(parent: &Path, stem: &str, suffix: &str) -> Result<PathBuf, String> {
    let first = parent.join(format!("{stem}{suffix}"));

    if !first.exists() {
        return Ok(first);
    }

    for index in 2..=9999 {
        let candidate = parent.join(format!("{stem} {index}{suffix}"));

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "could not find an available name for {stem}{suffix} in {}",
        parent.display()
    ))
}

/// Whether `path` already is `<parent>/<stem><suffix>` or a [`unique_path`]
/// variant of it (`<stem> N<suffix>`), ignoring letter case. Re-saving or
/// renaming a request to the name it already has must keep its file; otherwise
/// the id hops to the next free suffix on every save, or — on a case-insensitive
/// filesystem — to `<stem> 2`, because the target "exists" as the file itself.
fn is_path_for(path: &Path, parent: &Path, stem: &str, suffix: &str) -> bool {
    let Some(name) = path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix(suffix))
    else {
        return false;
    };
    let (Some(head), Some(rest)) = (name.get(..stem.len()), name.get(stem.len()..)) else {
        return false;
    };

    path.parent() == Some(parent)
        && head.to_lowercase() == stem.to_lowercase()
        && (rest.is_empty()
            || rest
                .strip_prefix(' ')
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())))
}

/// `desired` differs from `path` only by letter case and no entry has exactly
/// that name, so on a case-insensitive filesystem (macOS, Windows) it "exists"
/// only because it IS `path` and a plain rename is safe.
fn is_case_only_change(path: &Path, desired: &Path) -> bool {
    let (Some(parent), Some(from), Some(to)) =
        (path.parent(), path.file_name(), desired.file_name())
    else {
        return false;
    };

    desired.parent() == Some(parent)
        && from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase()
        && fs::read_dir(parent)
            .is_ok_and(|entries| entries.flatten().all(|entry| entry.file_name() != to))
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
pub fn create_folder(root: &str, parent_rel: &str, name: &str) -> Result<String, String> {
    let parent = resolve(root, parent_rel)?;

    ensure_directory(&parent)?;

    let name = sanitize(name);
    let directory = unique_path(&parent, &name, "")?;

    note_own_write(&directory);
    fs::create_dir(&directory)
        .map_err(|e| format!("failed to create directory {}: {e}", directory.display()))?;

    rel_id(Path::new(root), &directory)
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

    // Resolve the destination WITHOUT moving anything yet. The new content is
    // written first (atomically), and only then is the old source removed — so a
    // failure can never leave us with the old file gone and the new content lost.
    let target = match existing_rel {
        Some(relative) => {
            let old = resolve(root, relative)?;
            let desired = directory.join(format!("{stem}{suffix}"));

            if is_path_for(&old, &directory, &stem, &suffix) {
                old
            } else if desired.exists() {
                // The desired filename belongs to another request.
                // Use a unique name instead of overwriting it.
                unique_path(&directory, &stem, &suffix)?
            } else if old.exists() {
                if !is_request_file(&old) {
                    return Err(format!(
                        "existing node is not a request file: {}",
                        old.display()
                    ));
                }

                desired
            } else {
                // The original request may have been deleted externally.
                desired
            }
        }
        None => unique_path(&directory, &stem, &suffix)?,
    };

    let mut file = RequestFile::from_node(&node);
    // A tab save doesn't carry the spec link; keep the one already on disk so
    // re-import still finds the request.
    if file.spec.is_none() {
        if let Some(relative) = existing_rel {
            file.spec = fs::read_to_string(resolve(root, relative)?)
                .ok()
                .and_then(|raw| serde_json::from_str::<RequestFile>(&raw).ok())
                .and_then(|old| old.spec);
        }
    }
    let raw = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize request: {e}"))?;

    // Durably write the new content into place before touching the old file.
    atomic_write(&target, &format!("{raw}\n"))?;

    if let Some(relative) = existing_rel {
        let old = resolve(root, relative)?;

        // The updated request now lives at `target`. Remove the old source to
        // complete the rename, but only after the new content is safely on disk.
        if old.exists() && old != target {
            if !is_request_file(&old) {
                return Err(format!(
                    "existing node is not a request file: {}",
                    old.display()
                ));
            }

            note_own_write(&old);
            fs::remove_file(&old)
                .map_err(|e| format!("failed to remove old request {}: {e}", old.display()))?;
        }
    }

    rel_id(Path::new(root), &target)
}

/// Delete a node.
///
/// Folder deletion is recursive.
pub fn delete(root: &str, rel: &str) -> Result<(), String> {
    let path = resolve(root, rel)?;
    note_own_write(&path);

    if path.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|e| format!("failed to delete directory {}: {e}", path.display()))
    } else if path.is_file() {
        fs::remove_file(&path).map_err(|e| format!("failed to delete file {}: {e}", path.display()))
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
pub fn rename(root: &str, rel: &str, new_name: &str) -> Result<String, String> {
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
            return rel_id(Path::new(root), &path);
        }

        let destination = if desired.exists() && !is_case_only_change(&path, &desired) {
            unique_path(&parent, &sanitized_name, "")?
        } else {
            desired
        };

        note_own_write(&path);
        note_own_write(&destination);
        fs::rename(&path, &destination).map_err(|e| {
            format!(
                "failed to rename directory {} to {}: {e}",
                path.display(),
                destination.display()
            )
        })?;

        rename_in_order(&path, &destination);

        return rel_id(Path::new(root), &destination);
    }

    if !is_request_file(&path) {
        return Err(format!("unsupported node type: {}", path.display()));
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read request {}: {e}", path.display()))?;

    let mut file: RequestFile = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse request {}: {e}", path.display()))?;

    file.name = new_name.to_string();

    let suffix = format!(".{EXT}");
    let desired = parent.join(format!("{sanitized_name}{suffix}"));

    // Renaming a request to its current name must reuse the same path.
    let destination = if is_path_for(&path, &parent, &sanitized_name, &suffix) {
        path.clone()
    } else if desired.exists() {
        unique_path(&parent, &sanitized_name, &suffix)?
    } else {
        desired
    };

    let output = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize request: {e}"))?;

    // Write the new content durably first; only remove the old file once the new
    // one is safely on disk, so a failure can't lose both.
    atomic_write(&destination, &format!("{output}\n"))?;

    if destination != path {
        note_own_write(&path);
        fs::remove_file(&path)
            .map_err(|e| format!("failed to remove old request {}: {e}", path.display()))?;
        rename_in_order(&path, &destination);
    }

    rel_id(Path::new(root), &destination)
}

/// Recursively copy directory `src` into `dst`.
fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    note_own_write(dst);
    fs::create_dir_all(dst).map_err(|e| {
        format!(
            "failed to create destination directory {}: {e}",
            dst.display()
        )
    })?;

    for entry in
        fs::read_dir(src).map_err(|e| format!("failed to read directory {}: {e}", src.display()))?
    {
        let entry = entry.map_err(|e| format!("failed to read entry in {}: {e}", src.display()))?;

        let from = entry.path();
        let to = dst.join(entry.file_name());
        note_own_write(&to);

        // Skip symlinks (without following them): following a link could copy
        // content from outside the workspace root. Inspect the link itself.
        if is_symlink(&from) {
            continue;
        }

        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| {
                format!("failed to copy {} to {}: {e}", from.display(), to.display())
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

        let destination = unique_path(&parent, &format!("{base} copy"), "")?;

        copy_dir(&path, &destination)?;

        return rel_id(Path::new(root), &destination);
    }

    if !is_request_file(&path) {
        return Err(format!("unsupported node type: {}", path.display()));
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read request {}: {e}", path.display()))?;

    let mut file: RequestFile = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse request {}: {e}", path.display()))?;

    file.name = format!("{} copy", file.name);

    let destination = unique_path(&parent, &sanitize(&file.name), &format!(".{EXT}"))?;

    let output = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize request: {e}"))?;

    atomic_write(&destination, &format!("{output}\n"))?;

    rel_id(Path::new(root), &destination)
}

/// Move a node into `dest_dir_rel`.
///
/// Returns the new `fs:` id.
pub fn move_node(root: &str, rel: &str, dest_dir_rel: &str) -> Result<String, String> {
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
        return rel_id(Path::new(root), &source);
    }

    ensure_directory(&destination_directory)?;

    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid node name".to_string())?;

    let destination = if source.is_dir() {
        unique_path(&destination_directory, name, "")?
    } else if is_request_file(&source) {
        let suffix = format!(".{EXT}");
        let stem = name.strip_suffix(&suffix).unwrap_or(name);

        unique_path(&destination_directory, stem, &suffix)?
    } else {
        return Err(format!("unsupported node type: {}", source.display()));
    };

    note_own_write(&source);
    note_own_write(&destination);
    fs::rename(&source, &destination).map_err(|e| {
        format!(
            "failed to move {} to {}: {e}",
            source.display(),
            destination.display()
        )
    })?;

    rel_id(Path::new(root), &destination)
}

/// All import formats converge on this collection tree before persistence.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCollection {
    pub name: String,
    pub children: Vec<TreeNode>,
    #[serde(default)]
    pub auth: Option<AuthConfig>,
    #[serde(default)]
    pub source: Option<serde_json::Value>,
    #[serde(default)]
    pub pre_request_script: Option<String>,
    #[serde(default)]
    pub test_script: Option<String>,
}

/// Persist the whole import or remove its new folder on failure. Existing
/// collections are never overwritten: create_folder chooses a unique name.
pub fn import_collection(root: &str, collection: ImportCollection) -> Result<String, String> {
    fn save(root: &str, parent: &str, children: Vec<TreeNode>) -> Result<(), String> {
        let mut order = Vec::new();
        for node in children {
            match node {
                TreeNode::Folder(folder) => {
                    let id = create_folder(root, parent, &folder.name)?;
                    save_folder_auth(root, &id, folder.auth.map(|auth| *auth))?;
                    save_folder_source(root, &id, folder.source)?;
                    save_folder_scripts(root, &id, folder.pre_request_script, folder.test_script)?;
                    save(root, &id, folder.children)?;
                    order.push(
                        id.rsplit('/')
                            .next()
                            .unwrap_or(&id)
                            .trim_start_matches("fs:")
                            .to_string(),
                    );
                }
                TreeNode::Request(request) => {
                    let id = save_request(root, parent, None, *request)?;
                    order.push(
                        id.rsplit('/')
                            .next()
                            .unwrap_or(&id)
                            .trim_start_matches("fs:")
                            .to_string(),
                    );
                }
            }
        }
        reorder(root, parent, order)
    }
    let id = create_folder(root, "", &collection.name)?;
    let result = (|| {
        save_folder_auth(root, &id, collection.auth)?;
        save_folder_source(root, &id, collection.source)?;
        save_folder_scripts(
            root,
            &id,
            collection.pre_request_script,
            collection.test_script,
        )?;
        save(root, &id, collection.children)
    })();
    if let Err(error) = result {
        return match delete(root, &id) {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!(
                "{error}; could not remove incomplete import: {cleanup}"
            )),
        };
    }
    Ok(id)
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

        fs::write(directory.join(format!("{name}.bonk.json")), body).unwrap();
    }

    fn request_node(name: &str) -> RequestNode {
        RequestNode {
            content_hash: None,
            vars: None,
            id: String::new(),
            name: name.into(),
            protocol: "http".into(),
            request: crate::domain::http::HttpRequest {
                method: "GET".into(),
                url: "https://x".into(),
                headers: Default::default(),
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
            },
            params: None,
            grpc: None,
            spec: None,
        }
    }

    #[test]
    fn resave_without_spec_keeps_the_link_and_folder_source_round_trips() {
        let root = temp_root();
        let root_s = root.to_str().unwrap();
        create_folder(root_s, "fs:", "api").unwrap();
        let mut node = request_node("List");
        node.spec = Some(serde_json::json!({ "op": "listPayments" }));
        let id = save_request(root_s, "fs:api", None, node).unwrap();

        // A save from a tab has no link: the one on disk stays.
        let id = save_request(root_s, "fs:api", Some(&id), request_node("List")).unwrap();
        save_folder_source(
            root_s,
            "fs:api",
            Some(serde_json::json!({ "url": "https://x/openapi.yaml" })),
        )
        .unwrap();

        let TreeNode::Folder(folder) = &load(root_s).unwrap()[0] else {
            panic!("expected folder");
        };
        assert_eq!(
            folder.source,
            Some(serde_json::json!({ "url": "https://x/openapi.yaml" }))
        );
        let TreeNode::Request(request) = &folder.children[0] else {
            panic!("expected request");
        };
        assert_eq!(request.id, id);
        assert_eq!(
            request.spec,
            Some(serde_json::json!({ "op": "listPayments" }))
        );
        fs::remove_dir_all(root).ok();
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
    fn load_children_reads_one_folder_and_skips_kept_subfolders() {
        let root = temp_root();
        write_request(&root.join("API"), "Top");
        write_request(&root.join("API").join("Kept"), "Deep");
        write_request(&root.join("API").join("New"), "Deep");
        write_request(&root.join("Other"), "Elsewhere");
        let children = |node: &TreeNode| match node {
            TreeNode::Folder(folder) => folder.children.len(),
            TreeNode::Request(_) => 0,
        };

        let api = load_children(root.to_str().unwrap(), "fs:API", &["fs:API/Kept".into()]).unwrap();

        let ids: Vec<_> = api.iter().map(|n| (node_id(n), children(n))).collect();
        assert_eq!(
            ids,
            [
                ("fs:API/Kept", 0),
                ("fs:API/New", 1),
                ("fs:API/Top.bonk.json", 0)
            ]
        );
        assert!(load_children(root.to_str().unwrap(), "fs:API/Top.bonk.json", &[]).is_err());
        assert!(load_children(root.to_str().unwrap(), "../x", &[]).is_err());

        let _ = fs::remove_dir_all(root);
    }

    fn node_id(node: &TreeNode) -> &str {
        match node {
            TreeNode::Folder(folder) => &folder.id,
            TreeNode::Request(request) => &request.id,
        }
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
    fn load_with_skipped_reports_corrupt_request_files() {
        let root = temp_root();
        write_request(&root, "a");
        fs::create_dir_all(root.join("api")).unwrap();
        fs::write(root.join("api").join("bad.bonk.json"), "{ not valid json").unwrap();

        let (tree, skipped) = load_with_skipped(root.to_str().unwrap(), true).unwrap();

        assert_eq!(tree.len(), 2); // folder `api` and request `a`
        let bad = Path::new("api").join("bad.bonk.json"); // workspace-relative, for the toast
        assert_eq!(skipped, [bad.display().to_string()]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_folder_refuses_to_overwrite_a_corrupt_folder_file() {
        let root = temp_root();
        write_request(&root.join("api"), "List");
        let folder_file = root.join("api").join(FOLDER_FILE);
        let conflicted = "<<<<<<< HEAD\n{\"order\":[\"List.bonk.json\"]}\n=======\n{}\n>>>>>>> b\n";
        fs::write(&folder_file, conflicted).unwrap();
        let root_s = root.to_str().unwrap();

        let errors = [
            save_folder_auth(root_s, "fs:api", None).unwrap_err(),
            save_folder_source(root_s, "fs:api", None).unwrap_err(),
            save_folder_scripts(root_s, "fs:api", Some("pre();".into()), None).unwrap_err(),
            reorder(root_s, "fs:api", vec!["List.bonk.json".into()]).unwrap_err(),
        ];
        for err in errors {
            assert!(err.contains("is not valid JSON"), "{err}");
        }
        assert_eq!(fs::read_to_string(&folder_file).unwrap(), conflicted);
        // Reading for display still works: the folder just shows no settings.
        assert_eq!(load(root_s).unwrap().len(), 1);
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

        let id = create_folder(root.to_str().unwrap(), "", "New Folder").unwrap();

        assert_eq!(id, "fs:New Folder");
        assert!(root.join("New Folder").is_dir());

        let second_id = create_folder(root.to_str().unwrap(), "", "New Folder").unwrap();

        assert_eq!(second_id, "fs:New Folder 2");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_folder_sanitizes_empty_name() {
        let root = temp_root();

        fs::create_dir_all(&root).unwrap();

        let id = create_folder(root.to_str().unwrap(), "", "...").unwrap();

        assert_eq!(id, "fs:Untitled");
        assert!(root.join("Untitled").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_request_writes_file_and_overwrites() {
        let root = temp_root();

        fs::create_dir_all(root.join("API")).unwrap();

        let node = request_node("Ping");

        let id = save_request(root.to_str().unwrap(), "API", None, node.clone()).unwrap();

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

        assert_eq!(fs::read_to_string(&pong_path).unwrap(), pong_original);

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

        let outside = root.parent().unwrap().join(format!(
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

        let folder_id = rename(root.to_str().unwrap(), "fs:API", "Core").unwrap();

        assert_eq!(folder_id, "fs:Core");
        assert!(root.join("Core").is_dir());

        let request_id = rename(root.to_str().unwrap(), "fs:Core/Top.bonk.json", "Health").unwrap();

        assert_eq!(request_id, "fs:Core/Health.bonk.json");

        let raw = fs::read_to_string(root.join("Core").join("Health.bonk.json")).unwrap();

        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Health");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn proto_paths_without_source_load_as_the_proto_source() {
        // Written by hand or by an agent through bonk-mcp: `protoPaths` set, `source` omitted.
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("Say.bonk.json"),
            r#"{"name":"Say","protocol":"grpc","request":{"method":"POST","url":""},
                "grpc":{"endpoint":"h:443","plaintext":false,"method":"demo.Echo.Say",
                "message":"{}","metadata":{},"protoPaths":["protos/echo.proto"]}}"#,
        )
        .unwrap();

        let tree = load(root.to_str().unwrap()).unwrap();
        let TreeNode::Request(node) = &tree[0] else {
            panic!("expected a request");
        };
        assert_eq!(node.grpc.as_ref().unwrap().source.as_deref(), Some("proto"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_folder_to_same_name_is_noop() {
        let root = temp_root();

        fs::create_dir_all(root.join("API")).unwrap();

        let id = rename(root.to_str().unwrap(), "fs:API", "API").unwrap();

        assert_eq!(id, "fs:API");
        assert!(root.join("API").is_dir());
        assert!(!root.join("API 2").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_request_to_same_name_is_noop() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let id = rename(root.to_str().unwrap(), "fs:API/Top.bonk.json", "Top").unwrap();

        assert_eq!(id, "fs:API/Top.bonk.json");
        assert!(root.join("API").join("Top.bonk.json").is_file());
        assert!(!root.join("API").join("Top 2.bonk.json").exists());

        let raw = fs::read_to_string(root.join("API").join("Top.bonk.json")).unwrap();

        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Top");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_request_collision_uses_unique_name() {
        let root = temp_root();

        write_request(&root.join("API"), "Ping");
        write_request(&root.join("API"), "Pong");

        let id = rename(root.to_str().unwrap(), "fs:API/Ping.bonk.json", "Pong").unwrap();

        assert_eq!(id, "fs:API/Pong 2.bonk.json");
        assert!(root.join("API").join("Pong.bonk.json").is_file());
        assert!(root.join("API").join("Pong 2.bonk.json").is_file());
        assert!(!root.join("API").join("Ping.bonk.json").exists());

        let raw = fs::read_to_string(root.join("API").join("Pong 2.bonk.json")).unwrap();

        let file: RequestFile = serde_json::from_str(&raw).unwrap();

        assert_eq!(file.name, "Pong");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_file_makes_copy() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let id = duplicate(root.to_str().unwrap(), "fs:API/Top.bonk.json").unwrap();

        assert_eq!(id, "fs:API/Top copy.bonk.json");

        let destination = root.join("API").join("Top copy.bonk.json");

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

        write_request(&root.join("API").join("Sub"), "Deep");

        let id = duplicate(root.to_str().unwrap(), "fs:API").unwrap();

        assert_eq!(id, "fs:API copy");

        let copy = root.join("API copy");

        assert!(copy.is_dir());
        assert!(copy.join("Sub").join("Deep.bonk.json").is_file());

        assert!(root
            .join("API")
            .join("Sub")
            .join("Deep.bonk.json")
            .is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_file_into_folder() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");
        fs::create_dir_all(root.join("Other")).unwrap();

        let id = move_node(root.to_str().unwrap(), "fs:API/Top.bonk.json", "fs:Other").unwrap();

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

        let id = move_node(root.to_str().unwrap(), "fs:API/Top.bonk.json", "fs:Other").unwrap();

        assert_eq!(id, "fs:Other/Top 2.bonk.json");
        assert!(root.join("Other").join("Top.bonk.json").is_file());
        assert!(root.join("Other").join("Top 2.bonk.json").is_file());
        assert!(!root.join("API").join("Top.bonk.json").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_rejects_into_descendant() {
        let root = temp_root();

        write_request(&root.join("API").join("Sub"), "x");

        let result = move_node(root.to_str().unwrap(), "fs:API", "fs:API/Sub");

        assert!(result.is_err());
        assert!(root.join("API").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_into_current_directory_is_noop() {
        let root = temp_root();

        write_request(&root.join("API"), "Top");

        let id = move_node(root.to_str().unwrap(), "fs:API/Top.bonk.json", "fs:API").unwrap();

        assert_eq!(id, "fs:API/Top.bonk.json");
        assert!(root.join("API").join("Top.bonk.json").is_file());
        assert_eq!(fs::read_dir(root.join("API")).unwrap().count(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resaving_a_suffixed_request_keeps_its_path() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let workspace = root.to_str().unwrap();

        save_request(workspace, "", None, request_node("Get user")).unwrap();
        let id = save_request(workspace, "", None, request_node("Get user")).unwrap();
        assert_eq!(id, "fs:Get user 2.bonk.json");

        // Cmd+S or an unchanged rename used to hop to `Get user 3`, `2`, `3`…
        assert_eq!(
            save_request(workspace, "", Some(&id), request_node("Get user")).unwrap(),
            id
        );
        assert_eq!(rename(workspace, &id, "Get user").unwrap(), id);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn case_only_rename_does_not_add_a_suffix() {
        let root = temp_root();
        write_request(&root.join("users"), "список");
        let workspace = root.to_str().unwrap();

        // On a case-insensitive filesystem the new name "exists" — it is the node itself.
        assert_eq!(rename(workspace, "fs:users", "Users").unwrap(), "fs:Users");
        let names: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["Users"]);

        let id = rename(workspace, "fs:Users/список.bonk.json", "Список").unwrap();
        assert_eq!(id, "fs:Users/список.bonk.json");
        let raw = fs::read_to_string(root.join("Users").join("список.bonk.json")).unwrap();
        let file: RequestFile = serde_json::from_str(&raw).unwrap();
        assert_eq!(file.name, "Список");
        assert_eq!(fs::read_dir(root.join("Users")).unwrap().count(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_auth_round_trips_and_is_not_a_request() {
        let root = temp_root();
        write_request(&root.join("api"), "List");
        let auth = AuthConfig {
            auth_type: "bearer".into(),
            bearer_token: Some("{{token}}".into()),
            ..AuthConfig::default()
        };
        let root_s = root.to_str().unwrap();

        save_folder_auth(root_s, "fs:api", Some(auth.clone())).unwrap();
        let TreeNode::Folder(folder) = &load(root_s).unwrap()[0] else {
            panic!("expected folder");
        };
        assert_eq!(folder.auth.as_deref(), Some(&auth));
        assert_eq!(folder.children.len(), 1);

        save_folder_auth(root_s, "fs:api", None).unwrap();
        let TreeNode::Folder(folder) = &load(root_s).unwrap()[0] else {
            panic!("expected folder");
        };
        assert_eq!(folder.auth, None);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn folder_scripts_round_trip_and_an_empty_file_is_removed() {
        let root = temp_root();
        write_request(&root.join("api"), "List");
        let root_s = root.to_str().unwrap();

        save_folder_scripts(root_s, "fs:api", Some("pre();".into()), Some("  ".into())).unwrap();
        let TreeNode::Folder(folder) = &load(root_s).unwrap()[0] else {
            panic!("expected folder");
        };
        assert_eq!(folder.pre_request_script.as_deref(), Some("pre();"));
        assert_eq!(folder.test_script, None);
        let raw = fs::read_to_string(root.join("api").join(FOLDER_FILE)).unwrap();
        assert!(raw.contains("\"preRequestScript\""), "{raw}");

        save_folder_scripts(root_s, "fs:api", None, None).unwrap();
        assert!(!root.join("api").join(FOLDER_FILE).exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reorder_overrides_alphabetical_and_survives_rename() {
        let root = temp_root();
        for name in ["A", "B", "C"] {
            write_request(&root, name);
        }
        let root_s = root.to_str().unwrap();
        let names = |root_s: &str| -> Vec<String> {
            load(root_s)
                .unwrap()
                .iter()
                .map(|n| node_name(n).to_string())
                .collect()
        };

        reorder(root_s, "", vec!["C.bonk.json".into(), "A.bonk.json".into()]).unwrap();
        assert_eq!(names(root_s), ["C", "A", "B"]);

        rename(root_s, "fs:C.bonk.json", "Z").unwrap();
        assert_eq!(names(root_s), ["Z", "A", "B"]);
        fs::remove_dir_all(root).ok();
    }
    #[test]
    fn collection_import_preserves_order_and_rolls_back_a_partial_write() {
        let root = std::env::temp_dir().join(format!("bonk-import-{}", fastrand::u64(..)));
        std::fs::create_dir(&root).unwrap();
        let request = |name: String| -> TreeNode {
            serde_json::from_value(serde_json::json!({
            "kind": "request", "id": "", "name": name, "protocol": "http", "request": { "method": "GET", "url": "https://api.test" }
        })).unwrap()
        };
        let make = |children| ImportCollection {
            name: "api".into(),
            children,
            auth: None,
            source: None,
            pre_request_script: Some("pm.environment.set('from', 'collection');".into()),
            test_script: None,
        };
        import_collection(
            &root.to_string_lossy(),
            make(vec![request("z-login".into()), request("a-me".into())]),
        )
        .unwrap();
        let tree = load(&root.to_string_lossy()).unwrap();
        let TreeNode::Folder(folder) = &tree[0] else {
            panic!("collection missing")
        };
        assert_eq!(node_name(&folder.children[0]), "z-login");
        assert_eq!(node_name(&folder.children[1]), "a-me");
        assert!(folder
            .pre_request_script
            .as_deref()
            .is_some_and(|s| s.contains("collection")));
        assert!(import_collection(
            &root.to_string_lossy(),
            make(vec![request("first".into()), request("x".repeat(300))])
        )
        .is_err());
        assert!(!root.join("api 2").exists());
        assert!(root.join("api/z-login.bonk.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn light_load_drops_content_and_keeps_an_etag() {
        let root = temp_root();
        fs::create_dir_all(root.join("api")).unwrap();
        let raw = r#"{
            "name": "login",
            "protocol": "http",
            "request": {
                "method": "POST",
                "url": "{{base}}/login",
                "headers": {"x": "{{token}}"},
                "body": "{\"user\": \"{{user}}\"}",
                "preRequestScript": "pm.environment.set('a', 1)",
                "testScript": "pm.test('ok', () => {})"
            },
            "spec": {"op": "login", "base": {}}
        }"#;
        fs::write(root.join("api/login.bonk.json"), raw).unwrap();
        let root_str = root.to_string_lossy().to_string();

        let (light, _) = load_with_skipped(&root_str, true).unwrap();
        let TreeNode::Folder(folder) = &light[0] else {
            panic!("expected a folder")
        };
        let TreeNode::Request(node) = &folder.children[0] else {
            panic!("expected a request")
        };
        assert_eq!(node.request.url, "{{base}}/login");
        assert_eq!(node.request.headers["x"], "{{token}}");
        assert!(node.request.body.is_none());
        assert!(node.request.pre_request_script.is_none());
        assert!(node.request.test_script.is_none());
        assert!(node.spec.is_none());
        assert_eq!(
            node.vars.as_deref().unwrap(),
            ["base", "token", "user"].map(String::from)
        );

        let full = read_requests(&root_str, &["api/login.bonk.json".into()]).unwrap();
        assert_eq!(full[0].id, node.id);
        assert_eq!(
            full[0].request.body.as_deref(),
            Some(r#"{"user": "{{user}}"}"#)
        );
        assert_eq!(full[0].content_hash, node.content_hash);
        assert!(full[0].vars.is_none());

        fs::write(root.join("api/login.bonk.json"), raw.replace("POST", "PUT")).unwrap();
        let changed = read_requests(&root_str, &["api/login.bonk.json".into()]).unwrap();
        assert_ne!(changed[0].content_hash, node.content_hash);

        let children = load_children_light(&root_str, "api", &[]).unwrap();
        assert_eq!(children.len(), 1);
        assert!(read_requests(&root_str, &["api/nope.bonk.json".into()]).is_err());
        assert!(read_requests(&root_str, &["api".into()]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn full_load_is_unchanged() {
        let root = temp_root();
        write_request(&root, "a");
        let tree = load(&root.to_string_lossy()).unwrap();
        let TreeNode::Request(node) = &tree[0] else {
            panic!("expected a request")
        };
        assert!(node.content_hash.is_none() && node.vars.is_none());
        assert!(!serde_json::to_string(node).unwrap().contains("contentHash"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
