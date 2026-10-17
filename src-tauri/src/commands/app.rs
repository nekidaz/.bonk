use bonk_core::application::import_file::{self, ImportedFile};
use tauri::Manager;

#[tauri::command]
pub fn file_pick() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Attach file")
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// Read a file the user dropped on the window or picked earlier (recent sources).
#[tauri::command]
pub fn import_read_file(path: String) -> Result<ImportedFile, String> {
    import_file::read(std::path::Path::new(&path))
}

/// Prompt for a Postman Collection or OpenAPI / Swagger file and return its
/// name + contents. `Ok(None)` when the user cancels the dialog.
#[tauri::command]
pub fn openapi_import_pick() -> Result<Option<ImportedFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("API Collection / Spec", &import_file::EXTENSIONS)
        .set_title("Import Collection / OpenAPI")
        .pick_file()
    else {
        return Ok(None);
    };
    import_file::read(&path).map(Some)
}

/// Prompt for a GraphQL schema file (SDL or introspection JSON). `Ok(None)` on cancel.
#[tauri::command]
pub fn graphql_schema_pick() -> Result<Option<ImportedFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("GraphQL schema", &import_file::SCHEMA_EXTENSIONS)
        .set_title("Load GraphQL schema")
        .pick_file()
    else {
        return Ok(None);
    };
    import_file::read_with(&path, &import_file::SCHEMA_EXTENSIONS).map(Some)
}

/// Re-read a schema file bound to a request earlier.
#[tauri::command]
pub fn graphql_schema_read(path: String) -> Result<ImportedFile, String> {
    import_file::read_with(std::path::Path::new(&path), &import_file::SCHEMA_EXTENSIONS)
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
    open_in_browser("https://github.com/nekidaz/.bonk/releases")
}

/// Open an http(s) link in the system browser (an OAuth login page, say).
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open_in_browser(&url)
}

/// Every caller goes through here: only http(s) reaches the OS opener, never `file:` or
/// another app's scheme (URLs come from workspace files, which may come from anyone).
pub(crate) fn open_in_browser(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("bad link: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) links can be opened".into());
    }
    let url = parsed.as_str();
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(url).status()
    } else {
        std::process::Command::new("xdg-open").arg(url).status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
pub async fn app_state_load(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    super::off_main(move || bonk_core::application::app_state::load_map(&state_path(&app)?)).await
}

#[tauri::command]
pub async fn app_state_set(
    app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    super::off_main(move || {
        bonk_core::application::app_state::set_key(&state_path(&app)?, &key, value)
    })
    .await
}

/// Right edge, in points from the window's left, of the macOS traffic lights, so the
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

/// Left inset of the close button, in points (only placed on macOS).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_X: f64 = 21.0;
/// Their vertical centre before the toolbar reports its own: half of its 54px at 100% zoom.
pub const TRAFFIC_LIGHTS_CENTER: f64 = 27.0;

/// Centre the traffic lights on the toolbar, `center` points from the window top. The toolbar's
/// height follows zoom and density, so the frontend calls this whenever it changes (AppToolbar).
#[tauri::command]
pub fn traffic_lights_center(
    window: tauri::WebviewWindow,
    state: tauri::State<crate::state::AppState>,
    center: f64,
) {
    *state
        .traffic_lights_center
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = center;
    place_traffic_lights(&window.as_ref().window(), center);
}

/// Moves the macOS window buttons (what tao's `trafficLightPosition` does, but with a centre that
/// can change at runtime). AppKit lays the title bar out again on resize, full screen and focus,
/// so lib.rs calls this again on those window events.
pub fn place_traffic_lights(window: &tauri::Window, center: f64) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSWindow, NSWindowButton};
        if objc2::MainThreadMarker::new().is_none() {
            return;
        }
        let Ok(ptr) = window.ns_window() else { return };
        // SAFETY: Tauri hands out its live NSWindow; we only touch its title bar on the main thread.
        let Some(ns_window) = (unsafe { (ptr as *const NSWindow).as_ref() }) else {
            return;
        };
        let button = |kind| ns_window.standardWindowButton(kind);
        let (Some(close), Some(mini), Some(zoom)) = (
            button(NSWindowButton::CloseButton),
            button(NSWindowButton::MiniaturizeButton),
            button(NSWindowButton::ZoomButton),
        ) else {
            return;
        };
        if close.isHidden() {
            return; // full screen
        }
        // SAFETY: plain view-hierarchy reads on the main thread (button → title bar → its container).
        let Some(container) = (unsafe { close.superview().and_then(|v| v.superview()) }) else {
            return;
        };
        // The buttons keep a fixed offset from the bottom of the title bar container, so its
        // height is what moves their centre.
        let b = close.frame();
        let mut rect = container.frame();
        rect.size.height = center + b.origin.y + b.size.height / 2.0;
        rect.origin.y = ns_window.frame().size.height - rect.size.height;
        container.setFrame(rect);
        let step = mini.frame().origin.x - b.origin.x;
        for (i, btn) in [close, mini, zoom].iter().enumerate() {
            let mut origin = btn.frame().origin;
            origin.x = TRAFFIC_LIGHTS_X + i as f64 * step;
            btn.setFrameOrigin(origin);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, center);
    }
}
