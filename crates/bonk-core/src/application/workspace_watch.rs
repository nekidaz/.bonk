//! What a burst of filesystem events means for the open workspace: which folders to re-read and
//! whether `.bonk/` (scenarios, «ask on send» inputs) changed. The watcher itself lives in the
//! Tauri shell; this part only maps paths, so it is tested without touching the disk.
use super::workspace::FOLDER_FILE;
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

/// More changed folders than this re-reads the whole workspace (a git checkout, a bulk import).
const MAX_DIRS: usize = 32;

/// How long a path this process wrote is still taken for an echo of that write.
const OWN_WRITE_TTL: Duration = Duration::from_secs(2);

/// Paths this process wrote recently. The watcher reports the app's own writes back, and the
/// app has already re-read those folders itself: re-reading them again was wasted work — an
/// import of a big collection came back as one or two full workspace reloads. Entries expire
/// after [`OWN_WRITE_TTL`]; an external edit of the same path inside that window is picked up
/// by the next change to it. Other processes (bonk MCP, the CLI) never land here.
#[derive(Default)]
struct OwnWrites {
    entries: Vec<(PathBuf, Instant)>,
}

impl OwnWrites {
    fn note(&mut self, path: PathBuf, now: Instant) {
        self.prune(now);
        self.entries.push((path, now));
    }

    /// `paths` without the ones noted within the TTL.
    fn filter(&mut self, paths: Vec<PathBuf>, now: Instant) -> Vec<PathBuf> {
        self.prune(now);
        paths
            .into_iter()
            .filter(|p| !self.entries.iter().any(|(own, _)| own == p))
            .collect()
    }

    fn prune(&mut self, now: Instant) {
        self.entries
            .retain(|(_, at)| now.duration_since(*at) < OWN_WRITE_TTL);
    }
}

static OWN_WRITES: Mutex<OwnWrites> = Mutex::new(OwnWrites {
    entries: Vec::new(),
});

/// Remember that this process just wrote, created, renamed or removed `path`.
pub fn note_own_write(path: &Path) {
    // The watcher reports resolved paths (`/private/var` on macOS); the parent still exists
    // for a path that was just removed, so resolve through it.
    let resolved = match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => parent
            .canonicalize()
            .map(|p| p.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    };
    if let Ok(mut own) = OWN_WRITES.lock() {
        own.note(resolved, Instant::now());
    }
}

/// `paths` from the watcher minus the echoes of this process's own recent writes.
pub fn without_own_writes(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    match OWN_WRITES.lock() {
        Ok(mut own) => own.filter(paths, Instant::now()),
        Err(_) => paths,
    }
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChange {
    /// Workspace-relative folders whose listing or requests changed ('' = the root).
    pub dirs: Vec<String>,
    /// Too much changed to patch the tree folder by folder: re-read all of it.
    pub full: bool,
    /// Something under `.bonk/` changed.
    pub meta: bool,
}

impl WorkspaceChange {
    pub fn is_empty(&self) -> bool {
        self.dirs.is_empty() && !self.full && !self.meta
    }
}

/// Map changed `paths` (absolute, under `root`) to the folders whose tree nodes are stale.
pub fn classify<P: AsRef<Path>>(root: &Path, paths: &[P]) -> WorkspaceChange {
    let mut dirs = BTreeSet::new();
    let mut meta = false;
    for path in paths {
        let Ok(rel) = path.as_ref().strip_prefix(root) else {
            continue;
        };
        let parts: Vec<String> = rel
            .components()
            .filter_map(|c| match c {
                Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect();
        let Some((name, parents)) = parts.split_last() else {
            continue; // the root itself
        };
        if parents.first().unwrap_or(name) == ".bonk" {
            meta = true;
            continue;
        }
        if parents.iter().any(|p| p.starts_with('.')) {
            continue; // .git, editor and OS folders
        }
        // A request, a subfolder: its folder lists it. Folder settings sit on the folder's own
        // node, which its parent lists. Other dotfiles (.DS_Store) are not in the tree.
        let up = match name.as_str() {
            FOLDER_FILE => 2,
            n if n.starts_with('.') => continue,
            _ => 1,
        };
        dirs.insert(parts[..parts.len().saturating_sub(up)].join("/"));
    }
    let full = dirs.len() > MAX_DIRS;
    WorkspaceChange {
        dirs: if full {
            Vec::new()
        } else {
            dirs.into_iter().collect()
        },
        full,
        meta,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(paths: &[&str]) -> WorkspaceChange {
        let root = Path::new("/ws");
        let abs: Vec<_> = paths.iter().map(|p| root.join(p)).collect();
        classify(root, &abs)
    }

    #[test]
    fn a_changed_request_or_subfolder_refreshes_the_folder_that_lists_it() {
        let c = run(&["auth/Otp/send.bonk.json", "auth/New", "top.bonk.json"]);
        assert_eq!(c.dirs, ["", "auth", "auth/Otp"]);
        assert!(!c.full && !c.meta);
    }

    #[test]
    fn folder_settings_refresh_the_parent_of_that_folder() {
        assert_eq!(run(&["auth/Otp/.folder.bonk.json"]).dirs, ["auth"]);
        assert_eq!(run(&["auth/.folder.bonk.json"]).dirs, [""]);
    }

    #[test]
    fn bonk_meta_is_flagged_and_hidden_paths_are_ignored() {
        let c = run(&[
            ".bonk/scenarios.json",
            ".bonk",
            ".git/index",
            "auth/.DS_Store",
        ]);
        assert!(c.meta);
        assert!(c.dirs.is_empty() && !c.full);
        assert!(run(&["", "/elsewhere/x.bonk.json"]).is_empty());
    }

    #[test]
    fn a_large_burst_asks_for_a_full_reload() {
        let paths: Vec<String> = (0..=MAX_DIRS)
            .map(|i| format!("f{i}/r.bonk.json"))
            .collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let c = run(&refs);
        assert!(c.full && c.dirs.is_empty());
    }

    #[test]
    fn own_recent_writes_are_dropped_until_they_expire() {
        let mut own = OwnWrites::default();
        let t0 = Instant::now();
        let mine = PathBuf::from("/ws/a/r.bonk.json");
        let theirs = PathBuf::from("/ws/a/other.bonk.json");
        own.note(mine.clone(), t0);
        assert_eq!(
            own.filter(
                vec![mine.clone(), theirs.clone()],
                t0 + Duration::from_millis(500)
            ),
            vec![theirs.clone()]
        );
        assert_eq!(
            own.filter(vec![mine.clone()], t0 + OWN_WRITE_TTL),
            vec![mine]
        );
        assert!(own.entries.is_empty());
    }
}
