use bonk_core::application::git;

/// Run a git call on the blocking pool. Every command shells out to `git`, and a
/// sync Tauri command runs on the main thread, freezing the window until git
/// returns (a slow push held it for up to two minutes).
async fn off_main<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

#[tauri::command]
pub async fn git_status(root: String) -> Result<git::GitStatus, String> {
    off_main(move || git::status(&root)).await
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    off_main(move || git::stage(&root, &paths)).await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    off_main(move || git::unstage(&root, &paths)).await
}

#[tauri::command]
pub async fn git_commit(
    root: String,
    message: String,
    amend: Option<bool>,
) -> Result<String, String> {
    off_main(move || git::commit(&root, &message, amend.unwrap_or(false))).await
}

#[tauri::command]
pub async fn git_init(root: String) -> Result<(), String> {
    off_main(move || git::init(&root)).await
}

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<String>, String> {
    off_main(move || git::branches(&root)).await
}

#[tauri::command]
pub async fn git_checkout(root: String, name: String) -> Result<(), String> {
    off_main(move || git::checkout(&root, &name)).await
}

#[tauri::command]
pub async fn git_create_branch(root: String, name: String) -> Result<(), String> {
    off_main(move || git::create_branch(&root, &name)).await
}

#[tauri::command]
pub async fn git_push(root: String, force: bool) -> Result<String, String> {
    off_main(move || git::push(&root, force)).await
}

#[tauri::command]
pub async fn git_pull(root: String) -> Result<String, String> {
    off_main(move || git::pull(&root)).await
}

#[tauri::command]
pub async fn git_diff(root: String, path: String, cached: Option<bool>) -> Result<String, String> {
    off_main(move || {
        if cached.unwrap_or(false) {
            git::diff_staged(&root, &path)
        } else {
            git::diff(&root, &path)
        }
    })
    .await
}

#[tauri::command]
pub async fn git_log(root: String, limit: u32) -> Result<Vec<git::GitCommit>, String> {
    off_main(move || git::log(&root, limit)).await
}

#[tauri::command]
pub async fn git_status_diffs(root: String) -> Result<Vec<git::FileDiff>, String> {
    off_main(move || git::status_diffs(&root)).await
}

#[tauri::command]
pub async fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    off_main(move || git::discard(&root, &paths)).await
}

#[tauri::command]
pub async fn git_graph(root: String, limit: u32) -> Result<Vec<String>, String> {
    off_main(move || git::graph(&root, limit)).await
}

#[tauri::command]
pub async fn git_branch_list(root: String) -> Result<Vec<git::GitBranch>, String> {
    off_main(move || git::branch_list(&root)).await
}

#[tauri::command]
pub async fn git_checkout_remote(root: String, name: String) -> Result<(), String> {
    off_main(move || git::checkout_remote(&root, &name)).await
}

#[tauri::command]
pub async fn git_stash_list(root: String) -> Result<Vec<git::GitStash>, String> {
    off_main(move || git::stash_list(&root)).await
}

#[tauri::command]
pub async fn git_stash_push(
    root: String,
    message: String,
    include_untracked: bool,
    staged_only: bool,
    keep_index: bool,
) -> Result<(), String> {
    off_main(move || git::stash_push(&root, &message, include_untracked, staged_only, keep_index))
        .await
}

#[tauri::command]
pub async fn git_stash_apply(root: String, index: u32) -> Result<(), String> {
    off_main(move || git::stash_apply(&root, index)).await
}

#[tauri::command]
pub async fn git_stash_pop(root: String, index: u32) -> Result<(), String> {
    off_main(move || git::stash_pop(&root, index)).await
}

#[tauri::command]
pub async fn git_stash_drop(root: String, index: u32) -> Result<(), String> {
    off_main(move || git::stash_drop(&root, index)).await
}

#[tauri::command]
pub async fn git_stash_branch(root: String, name: String, index: u32) -> Result<(), String> {
    off_main(move || git::stash_branch(&root, &name, index)).await
}

#[tauri::command]
pub async fn git_stash_show(root: String, index: u32) -> Result<Vec<git::StashFile>, String> {
    off_main(move || git::stash_show(&root, index)).await
}

#[tauri::command]
pub async fn git_graph_log(
    root: String,
    all: bool,
    skip: u32,
    limit: u32,
) -> Result<git::GraphPage, String> {
    off_main(move || git::graph_log(&root, all, skip, limit)).await
}

#[tauri::command]
pub async fn git_commit_detail(root: String, hash: String) -> Result<git::CommitDetail, String> {
    off_main(move || git::commit_detail(&root, &hash)).await
}

#[tauri::command]
pub async fn git_commit_file_diff(
    root: String,
    hash: String,
    path: String,
) -> Result<String, String> {
    off_main(move || git::commit_file_diff(&root, &hash, &path)).await
}

#[tauri::command]
pub async fn git_cherry_pick(root: String, hashes: Vec<String>) -> Result<(), String> {
    off_main(move || git::cherry_pick(&root, &hashes)).await
}

#[tauri::command]
pub async fn git_revert(root: String, hashes: Vec<String>) -> Result<(), String> {
    off_main(move || git::revert(&root, &hashes)).await
}

#[tauri::command]
pub async fn git_merge(root: String, branch: String) -> Result<(), String> {
    off_main(move || git::merge(&root, &branch)).await
}

#[tauri::command]
pub async fn git_rebase(root: String, onto: String) -> Result<(), String> {
    off_main(move || git::rebase(&root, &onto)).await
}

#[tauri::command]
pub async fn git_checkout_detached(root: String, hash: String) -> Result<(), String> {
    off_main(move || git::checkout_detached(&root, &hash)).await
}

#[tauri::command]
pub async fn git_reset(root: String, hash: String, mode: String) -> Result<(), String> {
    off_main(move || git::reset(&root, &hash, &mode)).await
}

#[tauri::command]
pub async fn git_create_tag(root: String, name: String, hash: String) -> Result<(), String> {
    off_main(move || git::create_tag(&root, &name, &hash)).await
}

#[tauri::command]
pub async fn git_create_branch_at(root: String, name: String, hash: String) -> Result<(), String> {
    off_main(move || git::create_branch_at(&root, &name, &hash)).await
}

#[tauri::command]
pub async fn git_format_patch(root: String, hashes: Vec<String>) -> Result<String, String> {
    off_main(move || git::format_patch(&root, &hashes)).await
}

#[tauri::command]
pub async fn git_fetch(root: String) -> Result<String, String> {
    off_main(move || git::fetch(&root)).await
}

#[tauri::command]
pub async fn git_operation_abort(root: String) -> Result<(), String> {
    off_main(move || git::operation_abort(&root)).await
}

#[tauri::command]
pub async fn git_operation_continue(root: String) -> Result<(), String> {
    off_main(move || git::operation_continue(&root)).await
}

#[tauri::command]
pub async fn git_conflicts(root: String) -> Result<Vec<git::ConflictFile>, String> {
    off_main(move || git::conflicts(&root)).await
}

#[tauri::command]
pub async fn git_operation_info(root: String) -> Result<git::OperationInfo, String> {
    off_main(move || git::operation_info(&root)).await
}

#[tauri::command]
pub async fn git_resolve_file(root: String, path: String, content: String) -> Result<(), String> {
    off_main(move || git::resolve_file(&root, &path, &content)).await
}

#[tauri::command]
pub async fn git_resolve_side(
    root: String,
    paths: Vec<String>,
    side: String,
) -> Result<(), String> {
    off_main(move || git::resolve_side(&root, &paths, &side)).await
}

#[tauri::command]
pub async fn git_unresolve(root: String, paths: Vec<String>) -> Result<(), String> {
    off_main(move || git::unresolve(&root, &paths)).await
}

#[tauri::command]
pub async fn git_operation_skip(root: String) -> Result<(), String> {
    off_main(move || git::operation_skip(&root)).await
}

#[tauri::command]
pub async fn git_rebase_plan(root: String, onto: String) -> Result<git::RebasePlan, String> {
    off_main(move || git::rebase_plan(&root, &onto)).await
}

#[tauri::command]
pub async fn git_rebase_interactive(
    root: String,
    onto: String,
    steps: Vec<git::RebaseAction>,
) -> Result<(), String> {
    off_main(move || git::rebase_interactive(&root, &onto, &steps)).await
}
