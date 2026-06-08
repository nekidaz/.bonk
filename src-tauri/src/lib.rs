mod commands;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::cancel_request,
            commands::http_send,
            commands::grpc_connect,
            commands::grpc_reflect,
            commands::grpc_template,
            commands::grpc_call,
            commands::grpc_load_proto,
            commands::proto_pick,
            commands::workspace_pick_folder,
            commands::file_pick,
            commands::workspace_load,
            commands::workspace_create_folder,
            commands::workspace_save_request,
            commands::workspace_delete,
            commands::workspace_rename,
            commands::workspace_duplicate,
            commands::workspace_move,
            commands::app_state_load,
            commands::app_state_set,
            commands::git_status,
            commands::git_stage,
            commands::git_unstage,
            commands::git_commit,
            commands::git_init,
            commands::git_branches,
            commands::git_checkout,
            commands::git_create_branch,
            commands::git_push,
            commands::git_pull,
            commands::git_diff,
            commands::git_log,
            commands::git_status_diffs,
            commands::git_discard,
            commands::git_graph
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
