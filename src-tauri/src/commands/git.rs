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
pub fn git_commit(root: String, message: String, amend: Option<bool>) -> Result<String, String> {
    git::commit(&root, &message, amend.unwrap_or(false))
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

#[tauri::command]
pub fn git_branch_list(root: String) -> Result<Vec<git::GitBranch>, String> {
    git::branch_list(&root)
}

#[tauri::command]
pub fn git_checkout_remote(root: String, name: String) -> Result<(), String> {
    git::checkout_remote(&root, &name)
}

#[tauri::command]
pub fn git_stash_list(root: String) -> Result<Vec<git::GitStash>, String> {
    git::stash_list(&root)
}

#[tauri::command]
pub fn git_stash_push(
    root: String,
    message: String,
    include_untracked: bool,
    staged_only: bool,
    keep_index: bool,
) -> Result<(), String> {
    git::stash_push(&root, &message, include_untracked, staged_only, keep_index)
}

#[tauri::command]
pub fn git_stash_apply(root: String, index: u32) -> Result<(), String> {
    git::stash_apply(&root, index)
}

#[tauri::command]
pub fn git_stash_pop(root: String, index: u32) -> Result<(), String> {
    git::stash_pop(&root, index)
}

#[tauri::command]
pub fn git_stash_drop(root: String, index: u32) -> Result<(), String> {
    git::stash_drop(&root, index)
}

#[tauri::command]
pub fn git_stash_branch(root: String, name: String, index: u32) -> Result<(), String> {
    git::stash_branch(&root, &name, index)
}

#[tauri::command]
pub fn git_stash_show(root: String, index: u32) -> Result<Vec<git::StashFile>, String> {
    git::stash_show(&root, index)
}
