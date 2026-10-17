use crate::infra::metrics::{DiskKind, METRICS};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Serializes the read-modify-write in `set_key` across all threads. The async
/// `app_state_set` command runs it on Tauri's blocking pool, and the frontend
/// debounces each key independently, so concurrent calls are routine — without
/// this lock they would interleave and drop one another's keys.
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Parse a state document, tolerating corruption: a non-object or unparseable
/// file is treated as empty (and logged) so a single bad write can't wedge the
/// app. `set_key` copies such a file aside before it rewrites it.
fn parse_or_empty(raw: &str, src: &Path) -> Value {
    match parse_object(raw) {
        Some(v) => v,
        None => {
            eprintln!(
                "app_state: ignoring unreadable state at {} (starting empty)",
                src.display()
            );
            Value::Object(Map::new())
        }
    }
}

fn parse_object(raw: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(raw) {
        Ok(v @ Value::Object(_)) => Some(v),
        _ => None,
    }
}

/// Copy an unparseable `path` to `<name>.corrupt-<unix-ts>` next to it, so a rewrite
/// doesn't destroy what the user may still recover by hand.
fn back_up_corrupt(path: &Path) -> Result<(), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("state.json");
    let backup = path.with_file_name(format!("{name}.corrupt-{ts}"));
    fs::copy(path, &backup).map_err(|e| {
        format!(
            "{} is not valid JSON and could not be backed up ({e}); not overwriting it",
            path.display()
        )
    })?;
    eprintln!(
        "app_state: {} was not valid JSON, saved a copy as {}",
        path.display(),
        backup.display()
    );
    Ok(())
}

/// The map `set_key` builds on. Unlike `load_map`, a corrupt `path` is copied aside
/// first, and if that copy fails the write is refused instead of wiping the file.
fn load_for_write(path: &Path) -> Result<Map<String, Value>, String> {
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if let Some(Value::Object(m)) = parse_object(&raw) {
            return Ok(m);
        }
        back_up_corrupt(path)?;
        return Ok(Map::new());
    }
    match load_map(path)? {
        Value::Object(m) => Ok(m),
        _ => Ok(Map::new()),
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
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let mut map = load_for_write(path)?;
    map.insert(key.to_string(), value);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?;
    // Unique tmp name so a stray concurrent writer (or a future lock-free caller)
    // can't clobber an in-flight temp file before the rename.
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.tmp.{}.{seq}", std::process::id()));
    let written = out.len() as u64;
    // sync_all before the rename: otherwise a crash can leave a renamed but empty file.
    let write_tmp = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(out.as_bytes())?;
        f.sync_all()
    };
    if let Err(e) = write_tmp() {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    METRICS.record_disk_write(DiskKind::State, written);
    if let Err(e) = fs::rename(&tmp, path) {
        // The rename failed, so the temp file is now an orphan — clean it up
        // before returning rather than leaking a `.tmp` file on every failure.
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
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
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
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

    fn corrupt_copies(dir: &Path) -> Vec<std::path::PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().contains("state.json.corrupt-"))
            .collect()
    }

    #[test]
    fn malformed_state_is_backed_up_before_rewrite() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        fs::write(&path, "{ not valid json").unwrap();
        assert_eq!(load_map(&path).unwrap(), json!({}));
        assert!(
            corrupt_copies(&dir).is_empty(),
            "a read alone must not copy"
        );
        // a write still succeeds and heals the file, but the old bytes are kept aside
        set_key(&path, "ok", json!(1)).unwrap();
        assert_eq!(load_map(&path).unwrap()["ok"], json!(1));
        let copies = corrupt_copies(&dir);
        assert_eq!(copies.len(), 1);
        assert_eq!(fs::read_to_string(&copies[0]).unwrap(), "{ not valid json");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn malformed_state_is_not_overwritten_when_backup_fails() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        fs::write(&path, "{ not valid json").unwrap();
        // A read-only dir: the corrupt copy can't be created.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let err = set_key(&path, "ok", json!(1)).unwrap_err();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(err.contains("not valid JSON"), "{err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ not valid json");
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
