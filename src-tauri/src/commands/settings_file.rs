// --- User settings in ~/.bonk/settings.json (logic: bonk_core::application::settings_file) ---

use super::off_main;
use bonk_core::application::settings_file;
use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("failed to find the home directory: {e}"))?;
    Ok(settings_file::path(&home))
}

/// The file's text, `None` when it doesn't exist yet.
#[tauri::command]
pub async fn settings_file_read(app: AppHandle) -> Result<Option<String>, String> {
    off_main(move || settings_file::read(&settings_path(&app)?)).await
}

#[tauri::command]
pub async fn settings_file_write(app: AppHandle, text: String) -> Result<(), String> {
    off_main(move || settings_file::write(&settings_path(&app)?, &text)).await
}

/// Open the file in the system's text editor. The path is ours, never from the frontend.
#[tauri::command]
pub async fn settings_file_open_external(app: AppHandle) -> Result<(), String> {
    off_main(move || {
        let path = settings_path(&app)?;
        let mut cmd = if cfg!(target_os = "macos") {
            // -t: the default text editor, not whatever app claims .json.
            let mut c = std::process::Command::new("open");
            c.arg("-t");
            c
        } else if cfg!(target_os = "windows") {
            std::process::Command::new("notepad")
        } else {
            std::process::Command::new("xdg-open")
        };
        cmd.arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
}
