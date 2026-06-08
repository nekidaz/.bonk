//! Git source-control core for the "git-first" Bonk workspace.
//!
//! Every operation shells out to the SYSTEM `git` CLI via `git -C <root> ...`.
//! Driving the real binary (instead of a linked libgit2) means we inherit the
//! user's git config, SSH agent, and credential helper — so `push`/`pull` work
//! against their remotes exactly as on the command line.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

/// One changed/untracked path from `git status`.
///
/// `index`/`worktree` are single porcelain status chars rendered as strings
/// (`"M"`, `"A"`, `"D"`, `"R"`, `"?"`, `" "`) so the JS side can switch on them
/// without re-deriving meaning.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub index: String,
    pub worktree: String,
}

/// Snapshot of the repo: branch, tracking position, and the dirty file list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
    /// Path of the workspace relative to the git toplevel, forward-slash and
    /// trailing-slash terminated (e.g. `"collections/"`); empty when the
    /// workspace *is* the toplevel. File paths in `files` are toplevel-relative,
    /// so the frontend maps a workspace-relative node id by prefixing it.
    pub prefix: String,
}

/// One entry from `git log`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

/// One changed file plus its unified diff, for the Project Diff view.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub staged: bool,
    pub untracked: bool,
    pub diff: String,
}

/// Run `git -C <root> <args...>` and capture stdout/stderr as UTF-8.
///
/// On success returns `Ok(stdout)`. On a non-zero exit returns `Err` with the
/// trimmed stderr (falling back to stdout / a generic message when stderr is
/// empty) so the surfaced error is always something git actually said.
fn git(root: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            Err(stderr)
        } else {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !stdout.is_empty() {
                Err(stdout)
            } else {
                Err(format!("git {} failed", args.join(" ")))
            }
        }
    }
}

/// `true` if `root` is inside a git work tree.
pub fn is_repo(root: &str) -> bool {
    git(root, &["rev-parse", "--is-inside-work-tree"]).is_ok()
}

/// Absolute path of the git toplevel (work-tree root) that contains `root`,
/// from `git -C <root> rev-parse --show-toplevel`. `Err` when `root` isn't a
/// repo. All per-path git ops run with `-C <toplevel>` so the paths git
/// *emits* (status) and the paths we *pass back* (stage/diff/discard) are
/// consistently toplevel-relative — otherwise a subdir workspace would
/// double-prefix paths and silently fail.
fn toplevel(root: &str) -> Result<String, String> {
    let out = git(root, &["rev-parse", "--show-toplevel"])?;
    Ok(out.trim().to_string())
}

/// Path of the workspace relative to the git toplevel, forward-slash and
/// trailing-slash terminated (e.g. `"collections/"`), or empty when the
/// workspace is the toplevel. From `git -C <root> rev-parse --show-prefix`
/// (which already returns a `/`-separated, trailing-slash form).
fn show_prefix(root: &str) -> String {
    match git(root, &["rev-parse", "--show-prefix"]) {
        Ok(out) => out.trim().to_string(),
        Err(_) => String::new(),
    }
}

/// Parse the `## ...` branch header that `--branch -z` emits as the first record.
///
/// Forms handled (per git porcelain v1):
///   `## main`
///   `## main...origin/main`
///   `## main...origin/main [ahead 1]`
///   `## main...origin/main [ahead 1, behind 2]`
///   `## HEAD (no branch)`            (detached)
///   `## No commits yet on main`      (unborn branch)
fn parse_branch_header(line: &str) -> (String, Option<String>, u32, u32) {
    let rest = line.strip_prefix("## ").unwrap_or(line);

    // Unborn branch: "No commits yet on <name>".
    if let Some(name) = rest.strip_prefix("No commits yet on ") {
        return (name.trim().to_string(), None, 0, 0);
    }
    // Detached HEAD: "HEAD (no branch)".
    if rest.starts_with("HEAD (no branch)") {
        return (String::new(), None, 0, 0);
    }

    // Split off the optional " [ahead N, behind M]" suffix.
    let (head, track) = match rest.split_once(" [") {
        Some((h, t)) => (h, Some(t.trim_end_matches(']'))),
        None => (rest, None),
    };

    // head is "branch" or "branch...upstream".
    let (branch, upstream) = match head.split_once("...") {
        Some((b, up)) => (b.to_string(), Some(up.to_string())),
        None => (head.to_string(), None),
    };

    let (mut ahead, mut behind) = (0u32, 0u32);
    if let Some(track) = track {
        for part in track.split(',') {
            let part = part.trim();
            if let Some(n) = part.strip_prefix("ahead ") {
                ahead = n.trim().parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                behind = n.trim().parse().unwrap_or(0);
            }
        }
    }
    (branch, upstream, ahead, behind)
}

/// Full working-tree status. Returns a non-repo placeholder when `root` isn't a
/// git repo (so callers can offer "init" without a separate probe).
///
/// Runs against the git toplevel (not `root`), so when the workspace is a
/// subdirectory of the repo the emitted file paths are toplevel-relative and
/// match the paths that [`stage`]/[`discard`]/[`diff`] feed back to git. The
/// returned `prefix` lets the frontend map workspace-relative node ids onto
/// these toplevel-relative paths.
pub fn status(root: &str) -> Result<GitStatus, String> {
    let top = match toplevel(root) {
        Ok(top) => top,
        Err(_) => {
            return Ok(GitStatus {
                is_repo: false,
                branch: String::new(),
                upstream: None,
                ahead: 0,
                behind: 0,
                files: vec![],
                prefix: String::new(),
            });
        }
    };
    let prefix = show_prefix(root);

    // `--untracked-files=all` expands a new directory into its individual files
    // instead of collapsing it to one `dir/` entry — so the panel shows every
    // file, not just the folder.
    let out = git(
        &top,
        &["status", "--porcelain=v1", "--branch", "--untracked-files=all", "-z"],
    )?;

    // `-z` yields NUL-delimited records. The first is the `## ...` header; the
    // rest are `XY <path>` entries. A rename/copy (`R`/`C`) is split across two
    // records: `XY <new-path>` then `<old-path>`, so when we see one we consume
    // the following record as its source.
    let mut records = out.split('\0');

    let header = records.next().unwrap_or("");
    let (branch, upstream, ahead, behind) = parse_branch_header(header);

    let mut files: Vec<GitFile> = Vec::new();
    while let Some(rec) = records.next() {
        if rec.is_empty() {
            continue;
        }
        // Each entry is "XY <path>" — two status chars, a space, then the path.
        let bytes = rec.as_bytes();
        if bytes.len() < 3 {
            continue;
        }
        let index = (bytes[0] as char).to_string();
        let worktree = (bytes[1] as char).to_string();
        let path = rec[3..].to_string();
        // Renames/copies carry the source path in the next record — drop it.
        if bytes[0] == b'R' || bytes[0] == b'C' {
            records.next();
        }
        files.push(GitFile {
            path,
            index,
            worktree,
        });
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(GitStatus {
        is_repo: true,
        branch,
        upstream,
        ahead,
        behind,
        files,
        prefix,
    })
}

/// Stage `paths` (or everything with `add -A` when empty).
///
/// `paths` are toplevel-relative (the paths [`status`] emits), so we run
/// against the toplevel rather than `root` — see [`toplevel`].
pub fn stage(root: &str, paths: &[String]) -> Result<(), String> {
    let top = toplevel(root)?;
    if paths.is_empty() {
        git(&top, &["add", "-A"])?;
    } else {
        let mut args: Vec<&str> = vec!["add", "--"];
        args.extend(paths.iter().map(|s| s.as_str()));
        git(&top, &args)?;
    }
    Ok(())
}

/// Unstage `paths` (or everything when empty) by resetting them to HEAD.
pub fn unstage(root: &str, paths: &[String]) -> Result<(), String> {
    let top = toplevel(root)?;
    if paths.is_empty() {
        git(&top, &["reset", "-q", "HEAD", "--"])?;
    } else {
        let mut args: Vec<&str> = vec!["reset", "-q", "HEAD", "--"];
        args.extend(paths.iter().map(|s| s.as_str()));
        git(&top, &args)?;
    }
    Ok(())
}

/// Map of `new path → old path` for every staged rename/copy (`R`/`C`) in the
/// index, read from `git status --porcelain=v1 -z`.
///
/// `-z` splits a rename/copy across two NUL records — `XY <new>` then `<old>` —
/// so when the index char is `R`/`C` we pair the entry with the record that
/// follows it. Used by [`discard`] to recover the original path the new path
/// came from (the new path alone doesn't exist in HEAD).
fn staged_renames(top: &str) -> HashMap<String, String> {
    let out = match git(top, &["status", "--porcelain=v1", "--untracked-files=no", "-z"]) {
        Ok(out) => out,
        Err(_) => return HashMap::new(),
    };
    let mut map = HashMap::new();
    let mut records = out.split('\0');
    while let Some(rec) = records.next() {
        let bytes = rec.as_bytes();
        if bytes.len() < 3 {
            continue;
        }
        // Index char is the first status char; a staged rename/copy carries its
        // source path in the very next record.
        if bytes[0] == b'R' || bytes[0] == b'C' {
            let new_path = rec[3..].to_string();
            if let Some(old_path) = records.next() {
                map.insert(new_path, old_path.to_string());
            }
        }
    }
    map
}

/// Discard changes to `paths`, reverting each to its HEAD state. Files that
/// don't exist at HEAD (untracked or newly-added) are removed from the index
/// (if staged) and deleted from disk. Files in HEAD are restored in both the
/// index and the working tree.
///
/// A *staged rename* (status `R`, where `paths` holds the new path) fully
/// reverts to HEAD: the original path is restored in the index and working tree
/// (un-staging the delete-side) and the new path is dropped — so the tree ends
/// clean rather than losing the file. Tracked-modify, untracked, and staged-new
/// files are handled as above.
pub fn discard(root: &str, paths: &[String]) -> Result<(), String> {
    // `paths` are toplevel-relative, so resolve the toplevel and run/join there.
    let top = toplevel(root)?;
    let renames = staged_renames(&top);
    for p in paths {
        // Staged rename: the new path isn't in HEAD, so the in-HEAD branch below
        // would only delete it and leave the old path staged-as-deleted. Restore
        // the old path from HEAD (un-staging the delete), then drop the new path.
        if let Some(old) = renames.get(p) {
            git(&top, &["restore", "--staged", "--worktree", "--source=HEAD", "--", old])?;
            let _ = git(&top, &["rm", "--cached", "-q", "--", p]);
            let _ = std::fs::remove_file(std::path::Path::new(&top).join(p));
            continue;
        }
        let in_head = git(&top, &["cat-file", "-e", &format!("HEAD:{p}")]).is_ok();
        if in_head {
            git(&top, &["restore", "--staged", "--worktree", "--source=HEAD", "--", p])?;
        } else {
            // Drop from the index if staged (no-op otherwise), then remove the file.
            let _ = git(&top, &["rm", "--cached", "-q", "--", p]);
            let _ = std::fs::remove_file(std::path::Path::new(&top).join(p));
        }
    }
    Ok(())
}

/// Commit the staged index with `message`; returns the new short hash. Surfaces
/// git's own error when nothing is staged or `user.name`/`user.email` is unset.
pub fn commit(root: &str, message: &str) -> Result<String, String> {
    git(root, &["commit", "-m", message])?;
    let short = git(root, &["rev-parse", "--short", "HEAD"])?;
    Ok(short.trim().to_string())
}

/// Initialise a new repo at `root` with `main` as the default branch.
///
/// `git init -b main` is supported since git 2.28, so on the target (2.50.1)
/// this is a single call. We still fall back to `symbolic-ref` if the `-b`
/// form is rejected, to stay safe on older binaries.
pub fn init(root: &str) -> Result<(), String> {
    if git(root, &["init", "-b", "main"]).is_err() {
        git(root, &["init"])?;
        // Only meaningful before the first commit; harmless otherwise.
        let _ = git(root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    }
    Ok(())
}

/// Current branch name, or `""` when detached / on an unborn branch.
pub fn current_branch(root: &str) -> Result<String, String> {
    let out = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let name = out.trim();
    if name == "HEAD" {
        // Detached HEAD reports the literal "HEAD".
        Ok(String::new())
    } else {
        Ok(name.to_string())
    }
}

/// Local branch names with the current branch first.
pub fn branches(root: &str) -> Result<Vec<String>, String> {
    // `for-each-ref` is stable and script-friendly (no leading `*` marker to strip).
    let out = git(
        root,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    )?;
    let mut names: Vec<String> = out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let current = current_branch(root)?;
    if !current.is_empty() {
        if let Some(pos) = names.iter().position(|n| n == &current) {
            let cur = names.remove(pos);
            names.insert(0, cur);
        }
    }
    Ok(names)
}

/// Switch to an existing branch. `--end-of-options` keeps a branch name that
/// begins with `-` from being parsed as a flag.
pub fn checkout(root: &str, name: &str) -> Result<(), String> {
    git(root, &["switch", "--end-of-options", name])?;
    Ok(())
}

/// Create and switch to a new branch. `--end-of-options` keeps a name that
/// begins with `-` from being parsed as a flag.
pub fn create_branch(root: &str, name: &str) -> Result<(), String> {
    git(root, &["switch", "-c", name, "--end-of-options"])?;
    Ok(())
}

/// Run `git push`. git prints progress/results to stderr, so we return the
/// combined stdout+stderr for the UI to display verbatim. Failure → `Err` with
/// the same combined output.
pub fn push(root: &str) -> Result<String, String> {
    run_combined(root, &["push"])
}

/// Run `git pull` (see [`push`] for the combined-output rationale).
pub fn pull(root: &str) -> Result<String, String> {
    run_combined(root, &["pull"])
}

/// Run a git command and return `stdout + stderr` concatenated, both on success
/// and (as the error) on failure — used for `push`/`pull` where git's useful
/// output goes to stderr.
///
/// We force non-interactive auth: `GIT_TERMINAL_PROMPT=0` and an SSH BatchMode
/// command. Without a controlling terminal a credential/passphrase prompt would
/// block `output()` forever (and with it a Tauri IPC worker), so we make missing
/// credentials fail fast with a clear error the UI can show instead of hanging.
fn run_combined(root: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}").trim().to_string();
    if output.status.success() {
        Ok(combined)
    } else if combined.is_empty() {
        Err(format!("git {} failed", args.join(" ")))
    } else {
        Err(combined)
    }
}

/// Unified diff for `path`: unstaged changes, the staged diff if the working
/// tree has none (so a freshly-staged file still shows a diff), and finally the
/// whole file as an addition when it's untracked (plain `diff` is empty for
/// files git doesn't track yet).
///
/// `path` is toplevel-relative (what [`status`] emits), so we resolve and run
/// against the toplevel — see [`toplevel`].
pub fn diff(root: &str, path: &str) -> Result<String, String> {
    let top = toplevel(root)?;
    diff_working_at(&top, path)
}

/// Staged (index-vs-HEAD) diff for `path`. `path` is toplevel-relative.
pub fn diff_staged(root: &str, path: &str) -> Result<String, String> {
    let top = toplevel(root)?;
    git(&top, &["diff", "--cached", "--", path])
}

fn diff_working_at(top: &str, path: &str) -> Result<String, String> {
    let unstaged = git(top, &["diff", "--", path])?;
    if !unstaged.trim().is_empty() {
        return Ok(unstaged);
    }
    let staged = git(top, &["diff", "--cached", "--", path])?;
    if !staged.trim().is_empty() {
        return Ok(staged);
    }
    diff_untracked_at(top, path)
}

/// Combined HEAD-vs-worktree diff for a tracked `path`: everything that differs
/// from HEAD regardless of which side (index/worktree) it sits on. Used by the
/// Project Diff so a file that is both staged *and* further modified (`MM`)
/// shows all of its changes — and so [`discard`] (revert to HEAD) exactly
/// undoes what's displayed rather than silently dropping a hidden staged hunk.
///
/// On an unborn branch (no commits yet) there is no HEAD to diff against, so we
/// fall back to the unstaged-then-staged probe — equivalent for a fresh repo
/// where every tracked change is just-added content.
fn diff_head_at(top: &str, path: &str) -> Result<String, String> {
    if git(top, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() {
        return diff_working_at(top, path);
    }
    git(top, &["diff", "HEAD", "--", path])
}

/// Diff an untracked file against `/dev/null` so its full contents show as
/// additions. `--no-index` exits 0 (identical) or 1 (differences) — both are
/// normal here; only a higher code is a real error.
fn diff_untracked_at(top: &str, path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(top)
        .args(["diff", "--no-index", "--", "/dev/null", path])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    match output.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
        _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
    }
}

/// Diff for every changed file in one pass, for the aggregate Project Diff view.
///
/// One entry per status file. Untracked files show their whole contents as an
/// addition. Every tracked file shows the **combined HEAD-vs-worktree** diff,
/// so a file that is both staged and further modified (`MM`) reveals all of its
/// changes — not just one side — and [`discard`] (which reverts to HEAD)
/// exactly undoes what's shown. The `staged` flag is set only when the file is
/// fully staged with a clean worktree, so the UI button reads "Unstage" only
/// then and otherwise "Stage" (to stage the remaining worktree changes).
pub fn status_diffs(root: &str) -> Result<Vec<FileDiff>, String> {
    let st = status(root)?;
    let top = toplevel(root)?;
    let mut out = Vec::with_capacity(st.files.len());
    for f in st.files {
        let untracked = f.index == "?";
        let (staged, diff) = if untracked {
            (false, diff_untracked_at(&top, &f.path)?)
        } else {
            // Fully staged with a clean worktree → "Unstage"; anything still in
            // the worktree → "Stage" (the rest). Either way the diff is the full
            // HEAD-vs-worktree delta so nothing staged is hidden.
            let fully_staged = f.index != " " && f.worktree == " ";
            (fully_staged, diff_head_at(&top, &f.path)?)
        };
        out.push(FileDiff {
            path: f.path,
            staged,
            untracked,
            diff,
        });
    }
    Ok(out)
}

/// Last `limit` commits, newest first. An empty repo (no commits) yields an
/// empty vec rather than an error.
pub fn log(root: &str, limit: u32) -> Result<Vec<GitCommit>, String> {
    let n = limit.to_string();
    // 0x1f (unit separator) between fields, newline between commits — neither
    // appears in hashes, short refs, author names, or short dates, and a subject
    // can't contain a newline.
    let fmt = "--pretty=format:%H\x1f%h\x1f%s\x1f%an\x1f%ad";
    let out = match git(
        root,
        &["log", "-n", &n, fmt, "--date=short"],
    ) {
        Ok(out) => out,
        // A repo with no commits errors ("does not have any commits yet"); treat
        // that as simply "no history".
        Err(_) => return Ok(vec![]),
    };

    let mut commits = Vec::new();
    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\x1f');
        let hash = parts.next().unwrap_or("").to_string();
        let short = parts.next().unwrap_or("").to_string();
        let subject = parts.next().unwrap_or("").to_string();
        let author = parts.next().unwrap_or("").to_string();
        let date = parts.next().unwrap_or("").to_string();
        commits.push(GitCommit {
            hash,
            short,
            subject,
            author,
            date,
        });
    }
    Ok(commits)
}

/// Raw decorated commit graph lines, exactly as git draws them.
pub fn graph(root: &str, limit: u32) -> Result<Vec<String>, String> {
    let n = limit.to_string();
    let out = match git(
        root,
        &[
            "log",
            "--graph",
            "--decorate",
            "--oneline",
            "--all",
            "-n",
            &n,
        ],
    ) {
        Ok(out) => out,
        Err(_) => return Ok(vec![]),
    };
    Ok(out.lines().map(|line| line.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        // Atomic counter guarantees a unique path per test even when parallel
        // tests call this within the same clock tick (avoids shared-tmp races).
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "bonk-git-{}-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    /// Init a repo and set a local identity so commits don't depend on the
    /// machine's global git config.
    fn init_repo() -> std::path::PathBuf {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let root = dir.to_str().unwrap();
        init(root).unwrap();
        git(root, &["config", "user.email", "t@e.com"]).unwrap();
        git(root, &["config", "user.name", "Test"]).unwrap();
        dir
    }

    #[test]
    fn is_repo_false_then_true_after_init() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let root = dir.to_str().unwrap();
        assert!(!is_repo(root), "fresh dir should not be a repo");
        init(root).unwrap();
        assert!(is_repo(root), "should be a repo after init");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_non_repo_placeholder() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let st = status(dir.to_str().unwrap()).unwrap();
        assert!(!st.is_repo);
        assert_eq!(st.branch, "");
        assert!(st.files.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_lists_untracked_file() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        let st = status(root).unwrap();
        assert!(st.is_repo);
        assert_eq!(st.branch, "main");
        let f = st
            .files
            .iter()
            .find(|f| f.path == "a.bonk.json")
            .expect("untracked file should appear");
        // Untracked is reported as "??".
        assert_eq!(f.index, "?");
        assert_eq!(f.worktree, "?");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn stage_commit_clears_status() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();

        stage(root, &["a.bonk.json".to_string()]).unwrap();
        let st = status(root).unwrap();
        let f = st
            .files
            .iter()
            .find(|f| f.path == "a.bonk.json")
            .expect("staged file should appear");
        // Newly-added staged file: index "A", worktree clean " ".
        assert_eq!(f.index, "A");
        assert_eq!(f.worktree, " ");

        let short = commit(root, "first commit").unwrap();
        assert!(!short.is_empty(), "commit should return a short hash");
        assert!(short.len() >= 4, "short hash looks too short: {short}");

        let st2 = status(root).unwrap();
        assert!(st2.files.is_empty(), "status should be clean after commit");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn branch_create_list_checkout() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // Need an initial commit before branching is meaningful.
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();

        create_branch(root, "feature").unwrap();
        assert_eq!(current_branch(root).unwrap(), "feature");

        let bs = branches(root).unwrap();
        assert_eq!(bs.first().map(String::as_str), Some("feature"), "current first");
        assert!(bs.iter().any(|b| b == "main"));
        assert!(bs.iter().any(|b| b == "feature"));

        checkout(root, "main").unwrap();
        assert_eq!(current_branch(root).unwrap(), "main");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn log_returns_commit() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // Empty repo → no history, no error.
        assert!(log(root, 10).unwrap().is_empty());

        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "hello world").unwrap();

        let entries = log(root, 10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].subject, "hello world");
        assert_eq!(entries[0].author, "Test");
        assert!(!entries[0].hash.is_empty());
        assert!(!entries[0].short.is_empty());
        assert!(!entries[0].date.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diff_shows_change() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();

        // Modify the tracked file → unstaged diff should show it.
        fs::write(dir.join("a.bonk.json"), "{\"v\":2}\n").unwrap();
        let d = diff(root, "a.bonk.json").unwrap();
        assert!(d.contains("a.bonk.json"), "diff should name the file");
        assert!(d.contains("+{\"v\":2}"), "diff should show the new line");
        assert!(d.contains("-{\"v\":1}"), "diff should show the old line");

        // Staged diff fallback: stage the change, working tree now clean.
        stage(root, &[]).unwrap();
        let d2 = diff(root, "a.bonk.json").unwrap();
        assert!(d2.contains("+{\"v\":2}"), "staged diff fallback should work");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diff_staged_uses_index_not_worktree() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();

        fs::write(dir.join("a.bonk.json"), "{\"v\":2}\n").unwrap();
        stage(root, &[]).unwrap();
        fs::write(dir.join("a.bonk.json"), "{\"v\":3}\n").unwrap();

        let staged = diff_staged(root, "a.bonk.json").unwrap();
        assert!(staged.contains("+{\"v\":2}"), "staged diff should show index version");
        assert!(!staged.contains("+{\"v\":3}"), "staged diff must not show worktree version");

        let working = diff(root, "a.bonk.json").unwrap();
        assert!(working.contains("+{\"v\":3}"), "working diff should show worktree version");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn graph_returns_real_git_graph_lines() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();

        let lines = graph(root, 10).unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("init"));
        assert!(lines[0].starts_with('*'));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_expands_untracked_dir_to_files() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/x.bonk.json"), "{\"v\":1}\n").unwrap();
        fs::write(dir.join("sub/y.bonk.json"), "{\"v\":2}\n").unwrap();

        let st = status(root).unwrap();
        // Each file listed individually, not collapsed to a "sub/" entry.
        assert!(st.files.iter().any(|f| f.path == "sub/x.bonk.json"));
        assert!(st.files.iter().any(|f| f.path == "sub/y.bonk.json"));
        assert!(!st.files.iter().any(|f| f.path == "sub/" || f.path == "sub"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diff_untracked_shows_contents() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("new.bonk.json"), "{\"hello\":\"world\"}\n").unwrap();
        // Untracked file: plain diff is empty, so diff() falls back to --no-index.
        let d = diff(root, "new.bonk.json").unwrap();
        assert!(d.contains("+{\"hello\":\"world\"}"), "should show file body as additions: {d}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_diffs_covers_tracked_staged_untracked() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // Committed, then modified in the working tree (tracked, unstaged).
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":2}\n").unwrap();
        // Staged-only new file.
        fs::write(dir.join("staged.bonk.json"), "{\"s\":1}\n").unwrap();
        stage(root, &["staged.bonk.json".to_string()]).unwrap();
        // Untracked file.
        fs::write(dir.join("untracked.bonk.json"), "{\"u\":1}\n").unwrap();

        let diffs = status_diffs(root).unwrap();
        let by = |p: &str| diffs.iter().find(|d| d.path == p).expect(p);

        let t = by("tracked.bonk.json");
        assert!(!t.staged && !t.untracked, "modified tracked = unstaged working diff");
        assert!(t.diff.contains("+{\"v\":2}") && t.diff.contains("-{\"v\":1}"));

        let s = by("staged.bonk.json");
        assert!(s.staged && !s.untracked, "staged-only file = staged diff");
        assert!(s.diff.contains("+{\"s\":1}"));

        let u = by("untracked.bonk.json");
        assert!(u.untracked, "new file = untracked");
        assert!(u.diff.contains("+{\"u\":1}"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn discard_reverts_tracked_and_deletes_new() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();

        // Modify a tracked file, add an untracked one, stage a brand-new one.
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":999}\n").unwrap();
        fs::write(dir.join("untracked.bonk.json"), "{}").unwrap();
        fs::write(dir.join("added.bonk.json"), "{}").unwrap();
        stage(root, &["added.bonk.json".to_string()]).unwrap();

        discard(
            root,
            &[
                "tracked.bonk.json".to_string(),
                "untracked.bonk.json".to_string(),
                "added.bonk.json".to_string(),
            ],
        )
        .unwrap();

        // Tracked file is back to its committed contents.
        let content = fs::read_to_string(dir.join("tracked.bonk.json")).unwrap();
        assert_eq!(content, "{\"v\":1}\n");
        // Untracked + staged-new files are gone.
        assert!(!dir.join("untracked.bonk.json").exists());
        assert!(!dir.join("added.bonk.json").exists());
        // Working tree is clean.
        let st = status(root).unwrap();
        assert!(st.files.is_empty(), "status should be clean: {:?}", st.files);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn discard_reverts_staged_rename_to_head() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // Commit a file, then rename it (git mv stages the rename).
        fs::write(dir.join("old.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();
        git(root, &["mv", "old.bonk.json", "new.bonk.json"]).unwrap();

        // Discard the rename via the new (index) path.
        discard(root, &["new.bonk.json".to_string()]).unwrap();

        // Original file is back with its committed contents; new path is gone.
        assert!(dir.join("old.bonk.json").exists(), "original path should be restored");
        let content = fs::read_to_string(dir.join("old.bonk.json")).unwrap();
        assert_eq!(content, "{\"v\":1}\n");
        assert!(!dir.join("new.bonk.json").exists(), "renamed path should be gone");
        // Working tree (and index) fully clean — no dangling delete-side.
        let st = status(root).unwrap();
        assert!(st.files.is_empty(), "status should be clean: {:?}", st.files);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unstage_moves_file_out_of_index() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        stage(root, &["a.bonk.json".to_string()]).unwrap();
        unstage(root, &["a.bonk.json".to_string()]).unwrap();
        let st = status(root).unwrap();
        let f = st.files.iter().find(|f| f.path == "a.bonk.json").unwrap();
        // Back to untracked after unstaging a never-committed file.
        assert_eq!(f.index, "?");
        assert_eq!(f.worktree, "?");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_prefix_empty_when_workspace_is_toplevel() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        let st = status(root).unwrap();
        // Workspace == toplevel: no prefix, paths are bare.
        assert_eq!(st.prefix, "");
        assert!(st.files.iter().any(|f| f.path == "a.bonk.json"));
        let _ = fs::remove_dir_all(dir);
    }

    /// Workspace is a SUBDIR of the repo: status must report the right `prefix`
    /// and toplevel-relative paths, and stage/discard/diff (which feed those
    /// paths back to git from the subdir `root`) must actually take effect.
    #[test]
    fn subdir_workspace_status_prefix_and_roundtrip() {
        let repo = init_repo();
        let repo_root = repo.to_str().unwrap();
        // Commit a baseline so HEAD exists and discard can revert to it.
        fs::create_dir_all(repo.join("collections")).unwrap();
        fs::write(repo.join("collections/a.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(repo_root, &[]).unwrap();
        commit(repo_root, "init").unwrap();

        // The workspace the app opens is the subdir, not the repo root.
        let ws = repo.join("collections");
        let ws_root = ws.to_str().unwrap();

        // Modify the file via the workspace path.
        fs::write(ws.join("a.bonk.json"), "{\"v\":2}\n").unwrap();

        let st = status(ws_root).unwrap();
        assert!(st.is_repo);
        // Prefix locates the workspace under the toplevel; paths are toplevel-relative.
        assert_eq!(st.prefix, "collections/");
        let f = st
            .files
            .iter()
            .find(|f| f.path == "collections/a.bonk.json")
            .expect("status path should be toplevel-relative");
        assert_eq!(f.worktree, "M");

        // Diff of the toplevel-relative path, run from the subdir root, must work.
        let d = diff(ws_root, "collections/a.bonk.json").unwrap();
        assert!(d.contains("+{\"v\":2}"), "diff should show the change: {d}");

        // Stage it (toplevel-relative path from the subdir root) → status shows staged.
        stage(ws_root, &["collections/a.bonk.json".to_string()]).unwrap();
        let st2 = status(ws_root).unwrap();
        let f2 = st2
            .files
            .iter()
            .find(|f| f.path == "collections/a.bonk.json")
            .expect("still listed after staging");
        assert_eq!(f2.index, "M", "should be staged");
        assert_eq!(f2.worktree, " ", "worktree clean after stage");

        // Discard reverts to HEAD across index + worktree → clean tree.
        discard(ws_root, &["collections/a.bonk.json".to_string()]).unwrap();
        let st3 = status(ws_root).unwrap();
        assert!(st3.files.is_empty(), "should be clean after discard: {:?}", st3.files);
        let content = fs::read_to_string(ws.join("a.bonk.json")).unwrap();
        assert_eq!(content, "{\"v\":1}\n", "file reverted to committed contents");
        let _ = fs::remove_dir_all(repo);
    }

    /// A file that is staged and then further modified (`MM`) must show BOTH the
    /// staged and the unstaged changes in the Project Diff — the full
    /// HEAD-vs-worktree delta — not just one side. Otherwise the staged hunk is
    /// hidden and `discard` would silently destroy it.
    #[test]
    fn status_diffs_mm_shows_combined_head_to_worktree() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // line1 committed; we add line2 (staged) and line3 (unstaged worktree).
        fs::write(dir.join("a.bonk.json"), "line1\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init").unwrap();

        // Stage the addition of line2.
        fs::write(dir.join("a.bonk.json"), "line1\nline2\n").unwrap();
        stage(root, &["a.bonk.json".to_string()]).unwrap();
        // Then add line3 in the worktree only → status is "MM".
        fs::write(dir.join("a.bonk.json"), "line1\nline2\nline3\n").unwrap();

        let st = status(root).unwrap();
        let f = st.files.iter().find(|f| f.path == "a.bonk.json").unwrap();
        assert_eq!(f.index, "M", "staged side");
        assert_eq!(f.worktree, "M", "worktree side");

        let diffs = status_diffs(root).unwrap();
        let e = diffs.iter().find(|d| d.path == "a.bonk.json").expect("entry");
        // Combined HEAD-vs-worktree: BOTH additions appear, not just one side.
        assert!(e.diff.contains("+line2"), "staged hunk must be visible: {}", e.diff);
        assert!(e.diff.contains("+line3"), "unstaged hunk must be visible: {}", e.diff);
        // Not fully staged (worktree is dirty) → UI offers "Stage", not "Unstage".
        assert!(!e.staged, "MM file is not fully staged");
        let _ = fs::remove_dir_all(dir);
    }
}
