//! What a burst of filesystem events means for the open workspace: which folders to re-read and
//! whether `.bonk/` (scenarios, «ask on send» inputs) changed. The watcher itself lives in the
//! Tauri shell; this part only maps paths, so it is tested without touching the disk.
use super::workspace::FOLDER_FILE;
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::{Component, Path},
};

/// More changed folders than this re-reads the whole workspace (a git checkout, a bulk import).
const MAX_DIRS: usize = 32;

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
}
