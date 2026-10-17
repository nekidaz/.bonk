//! User settings (issue #2): `~/.bonk/settings.json`, like VS Code's / Zed's. The frontend owns
//! the format (keys, defaults, validation); here the file is only read and written.

use crate::infra::metrics::{DiskKind, METRICS};
use std::path::{Path, PathBuf};

/// `write` calls share one temp file name; the async command can run two at once.
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// A settings file is a few kilobytes; a bigger one is not ours.
const MAX_BYTES: u64 = 1024 * 1024;

/// `~/.bonk/settings.json`.
pub fn path(home: &Path) -> PathBuf {
    home.join(".bonk").join("settings.json")
}

/// The file's text, or `None` when there is no file yet.
pub fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
        Ok(m) if m.len() > MAX_BYTES => {
            return Err(format!("{}: file is larger than 1 MB", path.display()))
        }
        Ok(_) => {}
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Replace the file atomically (temp file + rename), so an editor or a crash never sees half of it.
pub fn write(path: &Path, text: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = path.parent().ok_or("settings path has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    METRICS.record_disk_write(DiskKind::Settings, text.len() as u64);
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nothing_then_writes_and_reads_back() {
        let home = std::env::temp_dir().join(format!("bonk-settings-{}", fastrand::u64(..)));
        let file = path(&home);
        assert_eq!(read(&file).unwrap(), None);

        write(&file, "{\"ui.fontSize\": 14}\n").unwrap();
        write(&file, "{\"ui.fontSize\": 12}\n").unwrap();
        assert_eq!(
            read(&file).unwrap().as_deref(),
            Some("{\"ui.fontSize\": 12}\n")
        );
        let left: Vec<_> = std::fs::read_dir(file.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, ["settings.json"]);

        std::fs::write(&file, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert!(read(&file).is_err());
        std::fs::remove_dir_all(home).ok();
    }
}
