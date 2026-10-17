// --- User themes in ~/.bonk/themes (logic: bonk_core::application::themes) ---

use super::off_main;
use bonk_core::application::import_file::{self, ImportedFile};
use bonk_core::application::themes::{self, ThemeFile};
use tauri::{AppHandle, Manager};

fn themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("failed to find the home directory: {e}"))?;
    Ok(themes::dir(&home))
}

#[tauri::command]
pub async fn themes_list(app: AppHandle) -> Result<Vec<ThemeFile>, String> {
    off_main(move || themes::list(&themes_dir(&app)?)).await
}

#[tauri::command]
pub async fn theme_save(app: AppHandle, slug: String, text: String) -> Result<String, String> {
    off_main(move || themes::save(&themes_dir(&app)?, &slug, &text)).await
}

#[tauri::command]
pub async fn theme_delete(app: AppHandle, slug: String) -> Result<(), String> {
    off_main(move || themes::remove(&themes_dir(&app)?, &slug)).await
}

/// Prompt for a Zed / VS Code theme file. `Ok(None)` when the user cancels.
#[tauri::command]
pub fn theme_import_pick() -> Result<Option<ImportedFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Zed / VS Code theme", &["json"])
        .set_title("Import theme")
        .pick_file()
    else {
        return Ok(None);
    };
    import_file::read(&path).map(Some)
}
