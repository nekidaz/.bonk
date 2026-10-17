use super::off_main;
use crate::state::AppState;
use bonk_core::domain::http::CookieInfo;
use bonk_core::infra::cookie_jar::CookieJar;
use std::sync::Arc;
use tauri::{Manager, State};

/// The cookie jar of workspace root `workspace` ('' = the app-wide jar).
pub(super) fn jar(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    workspace: &str,
) -> Result<Arc<CookieJar>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    state.cookie_jar(&data_dir, workspace)
}

#[tauri::command]
pub async fn cookies_list(
    workspace: String,
    app: tauri::AppHandle,
) -> Result<Vec<CookieInfo>, String> {
    off_main(move || Ok(jar(&app, &app.state(), &workspace)?.list())).await
}

/// Settings → Cookies “Keep across restarts” changed: re-save the jar with or without
/// its session cookies right away (not only on the next request).
#[tauri::command]
pub async fn cookies_keep_session(
    workspace: String,
    keep: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    off_main(move || {
        let jar = jar(&app, &app.state(), &workspace)?;
        jar.set_keep_session(keep);
        jar.save()
    })
    .await
}

/// Where the jar file lives (shown in the jar window's footer).
#[tauri::command]
pub async fn cookies_jar_path(workspace: String, app: tauri::AppHandle) -> Result<String, String> {
    off_main(move || {
        Ok(jar(&app, &app.state(), &workspace)?
            .path()
            .to_string_lossy()
            .into_owned())
    })
    .await
}

/// Add or replace a cookie from a `Set-Cookie` value, as if `url` had sent it.
#[tauri::command]
pub async fn cookies_add(
    workspace: String,
    url: String,
    set_cookie: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    off_main(move || {
        let jar = jar(&app, &app.state(), &workspace)?;
        jar.add(&set_cookie, &url)?;
        jar.save()
    })
    .await
}

#[tauri::command]
pub async fn cookies_remove(
    workspace: String,
    domain: String,
    path: String,
    name: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    off_main(move || {
        let jar = jar(&app, &app.state(), &workspace)?;
        let removed = jar.remove(&domain, &path, &name);
        jar.save()?;
        Ok(removed)
    })
    .await
}

/// Remove every cookie of `domain`, or the whole jar when `domain` is null.
#[tauri::command]
pub async fn cookies_clear(
    workspace: String,
    domain: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    off_main(move || {
        let jar = jar(&app, &app.state(), &workspace)?;
        jar.clear(domain.as_deref());
        jar.save()
    })
    .await
}
