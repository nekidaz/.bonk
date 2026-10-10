// --- Installing bonk-mcp into local AI clients (logic: bonk_core::application::mcp_install) ---

use bonk_core::application::mcp_install::{
    self, McpDirs, McpInstallOptions, McpIntegrationStatus, McpOperationResult,
};
use serde_json::Value;
use tauri::{AppHandle, Manager};

fn dirs(app: &AppHandle) -> Result<McpDirs, String> {
    let path = app.path();
    let data_err =
        |error: tauri::Error| format!("failed to resolve the Bonk data directory: {error}");
    Ok(McpDirs {
        home: path
            .home_dir()
            .map_err(|error| format!("failed to find the home directory: {error}"))?,
        data: path.app_data_dir().map_err(data_err)?,
        local_data: path.app_local_data_dir().map_err(data_err)?,
    })
}

#[tauri::command]
pub async fn mcp_integration_status(app: AppHandle) -> Result<McpIntegrationStatus, String> {
    mcp_install::status(&dirs(&app)?).await
}

#[tauri::command]
pub async fn mcp_install(
    app: AppHandle,
    options: McpInstallOptions,
) -> Result<McpOperationResult, String> {
    mcp_install::install(&dirs(&app)?, options).await
}

#[tauri::command]
pub async fn mcp_uninstall(
    app: AppHandle,
    clients: Option<Vec<String>>,
) -> Result<McpOperationResult, String> {
    mcp_install::uninstall(&dirs(&app)?, clients).await
}

/// `{"mcpServers":{"bonk":{…}}}` for configuring any other MCP client by hand.
#[tauri::command]
pub fn mcp_client_config(app: AppHandle, options: McpInstallOptions) -> Result<String, String> {
    mcp_install::client_config(&dirs(&app)?, options)
}

/// Newest-first tool calls recorded by every installed server.
#[tauri::command]
pub fn mcp_journal(app: AppHandle, limit: Option<usize>) -> Result<Vec<Value>, String> {
    Ok(mcp_install::journal(&dirs(&app)?, limit))
}
