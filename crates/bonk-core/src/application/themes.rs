//! User themes (Flow · Темы TH3): one `<slug>.json` per theme in `~/.bonk/themes`, written by the
//! import dialog. The frontend owns the format; here the files are only listed and saved.

use std::path::{Path, PathBuf};

/// A theme file: its slug (file stem) and text.
#[derive(Debug, serde::Serialize)]
pub struct ThemeFile {
    pub slug: String,
    pub text: String,
}

/// Larger files in the themes dir are skipped: a theme is a few kilobytes.
const MAX_BYTES: u64 = 1024 * 1024;

/// `~/.bonk/themes`.
pub fn dir(home: &Path) -> PathBuf {
    home.join(".bonk").join("themes")
}

/// A slug names the file, so only `[a-z0-9-]` gets through (no `..`, no separators).
fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Every `<slug>.json` in `dir`, sorted by slug. A missing dir is no themes.
pub fn list(dir: &Path) -> Result<Vec<ThemeFile>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {e}", dir.display())),
    };
    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(slug) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".json"))
        else {
            continue;
        };
        let small_file = entry
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() <= MAX_BYTES);
        if !valid_slug(slug) || !small_file {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            themes.push(ThemeFile {
                slug: slug.to_string(),
                text,
            });
        }
    }
    themes.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(themes)
}

/// Write `<slug>.json` (replacing a theme with the same slug) and return its path.
pub fn save(dir: &Path, slug: &str, text: &str) -> Result<String, String> {
    if !valid_slug(slug) {
        return Err(format!("Invalid theme name: {slug}"));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(format!("{slug}.json"));
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Delete `<slug>.json`. A theme already gone is not an error.
pub fn remove(dir: &Path, slug: &str) -> Result<(), String> {
    if !valid_slug(slug) {
        return Err(format!("Invalid theme name: {slug}"));
    }
    let path = dir.join(format!("{slug}.json"));
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{}: {e}", path.display()))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_lists_theme_files() {
        let home = std::env::temp_dir().join(format!("bonk-themes-{}", fastrand::u64(..)));
        let dir = dir(&home);
        assert!(list(&dir).unwrap().is_empty());

        save(&dir, "rose-pine", "{\"name\":\"Rosé Pine\"}").unwrap();
        save(&dir, "nord-2", "{}").unwrap();
        save(&dir, "nord-2", "{\"v\":2}").unwrap();
        std::fs::write(dir.join("Bad Name.json"), "{}").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        let got: Vec<_> = list(&dir)
            .unwrap()
            .into_iter()
            .map(|t| (t.slug, t.text))
            .collect();
        assert_eq!(
            got,
            [
                ("nord-2".to_string(), "{\"v\":2}".to_string()),
                (
                    "rose-pine".to_string(),
                    "{\"name\":\"Rosé Pine\"}".to_string()
                ),
            ]
        );
        for bad in ["", "../x", "a/b", "Up"] {
            assert!(save(&dir, bad, "{}").is_err(), "{bad}");
            assert!(remove(&dir, bad).is_err(), "{bad}");
        }

        remove(&dir, "nord-2").unwrap();
        remove(&dir, "nord-2").unwrap();
        let left: Vec<_> = list(&dir).unwrap().into_iter().map(|t| t.slug).collect();
        assert_eq!(left, ["rose-pine"]);
        std::fs::remove_dir_all(home).ok();
    }
}
