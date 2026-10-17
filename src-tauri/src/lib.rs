mod commands;
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
        // AppKit puts the traffic lights back on these; move them to the toolbar's centre again.
        .on_window_event(|window, event| {
            use tauri::{Manager, WindowEvent};
            if let WindowEvent::Resized(_)
            | WindowEvent::Focused(_)
            | WindowEvent::ThemeChanged(_)
            | WindowEvent::ScaleFactorChanged { .. } = event
            {
                let state = window.state::<state::AppState>();
                let center = *state
                    .traffic_lights_center
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                commands::app::place_traffic_lights(window, center);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::http::cancel_request,
            commands::http::request_stop_stream,
            commands::terminal::terminal_default_cwd,
            commands::terminal::pty_open,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_close,
            commands::terminal::pty_stage_env,
            commands::http::http_prepare,
            commands::http::http_resolve,
            commands::http::dynamic_samples,
            commands::http::http_send,
            commands::http::run_script,
            commands::runner::runner_run,
            commands::runner::request_run,
            commands::workspace::workspace_import_collection,
            commands::workspace::scenarios_load,
            commands::workspace::scenarios_save,
            commands::workspace::scenarios_delete,
            commands::workspace::inputs_load,
            commands::workspace::inputs_save,
            commands::runner::runner_pause,
            commands::runner::runner_stop,
            commands::runner::runner_input_answer,
            commands::cookies::cookies_list,
            commands::cookies::cookies_jar_path,
            commands::cookies::cookies_keep_session,
            commands::cookies::cookies_add,
            commands::cookies::cookies_remove,
            commands::cookies::cookies_clear,
            commands::grpc::grpc_connect,
            commands::grpc::cert_file_info,
            commands::grpc::grpc_prepare,
            commands::grpc::grpc_tls_inspect,
            commands::grpc::grpc_reflect,
            commands::grpc::grpc_template,
            commands::grpc::grpc_call,
            commands::grpc::grpc_stream,
            commands::grpc::grpc_stream_send,
            commands::grpc::grpc_stream_end,
            commands::grpc::grpc_load_proto,
            commands::grpc::proto_pick,
            commands::grpc::proto_pick_folder,
            commands::grpc::grpc_proto_inspect,
            commands::grpc::proto_read,
            commands::workspace::workspace_pick_folder,
            commands::app::file_pick,
            commands::app::traffic_lights_right,
            commands::app::traffic_lights_center,
            commands::app::openapi_import_pick,
            commands::app::import_read_file,
            commands::settings_file::settings_file_read,
            commands::settings_file::settings_file_write,
            commands::settings_file::settings_file_open_external,
            commands::themes::themes_list,
            commands::themes::theme_save,
            commands::themes::theme_delete,
            commands::themes::theme_import_pick,
            commands::app::openapi_export_save,
            commands::app::app_data_dir,
            commands::app::reveal_path,
            commands::app::open_releases,
            commands::app::open_url,
            commands::oauth::oauth_status,
            commands::oauth::oauth_token,
            commands::oauth::oauth_forget,
            commands::oauth::oauth_revoke,
            commands::oauth::oauth_login_start,
            commands::oauth::oauth_login_wait,
            commands::oauth::oauth_login_input,
            commands::session::session_status,
            commands::session::session_run,
            commands::session::session_forget,
            commands::session::session_save_caught,
            commands::session::session_peek,
            commands::workspace::workspace_rename_root,
            commands::workspace::workspace_trash,
            commands::workspace::workspace_load,
            commands::workspace::workspace_watch,
            commands::workspace::workspace_load_children,
            commands::workspace::workspace_load_light,
            commands::workspace::workspace_load_children_light,
            commands::workspace::workspace_read_requests,
            commands::workspace::workspace_create_folder,
            commands::workspace::workspace_save_request,
            commands::workspace::workspace_save_folder_auth,
            commands::workspace::workspace_save_folder_source,
            commands::workspace::workspace_delete,
            commands::workspace::workspace_rename,
            commands::workspace::workspace_duplicate,
            commands::workspace::workspace_move,
            commands::workspace::workspace_reorder,
            commands::app::app_state_load,
            commands::app::app_state_set,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            commands::git::git_status,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_init,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_create_branch,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_diff,
            commands::git::git_log,
            commands::git::git_status_diffs,
            commands::git::git_discard,
            commands::git::git_graph,
            commands::git::git_branch_list,
            commands::git::git_checkout_remote,
            commands::git::git_stash_list,
            commands::git::git_stash_push,
            commands::git::git_stash_apply,
            commands::git::git_stash_pop,
            commands::git::git_stash_drop,
            commands::git::git_stash_branch,
            commands::git::git_stash_show,
            commands::git::git_graph_log,
            commands::git::git_commit_detail,
            commands::git::git_commit_file_diff,
            commands::git::git_cherry_pick,
            commands::git::git_revert,
            commands::git::git_merge,
            commands::git::git_rebase,
            commands::git::git_checkout_detached,
            commands::git::git_reset,
            commands::git::git_create_tag,
            commands::git::git_create_branch_at,
            commands::git::git_format_patch,
            commands::git::git_fetch,
            commands::git::git_operation_abort,
            commands::git::git_operation_continue,
            commands::git::git_conflicts,
            commands::git::git_operation_info,
            commands::git::git_resolve_file,
            commands::git::git_resolve_side,
            commands::git::git_unresolve,
            commands::git::git_operation_skip,
            commands::git::git_rebase_plan,
            commands::git::git_rebase_interactive,
            commands::git::git_rebase_undo,
            commands::git::git_remote_list,
            commands::git::git_remote_add,
            commands::git::git_remote_remove,
            commands::git::git_clone,
            commands::git::git_reflog,
            commands::git::git_commits_touching,
            commands::git::git_apply_patch,
            commands::git::git_restore_snapshot,
            commands::git::git_head,
            commands::git::git_move_head,
            commands::git::git_compare,
            commands::git::git_compare_file_diff,
            commands::git::git_delete_branch,
            commands::git::git_delete_remote_branch,
            commands::git::git_rename_branch,
            commands::git::git_delete_tag,
            commands::git::git_push_tag,
            commands::git::git_file_log,
            commands::git::git_blame,
            commands::mcp::mcp_integration_status,
            commands::mcp::mcp_install,
            commands::mcp::mcp_uninstall,
            commands::mcp::mcp_client_config,
            commands::mcp::mcp_journal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
