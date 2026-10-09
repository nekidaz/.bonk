use bonk_core::application::git;

#[tauri::command]
pub fn git_status(root: String) -> Result<git::GitStatus, String> {
    git::status(&root)
}

#[tauri::command]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    git::stage(&root, &paths)
}

#[tauri::command]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    git::unstage(&root, &paths)
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    git::commit(&root, &message)
}

#[tauri::command]
pub fn git_init(root: String) -> Result<(), String> {
    git::init(&root)
}

#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<String>, String> {
    git::branches(&root)
}

#[tauri::command]
pub fn git_checkout(root: String, name: String) -> Result<(), String> {
    git::checkout(&root, &name)
}

#[tauri::command]
pub fn git_create_branch(root: String, name: String) -> Result<(), String> {
    git::create_branch(&root, &name)
}

#[tauri::command]
pub fn git_push(root: String) -> Result<String, String> {
    git::push(&root)
}

#[tauri::command]
pub fn git_pull(root: String) -> Result<String, String> {
    git::pull(&root)
}

#[tauri::command]
pub fn git_diff(root: String, path: String, cached: Option<bool>) -> Result<String, String> {
    if cached.unwrap_or(false) {
        git::diff_staged(&root, &path)
    } else {
        git::diff(&root, &path)
    }
}

#[tauri::command]
pub fn git_log(root: String, limit: u32) -> Result<Vec<git::GitCommit>, String> {
    git::log(&root, limit)
}

#[tauri::command]
pub fn git_status_diffs(root: String) -> Result<Vec<git::FileDiff>, String> {
    git::status_diffs(&root)
}

#[tauri::command]
pub fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    git::discard(&root, &paths)
}

#[tauri::command]
pub fn git_graph(root: String, limit: u32) -> Result<Vec<String>, String> {
    git::graph(&root, limit)
}
