use serde_json::{Map, Value};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Serializes the read-modify-write in `set_key` across all threads. Tauri runs
/// non-async commands on a blocking thread pool, and the frontend debounces each
/// key independently, so concurrent `app_state_set` calls are routine — without
/// this lock they would interleave and drop one another's keys.
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Parse a state document, tolerating corruption: a non-object or unparseable
/// file is treated as empty (and logged) so a single bad write can't wedge the
/// app — the next `set_key` heals the file.
fn parse_or_empty(raw: &str, src: &Path) -> Value {
    match serde_json::from_str::<Value>(raw) {
        Ok(v @ Value::Object(_)) => v,
        _ => {
            eprintln!(
                "app_state: ignoring unreadable state at {} (starting empty)",
                src.display()
            );
            Value::Object(Map::new())
        }
    }
}

/// Load the state map from `path`, migrating once from a sibling legacy
/// `bonk.json` (the old plugin-store file) if `state.json` doesn't exist yet.
pub fn load_map(path: &Path) -> Result<Value, String> {
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        return Ok(parse_or_empty(&raw, path));
    }
    let legacy = path.with_file_name("bonk.json");
    if legacy.exists() {
        let raw = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
        return Ok(parse_or_empty(&raw, &legacy));
    }
    Ok(Value::Object(Map::new()))
}

/// Set one key and atomically rewrite `path`. Per-key atomic (not transactional
/// across keys): each call writes the whole document from the latest on-disk
/// state plus this one key. Serialized process-wide by `WRITE_LOCK`.
pub fn set_key(path: &Path, key: &str, value: Value) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "state lock poisoned".to_string())?;
    let mut map: Map<String, Value> = match load_map(path)? {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    map.insert(key.to_string(), value);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?;
    // Unique tmp name so a stray concurrent writer (or a future lock-free caller)
    // can't clobber an in-flight temp file before the rename.
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.tmp.{}.{seq}", std::process::id()));
    fs::write(&tmp, out).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Unique temp dir per test. Atomic counter guarantees a unique path even
    /// when parallel tests call this within the same clock tick.
    fn temp_dir() -> std::path::PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "bonk-state-{}-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn load_missing_file_returns_empty_object() {
        let dir = temp_dir();
        let path = dir.join("state.json");
        // Neither state.json nor a legacy bonk.json exists.
        let v = load_map(&path).unwrap();
        assert_eq!(v, json!({}));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn set_then_load_roundtrip() {
        let dir = temp_dir();
        let path = dir.join("state.json");
        set_key(&path, "workspacePath", json!("/tmp/ws")).unwrap();
        let v = load_map(&path).unwrap();
        assert_eq!(v["workspacePath"], json!("/tmp/ws"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn set_two_keys_both_present() {
        let dir = temp_dir();
        let path = dir.join("state.json");
        set_key(&path, "historyLimit", json!(500)).unwrap();
        set_key(&path, "historyPaused", json!(false)).unwrap();
        let v = load_map(&path).unwrap();
        assert_eq!(v["historyLimit"], json!(500));
        assert_eq!(v["historyPaused"], json!(false));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_set_keys_no_lost_updates() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        let n = 24;
        std::thread::scope(|s| {
            for i in 0..n {
                let p = path.clone();
                s.spawn(move || set_key(&p, &format!("k{i}"), json!(i)).unwrap());
            }
        });
        let v = load_map(&path).unwrap();
        for i in 0..n {
            assert_eq!(v[format!("k{i}")], json!(i), "key k{i} lost");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn malformed_state_is_treated_as_empty() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        fs::write(&path, "{ not valid json").unwrap();
        assert_eq!(load_map(&path).unwrap(), json!({}));
        // a write still succeeds and heals the file
        set_key(&path, "ok", json!(1)).unwrap();
        assert_eq!(load_map(&path).unwrap()["ok"], json!(1));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migrates_from_legacy_bonk_json() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        // state.json missing; a legacy bonk.json sits next to it.
        let legacy = path.with_file_name("bonk.json");
        fs::write(&legacy, r#"{"tabs":[{"id":"a"}],"historyLimit":42}"#).unwrap();
        let v = load_map(&path).unwrap();
        assert_eq!(v["historyLimit"], json!(42));
        assert_eq!(v["tabs"], json!([{"id":"a"}]));
        let _ = fs::remove_dir_all(dir);
    }
}
