// --- OS keychain for secret env vars ---

fn secret_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("io.github.nekidaz.bonk", key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match secret_entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    secret_entry(&key)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match secret_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
