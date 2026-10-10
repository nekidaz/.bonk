use tauri::Manager;

#[tauri::command]
pub fn file_pick() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Attach file")
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// A spec file the user picked for OpenAPI/Swagger import: its base name plus
/// the full text. Pick + read are atomic (one dialog, one read) so no generic
/// arbitrary-path read primitive is exposed to the frontend.
#[derive(serde::Serialize)]
pub struct ImportedFile {
    name: String,
    text: String,
}

/// Prompt for a Postman Collection or OpenAPI / Swagger file and return its
/// name + contents. `Ok(None)` when the user cancels the dialog.
#[tauri::command]
pub fn openapi_import_pick() -> Result<Option<ImportedFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter(
            "API Collection / Spec",
            &["json", "yaml", "yml", "har", "txt", "sh", "curl"],
        )
        .set_title("Import Collection / OpenAPI")
        .pick_file()
    else {
        return Ok(None);
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(ImportedFile { name, text }))
}

/// Prompt for a save location and write `contents` there. `Ok(None)` when the
/// user cancels the dialog; on success returns the chosen path.
#[tauri::command]
pub fn openapi_export_save(
    default_name: String,
    contents: String,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .set_title(title.as_deref().unwrap_or("Export OpenAPI"))
        .save_file()
    else {
        return Ok(None);
    };
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// App data directory (where state.json lives), for the Data settings section.
#[tauri::command]
pub fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Reveal `path` in the OS file manager.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg("-R").arg(p).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .status()
    } else {
        std::process::Command::new("xdg-open")
            .arg(p.parent().unwrap_or(p))
            .status()
    };
    // explorer exits non-zero even on success, so only a spawn failure is an error.
    status.map(|_| ()).map_err(|e| e.to_string())
}

/// Open the public release notes (the in-app update popover's "All changes").
#[tauri::command]
pub fn open_releases() -> Result<(), String> {
    const URL: &str = "https://github.com/nekidaz/.bonk/releases";
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(URL).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(URL).status()
    } else {
        std::process::Command::new("xdg-open").arg(URL).status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
pub fn app_state_load(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    bonk_core::application::app_state::load_map(&state_path(&app)?)
}

#[tauri::command]
pub fn app_state_set(
    app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    bonk_core::application::app_state::set_key(&state_path(&app)?, &key, value)
}

/// Right edge, in CSS px from the window's left, of the macOS traffic lights, so the
/// toolbar can start right after them whatever their size on this macOS version.
/// `None` off macOS or while they are hidden (full screen).
#[tauri::command]
pub fn traffic_lights_right(window: tauri::WebviewWindow) -> Option<f64> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSWindow, NSWindowButton};
        // Sync commands run on the main thread, which AppKit requires.
        objc2::MainThreadMarker::new()?;
        let ptr = window.ns_window().ok()? as *const NSWindow;
        // SAFETY: Tauri hands out its live NSWindow; we only read button frames on the main thread.
        let ns_window = unsafe { ptr.as_ref() }?;
        let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton)?;
        if zoom.isHidden() {
            return None;
        }
        let frame = zoom.frame();
        Some(frame.origin.x + frame.size.width)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        None
    }
}
