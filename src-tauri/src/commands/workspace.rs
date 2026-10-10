#[tauri::command]
pub fn workspace_pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Open Bonk workspace")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

/// Rename the workspace folder `root` to `name` (same parent); returns the new path.
#[tauri::command]
pub fn workspace_rename_root(root: String, name: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Invalid folder name".into());
    }
    let from = std::path::Path::new(&root);
    let to = from.parent().ok_or("No parent folder")?.join(name);
    if to.exists() {
        return Err("A folder with that name already exists".into());
    }
    std::fs::rename(from, &to).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}

/// Move the workspace folder to the OS trash (never a hard delete).
#[tauri::command]
pub fn workspace_trash(root: String) -> Result<(), String> {
    require_absolute_root(&root)?;
    trash::delete(&root).map_err(|e| e.to_string())
}

/// Reject a workspace root that isn't an absolute path.
///
/// The frontend passes `root` (the folder the user picked via
/// [`workspace_pick_folder`], which always yields an absolute path) back on
/// every workspace call. Requiring it to be absolute stops a malformed or
/// crafted relative root from being resolved against the process CWD and
/// escaping the selected folder.
fn require_absolute_root(root: &str) -> Result<(), String> {
    if std::path::Path::new(root).is_absolute() {
        Ok(())
    } else {
        Err("workspace root must be an absolute path".to_string())
    }
}

#[tauri::command]
pub fn workspace_load(path: String) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    require_absolute_root(&path)?;
    bonk_core::application::workspace::load(&path)
}

#[tauri::command]
pub fn workspace_load_children(
    root: String,
    dir: String,
    keep: Vec<String>,
) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::load_children(&root, &dir, &keep)
}

#[tauri::command]
pub fn workspace_create_folder(
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::create_folder(&root, &parent, &name)
}

#[tauri::command]
pub fn workspace_save_folder_source(
    root: String,
    dir: String,
    source: Option<serde_json::Value>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::save_folder_source(&root, &dir, source)
}

#[tauri::command]
pub fn workspace_save_folder_auth(
    root: String,
    dir: String,
    auth: Option<bonk_core::domain::http::AuthConfig>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::save_folder_auth(&root, &dir, auth)
}

#[tauri::command]
pub fn workspace_save_request(
    root: String,
    dir: String,
    existing: Option<String>,
    node: bonk_core::domain::workspace::RequestNode,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::save_request(&root, &dir, existing.as_deref(), node)
}

#[tauri::command]
pub fn workspace_delete(root: String, path: String) -> Result<(), String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::delete(&root, &path)
}

#[tauri::command]
pub fn workspace_rename(root: String, path: String, name: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::rename(&root, &path, &name)
}

#[tauri::command]
pub fn workspace_duplicate(root: String, path: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::duplicate(&root, &path)
}

#[tauri::command]
pub fn workspace_move(root: String, path: String, dest: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::move_node(&root, &path, &dest)
}

#[tauri::command]
pub fn workspace_reorder(root: String, dir: String, names: Vec<String>) -> Result<(), String> {
    require_absolute_root(&root)?;
    bonk_core::application::workspace::reorder(&root, &dir, names)
}
