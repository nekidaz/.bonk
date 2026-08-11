mod commands;
mod mcp_install;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state::AppState::default())
        .setup(|app| {
            // macOS: the default app menu binds ⌘W to "Close Window", which fires
            // before the webview ever sees the keydown — stealing the frontend's
            // close-tab shortcut. Strip that one item; the rest of the default
            // menu (Quit, Edit clipboard actions, etc.) stays.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItemKind};
                let menu = Menu::default(app.handle())?;
                for item in menu.items()? {
                    if let MenuItemKind::Submenu(sub) = item {
                        for child in sub.items()? {
                            if let MenuItemKind::Predefined(p) = &child {
                                if p.text()?.eq_ignore_ascii_case("close window") {
                                    sub.remove(&child)?;
                                }
                            }
                        }
                    }
                }
                app.set_menu(menu)?;
            }
            let _ = app; // non-macOS: unused
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cancel_request,
            commands::terminal_default_cwd,
            commands::terminal_run,
            commands::http_send,
            commands::run_script,
            commands::grpc_connect,
            commands::grpc_reflect,
            commands::grpc_template,
            commands::grpc_call,
            commands::grpc_load_proto,
            commands::proto_pick,
            commands::workspace_pick_folder,
            commands::file_pick,
            commands::openapi_import_pick,
            commands::openapi_export_save,
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
            commands::git_graph,
            mcp_install::mcp_integration_status,
            mcp_install::mcp_install,
            mcp_install::mcp_uninstall
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
