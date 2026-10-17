use super::off_main;

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

/// The running folder watcher (dropping it stops it).
pub type Watcher =
    notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

/// Report changes made to workspace `root` from outside the app (bonk MCP, git, an editor) on
/// `on_change`, debounced; `root` = '' stops watching. One workspace is watched at a time.
#[tauri::command]
pub fn workspace_watch(
    state: tauri::State<'_, crate::state::AppState>,
    root: String,
    on_change: tauri::ipc::Channel<bonk_core::application::workspace_watch::WorkspaceChange>,
) -> Result<(), String> {
    use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
    let mut slot = state
        .workspace_watcher
        .lock()
        .map_err(|_| "workspace watcher lock poisoned".to_string())?;
    *slot = None;
    if root.is_empty() {
        return Ok(());
    }
    require_absolute_root(&root)?;
    // The OS reports resolved paths (/private/var on macOS), so compare against the resolved root.
    let base = std::path::Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("{root}: {e}"))?;
    let watch_root = base.clone();
    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(300),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            // The app's own writes come back as events too; it has re-read those folders already.
            let paths = bonk_core::application::workspace_watch::without_own_writes(
                events.into_iter().map(|e| e.path).collect(),
            );
            let change = bonk_core::application::workspace_watch::classify(&base, &paths);
            if !change.is_empty() {
                let _ = on_change.send(change);
            }
        },
    )
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(&watch_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *slot = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub async fn workspace_load(
    path: String,
) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    require_absolute_root(&path)?;
    off_main(move || bonk_core::application::workspace::load(&path)).await
}

/// The sidebar's tree plus the request files it couldn't read (shown to the user as a warning).
#[derive(serde::Serialize)]
pub struct LoadedTree {
    tree: Vec<bonk_core::domain::workspace::TreeNode>,
    skipped: Vec<String>,
}

/// `workspace_load` without bodies, scripts and spec links: the sidebar's tree.
#[tauri::command]
pub async fn workspace_load_light(path: String) -> Result<LoadedTree, String> {
    require_absolute_root(&path)?;
    let (tree, skipped) =
        off_main(move || bonk_core::application::workspace::load_with_skipped(&path, true)).await?;
    Ok(LoadedTree { tree, skipped })
}

#[tauri::command]
pub async fn workspace_load_children_light(
    root: String,
    dir: String,
    keep: Vec<String>,
) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::load_children_light(&root, &dir, &keep))
        .await
}

/// The full request nodes at workspace-relative paths `rels`.
#[tauri::command]
pub async fn workspace_read_requests(
    root: String,
    rels: Vec<String>,
) -> Result<Vec<bonk_core::domain::workspace::RequestNode>, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::read_requests(&root, &rels)).await
}

#[tauri::command]
pub async fn workspace_load_children(
    root: String,
    dir: String,
    keep: Vec<String>,
) -> Result<Vec<bonk_core::domain::workspace::TreeNode>, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::load_children(&root, &dir, &keep)).await
}

#[tauri::command]
pub async fn workspace_create_folder(
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::create_folder(&root, &parent, &name)).await
}

#[tauri::command]
pub async fn workspace_save_folder_source(
    root: String,
    dir: String,
    source: Option<serde_json::Value>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::save_folder_source(&root, &dir, source))
        .await
}

#[tauri::command]
pub async fn workspace_save_folder_scripts(
    root: String,
    dir: String,
    pre_request_script: Option<String>,
    test_script: Option<String>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || {
        bonk_core::application::workspace::save_folder_scripts(
            &root,
            &dir,
            pre_request_script,
            test_script,
        )
    })
    .await
}

#[tauri::command]
pub async fn workspace_save_folder_auth(
    root: String,
    dir: String,
    auth: Option<bonk_core::domain::http::AuthConfig>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::save_folder_auth(&root, &dir, auth)).await
}

#[tauri::command]
pub async fn workspace_save_request(
    root: String,
    dir: String,
    existing: Option<String>,
    node: bonk_core::domain::workspace::RequestNode,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    off_main(move || {
        bonk_core::application::workspace::save_request(&root, &dir, existing.as_deref(), node)
    })
    .await
}

#[tauri::command]
pub async fn workspace_delete(root: String, path: String) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::delete(&root, &path)).await
}

#[tauri::command]
pub async fn workspace_rename(root: String, path: String, name: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::rename(&root, &path, &name)).await
}

#[tauri::command]
pub async fn workspace_duplicate(root: String, path: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::duplicate(&root, &path)).await
}

#[tauri::command]
pub async fn workspace_move(root: String, path: String, dest: String) -> Result<String, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::move_node(&root, &path, &dest)).await
}

#[tauri::command]
pub async fn workspace_reorder(
    root: String,
    dir: String,
    names: Vec<String>,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::reorder(&root, &dir, names)).await
}

#[tauri::command]
pub async fn scenarios_load(
    root: String,
) -> Result<Vec<bonk_core::application::scenarios::Scenario>, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::scenarios::load(std::path::Path::new(&root))).await
}
#[tauri::command]
pub async fn scenarios_save(
    root: String,
    scenario: bonk_core::application::scenarios::Scenario,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::scenarios::save(std::path::Path::new(&root), scenario))
        .await
}
#[tauri::command]
pub async fn scenarios_delete(root: String, name: String) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::scenarios::delete(std::path::Path::new(&root), &name))
        .await
}

#[tauri::command]
pub async fn inputs_load(root: String) -> Result<bonk_core::application::inputs::Inputs, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::inputs::load(std::path::Path::new(&root))).await
}
#[tauri::command]
pub async fn inputs_save(
    root: String,
    inputs: bonk_core::application::inputs::Inputs,
) -> Result<(), String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::inputs::save(std::path::Path::new(&root), inputs))
        .await
}

#[tauri::command]
pub async fn workspace_import_collection(
    root: String,
    collection: bonk_core::application::workspace::ImportCollection,
) -> Result<String, String> {
    require_absolute_root(&root)?;
    off_main(move || bonk_core::application::workspace::import_collection(&root, collection)).await
}
