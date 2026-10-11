//! Git source-control core for the "git-first" Bonk workspace.
//!
//! Every operation shells out to the SYSTEM `git` CLI via `git -C <root> ...`.
//! Driving the real binary (instead of a linked libgit2) means we inherit the
//! user's git config, SSH agent, and credential helper — so `push`/`pull` work
//! against their remotes exactly as on the command line.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long a network git op (`push`/`pull`) may run before we kill it. A
/// stalled remote (dropped connection, server hang) would otherwise block the
/// blocking-pool thread driving the IPC call indefinitely; this bounds it.
const NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

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
    /// In-progress operation stopped on conflicts: "" | "merge" | "rebase" |
    /// "cherry-pick" | "revert".
    pub operation: String,
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
    /// Committer date, unix seconds.
    pub time: i64,
}

/// One branch (local or remote-tracking) with its upstream position.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    /// Short name: `"main"` or `"origin/fix/x"`.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

/// One entry of `git stash list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStash {
    pub index: u32,
    pub hash: String,
    pub short: String,
    /// The user's message (for a WIP stash: `"<hash> <subject>"`).
    pub message: String,
    /// Branch the stash was made on, `""` if unknown.
    pub branch: String,
    pub time: i64,
}

/// One file inside a stash, with its full-file diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFile {
    pub path: String,
    /// `"A"` | `"M"` | `"D"` | `"R"`.
    pub status: String,
    pub diff: String,
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
                operation: String::new(),
            });
        }
    };
    let prefix = show_prefix(root);
    let operation = operation_at(&top);

    // `--untracked-files=all` expands a new directory into its individual files
    // instead of collapsing it to one `dir/` entry — so the panel shows every
    // file, not just the folder.
    let out = git(
        &top,
        &[
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=all",
            "-z",
        ],
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
        operation,
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
    let out = match git(
        top,
        &["status", "--porcelain=v1", "--untracked-files=no", "-z"],
    ) {
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
    if paths.is_empty() {
        return Ok(());
    }
    // `paths` are toplevel-relative, so resolve the toplevel and run/join there.
    let top = toplevel(root)?;
    let renames = staged_renames(&top);
    // Which paths HEAD has, in one `ls-tree` (the `--` keeps a path that starts
    // with `-` from being read as a flag; an unborn HEAD has none). A constant
    // number of git processes per discard, however many files: a fresh
    // collection of hundreds of untracked requests must not spawn one per file.
    // ponytail: all paths go on one command line; batch it if workspaces ever
    // reach tens of thousands of changed files (ARG_MAX).
    let mut args: Vec<&str> = vec!["ls-tree", "--name-only", "-z", "HEAD", "--"];
    args.extend(paths.iter().map(String::as_str));
    let in_head: HashSet<String> = git(&top, &args)
        .map(|out| {
            out.split('\0')
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    // Restored from HEAD: tracked files, and a staged rename's original path
    // (un-staging its delete side). Dropped: everything HEAD doesn't have,
    // including a staged rename's new path.
    let mut restore: Vec<&str> = Vec::new();
    let mut drop: Vec<&str> = Vec::new();
    for p in paths {
        if let Some(old) = renames.get(p) {
            restore.push(old);
            drop.push(p);
        } else if in_head.contains(p) {
            restore.push(p);
        } else {
            drop.push(p);
        }
    }
    if !restore.is_empty() {
        let mut args = vec!["restore", "--staged", "--worktree", "--source=HEAD", "--"];
        args.extend(&restore);
        git(&top, &args)?;
    }
    if !drop.is_empty() {
        // Drop from the index where staged (a no-op for untracked), then delete.
        let mut args = vec!["rm", "--cached", "-q", "--ignore-unmatch", "--"];
        args.extend(&drop);
        git(&top, &args)?;
        for p in drop {
            let _ = std::fs::remove_file(std::path::Path::new(&top).join(p));
        }
    }
    Ok(())
}

/// Commit the staged index with `message`; returns the new short hash. Surfaces
/// git's own error when nothing is staged or `user.name`/`user.email` is unset.
/// `amend` rewrites the last commit instead (works with nothing staged).
pub fn commit(root: &str, message: &str, amend: bool) -> Result<String, String> {
    if amend {
        git(root, &["commit", "--amend", "-m", message])?;
    } else {
        git(root, &["commit", "-m", message])?;
    }
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

/// All local and remote-tracking branches with upstream/ahead/behind. Locals
/// first (current one first), then remotes.
pub fn branch_list(root: &str) -> Result<Vec<GitBranch>, String> {
    let fmt = "--format=%(refname)\x1f%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)\x1f%(upstream:track,nobracket)";
    let out = git(root, &["for-each-ref", fmt, "refs/heads/", "refs/remotes/"])?;
    let mut locals = Vec::new();
    let mut remotes = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\x1f').collect();
        if f.len() < 5 {
            continue;
        }
        let remote = f[0].starts_with("refs/remotes/");
        // `origin/HEAD` is a symbolic alias, not a branch.
        if remote && f[0].ends_with("/HEAD") {
            continue;
        }
        let (mut ahead, mut behind) = (0, 0);
        for part in f[4].split(',') {
            let part = part.trim();
            if let Some(n) = part.strip_prefix("ahead ") {
                ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                behind = n.parse().unwrap_or(0);
            }
        }
        let b = GitBranch {
            name: f[1].to_string(),
            remote,
            current: f[2] == "*",
            upstream: (!f[3].is_empty()).then(|| f[3].to_string()),
            ahead,
            behind,
        };
        if remote {
            remotes.push(b);
        } else {
            locals.push(b);
        }
    }
    locals.sort_by_key(|b| !b.current);
    locals.extend(remotes);
    Ok(locals)
}

/// Create a local tracking branch from a remote one (`origin/fix/x`) and switch
/// to it.
pub fn checkout_remote(root: &str, name: &str) -> Result<(), String> {
    if name.starts_with('-') {
        return Err(format!("invalid branch name: {name}"));
    }
    git(root, &["switch", "--track", "--end-of-options", name])?;
    Ok(())
}

/// Create and switch to a new branch. The name is the value of `-c`, so git
/// consumes it literally (a leading `-` is taken as the branch name, not a flag).
pub fn create_branch(root: &str, name: &str) -> Result<(), String> {
    git(root, &["switch", "-c", name])?;
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
/// block forever, so we make missing credentials fail fast with a clear error
/// the UI can show instead of hanging.
///
/// Even with prompts disabled a remote can stall mid-transfer (dropped TCP
/// connection, hung server), so we cap the whole run at [`NETWORK_TIMEOUT`]:
/// the child is spawned, its pipes are drained on threads (so a large transfer
/// can't deadlock on a full pipe buffer), and we poll for exit until the
/// deadline — killing the child and returning a timeout error if it's exceeded.
fn run_combined(root: &str, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;

    // Drain both pipes on their own threads. If we polled the child for exit
    // while leaving the pipes unread, a transfer big enough to fill a pipe
    // buffer would block git forever and our timeout would always fire. Generic
    // over the reader so it serves both the (distinct) stdout/stderr pipe types.
    fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    }
    let stdout_handle = drain(child.stdout.take());
    let stderr_handle = drain(child.stderr.take());

    // Poll for exit until the deadline. try_wait() is non-blocking, so a stalled
    // remote can't pin this thread past NETWORK_TIMEOUT.
    let deadline = Instant::now() + NETWORK_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_handle.join();
                    let _ = stderr_handle.join();
                    return Err(format!(
                        "git {} timed out after {}s",
                        args.join(" "),
                        NETWORK_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed to run git: {e}"));
            }
        }
    };

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout);
    let stderr = String::from_utf8_lossy(&stderr);
    let combined = format!("{stdout}{stderr}").trim().to_string();
    if status.success() {
        Ok(combined)
    } else if combined.is_empty() {
        Err(format!("git {} failed", args.join(" ")))
    } else {
        Err(combined)
    }
}

// ponytail: -U100000 ships the whole file to the UI; fine because request
// files are small JSON. Revisit if big files ever go through here.
const FULL: &str = "--unified=100000";

/// Full-file diff of `path` against HEAD (staged or not), so the UI can render
/// the whole file with line numbers. An untracked file shows as all additions.
///
/// `path` is toplevel-relative (what [`status`] emits), so we resolve and run
/// against the toplevel — see [`toplevel`].
pub fn diff(root: &str, path: &str) -> Result<String, String> {
    let top = toplevel(root)?;
    if git(&top, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() {
        return diff_working_at(&top, path, &[FULL]);
    }
    let tracked = git(&top, &["ls-files", "--error-unmatch", "--", path]).is_ok();
    if !tracked && std::path::Path::new(&top).join(path).exists() {
        return diff_untracked_at(&top, path);
    }
    git(&top, &["diff", FULL, "HEAD", "--", path])
}

/// Staged (index-vs-HEAD) full-file diff for `path`. `path` is toplevel-relative.
pub fn diff_staged(root: &str, path: &str) -> Result<String, String> {
    let top = toplevel(root)?;
    git(&top, &["diff", "--cached", FULL, "--", path])
}

/// Unstaged diff, else staged diff, else the untracked file; `extra` flags go
/// right after `diff`.
fn diff_working_at(top: &str, path: &str, extra: &[&str]) -> Result<String, String> {
    let run = |cached: bool| {
        let mut args = vec!["diff"];
        args.extend_from_slice(extra);
        if cached {
            args.push("--cached");
        }
        args.extend(["--", path]);
        git(top, &args)
    };
    let unstaged = run(false)?;
    if !unstaged.trim().is_empty() {
        return Ok(unstaged);
    }
    let staged = run(true)?;
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
        return diff_working_at(top, path, &[]);
    }
    git(top, &["diff", "HEAD", "--", path])
}

/// Diff an untracked file as one addition of its whole contents (a binary
/// file gets git's one-line "Binary files … differ").
fn diff_untracked_at(top: &str, path: &str) -> Result<String, String> {
    // Built here rather than by `git diff --no-index`: the Project Diff asks for
    // every untracked file, and a process per file made hundreds of them slow.
    let bytes =
        std::fs::read(std::path::Path::new(top).join(path)).map_err(|e| format!("{path}: {e}"))?;
    let mut out = format!("diff --git a/{path} b/{path}\nnew file mode 100644\n");
    if bytes.contains(&0) {
        out.push_str(&format!("Binary files /dev/null and b/{path} differ\n"));
        return Ok(out);
    }
    let text = String::from_utf8_lossy(&bytes);
    if text.is_empty() {
        return Ok(out);
    }
    let lines: Vec<&str> = text.lines().collect();
    out.push_str(&format!(
        "--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{} @@\n",
        lines.len()
    ));
    for line in lines {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    if !text.ends_with('\n') {
        out.push_str("\\ No newline at end of file\n");
    }
    Ok(out)
}

/// Split a multi-file diff into one text per `diff --git` section.
fn split_diff_sections(out: &str) -> Vec<String> {
    // Split on the per-file "diff --git" marker. The very first section keeps its
    // leading "diff --git " (split removed it only for subsequent ones);
    // normalise so every section text is uniform.
    let mut sections = Vec::new();
    let mut first = true;
    for raw in out.split("\ndiff --git ") {
        if first {
            first = false;
            // Drop anything before the first header (there shouldn't be any).
            if let Some(idx) = raw.find("diff --git ") {
                sections.push(raw[idx..].to_string());
            }
        } else {
            sections.push(format!("diff --git {raw}"));
        }
    }
    sections
}

/// Every path a diff section names (`b/`/`a/` sides plus rename from/to).
fn section_paths(section: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in section.lines() {
        if let Some(p) = line.strip_prefix("+++ b/") {
            paths.push(p.to_string());
        } else if let Some(p) = line.strip_prefix("--- a/") {
            paths.push(p.to_string());
        } else if let Some(p) = line.strip_prefix("rename to ") {
            paths.push(p.to_string());
        } else if let Some(p) = line.strip_prefix("rename from ") {
            paths.push(p.to_string());
        }
    }
    paths
}

/// The file a section is about: the `+++ b/` path, or `--- a/` for deletions.
fn section_main_path(section: &str) -> Option<String> {
    let find = |prefix: &str| section.lines().find_map(|l| l.strip_prefix(prefix));
    find("+++ b/")
        .or_else(|| find("--- a/"))
        .or_else(|| find("rename to "))
        .map(str::to_string)
}

/// All tracked HEAD-vs-worktree diffs in ONE `git diff HEAD`, split into a
/// `path → patch` map so [`status_diffs`] doesn't spawn a git process per file.
///
/// Returns `None` on an unborn branch (no HEAD to diff against), so the caller
/// falls back to the per-file probe that handles a fresh repo. `core.quotepath`
/// is forced off so non-ASCII paths in the `+++`/`---` headers stay literal and
/// match the (already-literal) paths git status emits.
///
/// Each `diff --git` section is keyed by every path it names — the `b/` (new)
/// and `a/` (old) sides from the `+++`/`---` headers plus any `rename to`/`rename
/// from` — so a lookup by a status path resolves whether the file was added,
/// modified, deleted, or renamed.
fn all_head_diffs(top: &str) -> Result<Option<HashMap<String, String>>, String> {
    if git(top, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() {
        return Ok(None);
    }
    let out = git(top, &["-c", "core.quotepath=false", "diff", "HEAD"])?;

    let mut map: HashMap<String, String> = HashMap::new();
    for section in split_diff_sections(&out) {
        let paths = section_paths(&section);
        let text = section.trim_end_matches('\n').to_string();
        for p in paths {
            map.entry(p).or_insert_with(|| text.clone());
        }
    }
    Ok(Some(map))
}

/// Diff for every changed file, for the aggregate Project Diff view.
///
/// One entry per status file. Untracked files show their whole contents as an
/// addition. Every tracked file shows the **combined HEAD-vs-worktree** diff,
/// so a file that is both staged and further modified (`MM`) reveals all of its
/// changes — not just one side — and [`discard`] (which reverts to HEAD)
/// exactly undoes what's shown. The `staged` flag is set only when the file is
/// fully staged with a clean worktree, so the UI button reads "Unstage" only
/// then and otherwise "Stage" (to stage the remaining worktree changes).
///
/// All tracked diffs come from a single `git diff HEAD` (see [`all_head_diffs`])
/// instead of one process per file. A tracked file absent from that map (e.g. an
/// unborn branch, or a corner the parser doesn't key) falls back to the per-file
/// probe so its diff is never silently dropped.
pub fn status_diffs(root: &str) -> Result<Vec<FileDiff>, String> {
    let st = status(root)?;
    let top = toplevel(root)?;
    let head_diffs = all_head_diffs(&top)?;
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
            let diff = match head_diffs.as_ref().and_then(|m| m.get(&f.path)) {
                Some(d) => d.clone(),
                // Not in the batch (unborn branch / unkeyed corner) → per-file.
                None => diff_head_at(&top, &f.path)?,
            };
            (fully_staged, diff)
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
    let fmt = "--pretty=format:%H\x1f%h\x1f%s\x1f%an\x1f%ad\x1f%ct";
    let out = match git(root, &["log", "-n", &n, fmt, "--date=short"]) {
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
        let time = parts.next().and_then(|t| t.parse().ok()).unwrap_or(0);
        commits.push(GitCommit {
            hash,
            short,
            subject,
            author,
            date,
            time,
        });
    }
    Ok(commits)
}

fn stash_ref(index: u32) -> String {
    format!("stash@{{{index}}}")
}

/// `git stash list`, newest first. No stashes / no commits yields an empty vec.
pub fn stash_list(root: &str) -> Result<Vec<GitStash>, String> {
    let top = toplevel(root)?;
    let out = git(
        &top,
        &["stash", "list", "--format=%gd\x1f%H\x1f%h\x1f%gs\x1f%ct"],
    )?;
    let mut stashes = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\x1f').collect();
        if f.len() < 5 {
            continue;
        }
        let Some(index) = f[0]
            .strip_prefix("stash@{")
            .and_then(|r| r.strip_suffix('}'))
            .and_then(|n| n.parse().ok())
        else {
            continue;
        };
        // `%gs` is "On <branch>: <msg>" or "WIP on <branch>: <hash> <subject>".
        let subject = f[3];
        let on = subject
            .strip_prefix("On ")
            .or_else(|| subject.strip_prefix("WIP on "));
        let (branch, message) = match on.and_then(|r| r.split_once(": ")) {
            Some((b, m)) => (b.to_string(), m.to_string()),
            None => (String::new(), subject.to_string()),
        };
        stashes.push(GitStash {
            index,
            hash: f[1].to_string(),
            short: f[2].to_string(),
            message,
            branch,
            time: f[4].parse().unwrap_or(0),
        });
    }
    Ok(stashes)
}

/// `git stash push` with the usual switches; an empty `message` uses git's default.
pub fn stash_push(
    root: &str,
    message: &str,
    include_untracked: bool,
    staged_only: bool,
    keep_index: bool,
) -> Result<(), String> {
    let top = toplevel(root)?;
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("-u");
    }
    if staged_only {
        args.push("--staged");
    }
    if keep_index {
        args.push("--keep-index");
    }
    if !message.is_empty() {
        args.extend(["-m", message]);
    }
    git(&top, &args)?;
    Ok(())
}

pub fn stash_apply(root: &str, index: u32) -> Result<(), String> {
    let top = toplevel(root)?;
    git(&top, &["stash", "apply", &stash_ref(index)])?;
    Ok(())
}

pub fn stash_pop(root: &str, index: u32) -> Result<(), String> {
    let top = toplevel(root)?;
    git(&top, &["stash", "pop", &stash_ref(index)])?;
    Ok(())
}

pub fn stash_drop(root: &str, index: u32) -> Result<(), String> {
    let top = toplevel(root)?;
    git(&top, &["stash", "drop", &stash_ref(index)])?;
    Ok(())
}

/// Create a branch from a stash's base commit, apply the stash and drop it.
pub fn stash_branch(root: &str, name: &str, index: u32) -> Result<(), String> {
    if name.starts_with('-') {
        return Err(format!("invalid branch name: {name}"));
    }
    let top = toplevel(root)?;
    git(&top, &["stash", "branch", name, &stash_ref(index)])?;
    Ok(())
}

/// Files in a stash (untracked ones included) with full-file diffs.
pub fn stash_show(root: &str, index: u32) -> Result<Vec<StashFile>, String> {
    let top = toplevel(root)?;
    let r = stash_ref(index);
    let base = ["-c", "core.quotepath=false", "stash", "show", "-p", FULL];
    let run = |extra: &[&str]| {
        let mut args = base.to_vec();
        args.extend_from_slice(extra);
        args.push(&r);
        git(&top, &args)
    };
    // Old git rejects --include-untracked here; retry without it.
    let out = run(&["--include-untracked"]).or_else(|_| run(&[]))?;
    let mut files = Vec::new();
    for section in split_diff_sections(&out) {
        let Some(path) = section_main_path(&section) else {
            continue;
        };
        let status = if section.contains("\nnew file mode") {
            "A"
        } else if section.contains("\ndeleted file mode") {
            "D"
        } else if section.contains("\nrename from ") {
            "R"
        } else {
            "M"
        };
        files.push(StashFile {
            path,
            status: status.to_string(),
            diff: section.trim_end_matches('\n').to_string(),
        });
    }
    Ok(files)
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

// ---- graph, commit detail, history actions --------------------------------

/// A ref pointing at a commit. `kind`: "head" | "branch" | "remote" | "tag".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    pub name: String,
    pub kind: String,
}

/// One commit in the graph view.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub short: String,
    /// Full parent hashes.
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Author time, unix seconds.
    pub time: i64,
    pub subject: String,
    pub refs: Vec<GitRef>,
}

/// A page of the graph plus the totals the UI needs for paging and the header.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    pub commits: Vec<GraphCommit>,
    pub total: u32,
    pub branches: u32,
}

/// One file changed by a commit (against its first parent).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    /// Toplevel-relative; the new path for a rename.
    pub path: String,
    /// "A" | "M" | "D" | "R"
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
    pub body: String,
    /// Short names of local + remote branches that contain the commit.
    pub branches: Vec<String>,
    pub files: Vec<CommitFile>,
}

/// Hashes come from the UI: only 4..40 hex chars may reach git's argv.
fn check_hash(h: &str) -> Result<(), String> {
    if (4..=40).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(format!("invalid commit hash: {h}"))
    }
}

fn check_hashes(hashes: &[String]) -> Result<(), String> {
    if hashes.is_empty() {
        return Err("no commits given".to_string());
    }
    hashes.iter().try_for_each(|h| check_hash(h))
}

/// Branch/tag names must not be empty or look like a flag.
fn check_name(n: &str) -> Result<(), String> {
    if n.is_empty() || n.starts_with('-') {
        Err(format!("invalid name: {n:?}"))
    } else {
        Ok(())
    }
}

/// Parse `%D` (with `--decorate=full`) into refs.
fn parse_refs(decor: &str) -> Vec<GitRef> {
    let mut out = Vec::new();
    for part in decor.split(", ").map(str::trim).filter(|p| !p.is_empty()) {
        let (name, kind) = if let Some(b) = part.strip_prefix("HEAD -> refs/heads/") {
            (b, "head")
        } else if part == "HEAD" {
            ("HEAD", "head")
        } else if let Some(t) = part.strip_prefix("tag: refs/tags/") {
            (t, "tag")
        } else if let Some(b) = part.strip_prefix("refs/heads/") {
            (b, "branch")
        } else if let Some(r) = part.strip_prefix("refs/remotes/") {
            if r.ends_with("/HEAD") {
                continue;
            }
            (r, "remote")
        } else {
            continue;
        };
        out.push(GitRef {
            name: name.to_string(),
            kind: kind.to_string(),
        });
    }
    out
}

/// One page of history for the graph: 3 git processes regardless of size.
pub fn graph_log(root: &str, all: bool, skip: u32, limit: u32) -> Result<GraphPage, String> {
    let top = toplevel(root)?;
    let range = if all { "--all" } else { "HEAD" };
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("-n{limit}");
    let out = match git(
        &top,
        &[
            "log",
            "--topo-order",
            "--decorate=full",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e",
            &skip_arg,
            &limit_arg,
            range,
        ],
    ) {
        Ok(o) => o,
        // Unborn branch: `log HEAD` fails, that is an empty history, not an error.
        Err(e) => {
            if git(&top, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() && !all {
                return Ok(GraphPage {
                    commits: vec![],
                    total: 0,
                    branches: 0,
                });
            }
            return Err(e);
        }
    };

    let mut commits = Vec::new();
    for rec in out.split('\x1e') {
        let rec = rec.trim_start_matches('\n');
        let f: Vec<&str> = rec.split('\x1f').collect();
        if f.len() < 7 {
            continue;
        }
        commits.push(GraphCommit {
            hash: f[0].to_string(),
            short: f[0].chars().take(7).collect(),
            parents: f[1].split_whitespace().map(str::to_string).collect(),
            author: f[2].to_string(),
            email: f[3].to_string(),
            time: f[4].parse().unwrap_or(0),
            subject: f[5].to_string(),
            refs: parse_refs(f[6]),
        });
    }

    let total = git(&top, &["rev-list", "--count", range])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let branches = git(&top, &["for-each-ref", "--format=x", "refs/heads/"])
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0);
    Ok(GraphPage {
        commits,
        total,
        branches,
    })
}

/// Diff-tree args that compare `hash` with its first parent (or the empty tree).
fn diff_tree_args<'a>(parent: Option<&'a str>, hash: &'a str, flags: &[&'a str]) -> Vec<&'a str> {
    let mut a = vec!["diff-tree", "-r", "-M", "-z"];
    a.extend_from_slice(flags);
    match parent {
        Some(p) => a.extend([p, hash]),
        None => a.extend(["--root", hash]),
    }
    a
}

/// Metadata, changed files (vs first parent) and containing branches: 4 processes.
pub fn commit_detail(root: &str, hash: &str) -> Result<CommitDetail, String> {
    check_hash(hash)?;
    let top = toplevel(root)?;
    let meta = git(
        &top,
        &[
            "show",
            "-s",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b",
            hash,
        ],
    )?;
    let f: Vec<&str> = meta.splitn(7, '\x1f').collect();
    if f.len() < 7 {
        return Err("unexpected git output".to_string());
    }
    let full = f[0].to_string();
    let parents: Vec<String> = f[1].split_whitespace().map(str::to_string).collect();
    let first_parent = parents.first().map(String::as_str);

    // name-status gives the letter, numstat the counts; both list files in the
    // same order, joined here by (new) path.
    let ns = git(
        &top,
        &diff_tree_args(first_parent, &full, &["--name-status"]),
    )?;
    let nu = git(&top, &diff_tree_args(first_parent, &full, &["--numstat"]))?;

    let mut counts: HashMap<String, (u32, u32)> = HashMap::new();
    let mut recs = nu.split('\0').filter(|r| !r.is_empty());
    // With `--root`/a single tree git prints a leading hash line; skip non-numstat records.
    while let Some(rec) = recs.next() {
        let mut p = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (p.next(), p.next(), p.next()) else {
            continue;
        };
        let path = if path.is_empty() {
            // Rename: the next two records are old, new.
            recs.next();
            recs.next().unwrap_or("")
        } else {
            path
        };
        counts.insert(
            path.to_string(),
            (a.parse().unwrap_or(0), d.parse().unwrap_or(0)),
        );
    }

    let mut files = Vec::new();
    let mut recs = ns.split('\0').filter(|r| !r.is_empty());
    while let Some(st) = recs.next() {
        // `--root` prefixes the commit hash as its own record.
        if st.len() > 3 && st.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let Some(first) = st.chars().next() else {
            continue;
        };
        let mut path = recs.next().unwrap_or("");
        if first == 'R' || first == 'C' {
            path = recs.next().unwrap_or(path);
        }
        let status = match first {
            'A' | 'C' => "A",
            'D' => "D",
            'R' => "R",
            _ => "M",
        };
        let (additions, deletions) = counts.get(path).copied().unwrap_or((0, 0));
        files.push(CommitFile {
            path: path.to_string(),
            status: status.to_string(),
            additions,
            deletions,
        });
    }

    let refs = git(
        &top,
        &[
            "for-each-ref",
            "--contains",
            &full,
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let branches = refs
        .lines()
        .filter_map(|r| {
            r.strip_prefix("refs/heads/")
                .or_else(|| r.strip_prefix("refs/remotes/"))
        })
        .filter(|n| *n != "HEAD" && !n.ends_with("/HEAD"))
        .map(str::to_string)
        .collect();

    Ok(CommitDetail {
        short: full.chars().take(7).collect(),
        hash: full,
        parents,
        author: f[2].to_string(),
        email: f[3].to_string(),
        time: f[4].parse().unwrap_or(0),
        subject: f[5].to_string(),
        body: f[6].trim().to_string(),
        branches,
        files,
    })
}

/// Full-file diff of `path` in commit `hash` against its first parent (root
/// commit: against nothing). `-m --first-parent` makes merges diff vs parent 1.
pub fn commit_file_diff(root: &str, hash: &str, path: &str) -> Result<String, String> {
    check_hash(hash)?;
    let top = toplevel(root)?;
    git(
        &top,
        &[
            "show",
            "--format=",
            "-m",
            "--first-parent",
            FULL,
            hash,
            "--",
            path,
        ],
    )
}

/// Run `git -c core.editor=true <args>` at the toplevel so git never waits for
/// an editor (a GUI has no terminal to give it).
fn git_noedit(root: &str, args: &[&str]) -> Result<(), String> {
    let top = toplevel(root)?;
    let mut a = vec!["-c", "core.editor=true"];
    a.extend_from_slice(args);
    git(&top, &a).map(|_| ())
}

/// `git <cmd> [flags] <hashes...>` in the given order.
fn git_hashes(root: &str, cmd: &str, flags: &[&str], hashes: &[String]) -> Result<(), String> {
    check_hashes(hashes)?;
    let mut a = vec![cmd];
    a.extend_from_slice(flags);
    a.extend(hashes.iter().map(String::as_str));
    git_noedit(root, &a)
}

/// Apply commits onto HEAD, in the given order (oldest first).
pub fn cherry_pick(root: &str, hashes: &[String]) -> Result<(), String> {
    git_hashes(root, "cherry-pick", &[], hashes)
}

/// Revert commits, in the given order (newest first).
pub fn revert(root: &str, hashes: &[String]) -> Result<(), String> {
    git_hashes(root, "revert", &["--no-edit"], hashes)
}

pub fn merge(root: &str, branch: &str) -> Result<(), String> {
    check_name(branch)?;
    git_noedit(root, &["merge", "--autostash", "--no-edit", branch])
}

pub fn rebase(root: &str, onto: &str) -> Result<(), String> {
    check_name(onto)?;
    git_noedit(root, &["rebase", "--autostash", onto])
}

pub fn checkout_detached(root: &str, hash: &str) -> Result<(), String> {
    check_hash(hash)?;
    git_noedit(root, &["switch", "--detach", hash])
}

pub fn reset(root: &str, hash: &str, mode: &str) -> Result<(), String> {
    check_hash(hash)?;
    let flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(format!("invalid reset mode: {mode}")),
    };
    git_noedit(root, &["reset", flag, hash])
}

pub fn create_tag(root: &str, name: &str, hash: &str) -> Result<(), String> {
    check_name(name)?;
    check_hash(hash)?;
    git_noedit(root, &["tag", name, hash])
}

pub fn create_branch_at(root: &str, name: &str, hash: &str) -> Result<(), String> {
    check_name(name)?;
    check_hash(hash)?;
    git_noedit(root, &["switch", "-c", name, hash])
}

/// mbox text for the commits, in the given order (one process).
pub fn format_patch(root: &str, hashes: &[String]) -> Result<String, String> {
    check_hashes(hashes)?;
    let top = toplevel(root)?;
    let mut a = vec!["format-patch", "--stdout", "--no-walk=unsorted"];
    // format-patch emits its walk list reversed, so feed it reversed to get
    // the caller's order back.
    a.extend(hashes.iter().rev().map(String::as_str));
    git(&top, &a)
}

/// `fetch --all --prune`, with the network timeout.
pub fn fetch(root: &str) -> Result<String, String> {
    let top = toplevel(root)?;
    run_combined(&top, &["fetch", "--all", "--prune"])
}

/// Which operation is stopped mid-way ("" when none), from marker files in the
/// git dir.
fn operation_at(top: &str) -> String {
    match git(top, &["rev-parse", "--absolute-git-dir"]) {
        Ok(dir) => operation_in(std::path::Path::new(dir.trim())),
        Err(_) => String::new(),
    }
}

fn operation_in(dir: &std::path::Path) -> String {
    let has = |n: &str| dir.join(n).exists();
    let op = if has("rebase-merge") || has("rebase-apply") {
        "rebase"
    } else if has("MERGE_HEAD") {
        "merge"
    } else if has("CHERRY_PICK_HEAD") {
        "cherry-pick"
    } else if has("REVERT_HEAD") {
        "revert"
    } else {
        ""
    };
    op.to_string()
}

fn current_operation(root: &str) -> Result<(String, String), String> {
    let top = toplevel(root)?;
    let op = operation_at(&top);
    if op.is_empty() {
        Err("no operation in progress".to_string())
    } else {
        Ok((top, op))
    }
}

pub fn operation_abort(root: &str) -> Result<(), String> {
    let (top, op) = current_operation(root)?;
    git_noedit(&top, &[&op, "--abort"])
}

pub fn operation_continue(root: &str) -> Result<(), String> {
    let (top, op) = current_operation(root)?;
    if op == "merge" {
        git_noedit(&top, &["commit", "--no-edit"])
    } else {
        git_noedit(&top, &[&op, "--continue"])
    }
}

/// One conflicted file: the text of each side (lossy UTF-8). `None` means that
/// side has no version (deleted, or added only on the other side).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub base: Option<String>,
    pub mine: Option<String>,
    pub theirs: Option<String>,
}

/// The stopped operation, for the conflict screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationInfo {
    /// "" | "merge" | "rebase" | "cherry-pick" | "revert".
    pub kind: String,
    /// 1-based position in a multi-commit operation, 0 when unknown.
    pub step: u32,
    pub total: u32,
    /// The commit being applied ("" if unknown) and its subject.
    pub hash: String,
    pub subject: String,
    /// Labels for the two sides.
    pub mine: String,
    pub theirs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub hash: String,
    pub short: String,
    pub subject: String,
    /// Reachable from some remote-tracking branch.
    pub pushed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    pub onto: String,
    pub onto_short: String,
    pub onto_subject: String,
    /// Oldest first, merge commits excluded.
    pub commits: Vec<RebaseStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseAction {
    pub hash: String,
    /// pick | reword | squash | fixup | drop
    pub action: String,
    /// New message, reword only.
    pub message: Option<String>,
}

/// Index stage holding the UI's "mine" / "theirs" side. In a rebase git
/// replays our commits onto upstream, so the roles swap: stage 2 (`--ours`) is
/// the upstream, stage 3 (`--theirs`) is the user's own commit.
fn side_stage(op: &str, side: &str) -> Result<u8, String> {
    let rebase = op == "rebase";
    match (side, rebase) {
        ("mine", false) | ("theirs", true) => Ok(2),
        ("theirs", false) | ("mine", true) => Ok(3),
        _ => Err(format!("invalid side: {side}")),
    }
}

/// Unmerged index entries as (path, stage, blob), from one `ls-files -u -z`.
fn unmerged(top: &str) -> Result<Vec<(String, u8, String)>, String> {
    let out = git(top, &["ls-files", "-u", "-z"])?;
    let mut v = Vec::new();
    for rec in out.split('\0').filter(|r| !r.is_empty()) {
        // "<mode> <blob> <stage>\t<path>"
        let (meta, path) = rec.split_once('\t').ok_or("bad ls-files output")?;
        let mut it = meta.split(' ');
        let (_mode, blob, stage) = (it.next(), it.next(), it.next());
        let (Some(blob), Some(stage)) = (blob, stage.and_then(|s| s.parse::<u8>().ok())) else {
            return Err("bad ls-files output".to_string());
        };
        v.push((path.to_string(), stage, blob.to_string()));
    }
    Ok(v)
}

/// Contents of blobs by id through ONE `git cat-file --batch` process.
fn read_blobs(top: &str, ids: &[&str]) -> Result<HashMap<String, String>, String> {
    use std::io::Write;
    let mut child = Command::new("git")
        .arg("-C")
        .arg(top)
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let input: String = ids.iter().map(|i| format!("{i}\n")).collect();
    // Write on a thread: a big reply could fill the stdout pipe while we are
    // still writing, which would deadlock a single-threaded write-then-read.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let mut out = Vec::new();
    if let Some(mut so) = child.stdout.take() {
        let _ = so.read_to_end(&mut out);
    }
    let _ = writer.join();
    let _ = child.wait();

    // Records: "<oid> <type> <size>\n<content>\n" (or "<oid> missing\n").
    let mut map = HashMap::new();
    let mut pos = 0;
    while pos < out.len() {
        let nl = out[pos..]
            .iter()
            .position(|&b| b == b'\n')
            .ok_or("bad cat-file output")?;
        let header = String::from_utf8_lossy(&out[pos..pos + nl]).into_owned();
        pos += nl + 1;
        let mut it = header.split(' ');
        let (Some(oid), Some(kind)) = (it.next(), it.next()) else {
            return Err("bad cat-file output".to_string());
        };
        if kind == "missing" {
            continue;
        }
        let size: usize = it
            .next()
            .and_then(|s| s.parse().ok())
            .ok_or("bad cat-file output")?;
        let end = pos + size;
        if end > out.len() {
            return Err("truncated cat-file output".to_string());
        }
        map.insert(
            oid.to_string(),
            String::from_utf8_lossy(&out[pos..end]).into_owned(),
        );
        pos = end + 1;
    }
    Ok(map)
}

/// Conflicted files with base/mine/theirs texts: two processes after
/// `toplevel`, however many files.
pub fn conflicts(root: &str) -> Result<Vec<ConflictFile>, String> {
    let top = toplevel(root)?;
    let op = operation_at(&top);
    // "mine" falls back to stage 2 outside an operation (plain unmerged index).
    let (mine_st, theirs_st) = (side_stage(&op, "mine")?, side_stage(&op, "theirs")?);
    let entries = unmerged(&top)?;
    let mut ids: Vec<&str> = entries.iter().map(|e| e.2.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    let blobs = if ids.is_empty() {
        HashMap::new()
    } else {
        read_blobs(&top, &ids)?
    };
    let mut files: std::collections::BTreeMap<&str, ConflictFile> = Default::default();
    for (path, stage, blob) in &entries {
        let f = files.entry(path).or_insert_with(|| ConflictFile {
            path: path.clone(),
            base: None,
            mine: None,
            theirs: None,
        });
        let text = blobs.get(blob).cloned();
        if *stage == 1 {
            f.base = text;
        } else if *stage == mine_st {
            f.mine = text;
        } else if *stage == theirs_st {
            f.theirs = text;
        }
    }
    Ok(files.into_values().collect())
}

fn read_trim(path: std::path::PathBuf) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `<short hash>\t<subject>` of a commit (one process).
fn short_subject(top: &str, rev: &str) -> (String, String) {
    match git(top, &["log", "-1", "--format=%h%x09%s", rev]) {
        Ok(o) => {
            let (h, s) = o.trim_end().split_once('\t').unwrap_or((o.trim(), ""));
            (h.to_string(), s.to_string())
        }
        Err(_) => (String::new(), String::new()),
    }
}

/// What is stopped, which commit, how far along, and the labels of both sides.
/// Reads the git dir's marker files directly.
pub fn operation_info(root: &str) -> Result<OperationInfo, String> {
    let top = toplevel(root)?;
    let dir = git(&top, &["rev-parse", "--absolute-git-dir"])?;
    let dir = std::path::Path::new(dir.trim());
    let kind = operation_in(dir);
    let mut info = OperationInfo {
        kind: kind.clone(),
        step: 0,
        total: 0,
        hash: String::new(),
        subject: String::new(),
        mine: String::new(),
        theirs: String::new(),
    };
    if kind.is_empty() {
        return Ok(info);
    }
    let head_label = |dir: &std::path::Path| {
        // HEAD is "ref: refs/heads/x" on a branch, a hash when detached.
        match read_trim(dir.join("HEAD"))
            .and_then(|h| h.strip_prefix("ref: refs/heads/").map(str::to_string))
        {
            Some(b) => b,
            None => "HEAD".to_string(),
        }
    };
    let theirs_rev: String;
    match kind.as_str() {
        "rebase" => {
            let rm = dir.join("rebase-merge");
            if rm.exists() {
                info.step = read_trim(rm.join("msgnum"))
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                info.total = read_trim(rm.join("end"))
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                info.hash = read_trim(rm.join("stopped-sha")).unwrap_or_default();
                info.mine = read_trim(rm.join("head-name"))
                    .map(|n| n.strip_prefix("refs/heads/").unwrap_or(&n).to_string())
                    .filter(|n| n != "detached HEAD")
                    .unwrap_or_else(|| "HEAD".to_string());
                theirs_rev = read_trim(rm.join("onto")).unwrap_or_default();
            } else {
                let ra = dir.join("rebase-apply");
                info.step = read_trim(ra.join("next"))
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                info.total = read_trim(ra.join("last"))
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                info.mine = read_trim(ra.join("head-name"))
                    .map(|n| n.strip_prefix("refs/heads/").unwrap_or(&n).to_string())
                    .filter(|n| n != "detached HEAD")
                    .unwrap_or_else(|| "HEAD".to_string());
                theirs_rev = read_trim(ra.join("onto")).unwrap_or_default();
            }
        }
        "merge" => {
            info.mine = head_label(dir);
            info.hash = read_trim(dir.join("MERGE_HEAD")).unwrap_or_default();
            theirs_rev = info.hash.clone();
        }
        _ => {
            info.mine = head_label(dir);
            let marker = if kind == "revert" {
                "REVERT_HEAD"
            } else {
                "CHERRY_PICK_HEAD"
            };
            info.hash = read_trim(dir.join(marker)).unwrap_or_default();
            theirs_rev = info.hash.clone();
            // sequencer/todo holds the stopped commit plus the rest; the
            // finished ones show up as commits made since sequencer/head.
            let remaining = std::fs::read_to_string(dir.join("sequencer/todo"))
                .map(|t| {
                    t.lines()
                        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
                        .count() as u32
                })
                .unwrap_or(0);
            if remaining == 0 {
                info.step = 1;
                info.total = 1;
            } else {
                let done = read_trim(dir.join("sequencer/head"))
                    .filter(|h| check_hash(h).is_ok())
                    .and_then(|h| git(&top, &["rev-list", "--count", &format!("{h}..HEAD")]).ok())
                    .and_then(|c| c.trim().parse::<u32>().ok())
                    .unwrap_or(0);
                info.step = done + 1;
                info.total = done + remaining;
            }
        }
    }
    if !info.hash.is_empty() {
        info.subject = short_subject(&top, &info.hash).1;
    }
    // Merge: "Merge branch 'x'" in MERGE_MSG names the branch; otherwise the hash.
    let merged_branch = (kind == "merge")
        .then(|| read_trim(dir.join("MERGE_MSG")))
        .flatten()
        .and_then(|m| {
            let first = m.lines().next()?.to_string();
            let rest = first.strip_prefix("Merge branch '")?;
            Some(rest.split('\'').next()?.to_string())
        });
    info.theirs = match merged_branch {
        Some(b) => b,
        None if theirs_rev.is_empty() => String::new(),
        None => short_subject(&top, &theirs_rev).0,
    };
    Ok(info)
}

/// Reject absolute paths and `..` components: these functions write files.
fn check_rel_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    let bad = path.is_empty()
        || p.is_absolute()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.split(['/', '\\']).any(|c| c == "..");
    if bad {
        Err(format!("invalid path: {path}"))
    } else {
        Ok(())
    }
}

/// Write the merged text to the file and stage it (marks it resolved).
pub fn resolve_file(root: &str, path: &str, content: &str) -> Result<(), String> {
    check_rel_path(path)?;
    let top = toplevel(root)?;
    std::fs::write(std::path::Path::new(&top).join(path), content)
        .map_err(|e| format!("failed to write {path}: {e}"))?;
    git(&top, &["add", "--", path]).map(|_| ())
}

/// Take one side ("mine" | "theirs") for every path. A path whose chosen side
/// was deleted is removed. A constant number of processes.
pub fn resolve_side(root: &str, paths: &[String], side: &str) -> Result<(), String> {
    let top = toplevel(root)?;
    let stage = side_stage(&operation_at(&top), side)?;
    let entries = unmerged(&top)?;
    let mut present: Vec<&str> = Vec::new();
    let mut absent: Vec<&str> = Vec::new();
    for p in paths {
        check_rel_path(p)?;
        if !entries.iter().any(|e| &e.0 == p) {
            return Err(format!("not in conflict: {p}"));
        }
        if entries.iter().any(|e| &e.0 == p && e.1 == stage) {
            present.push(p);
        } else {
            absent.push(p);
        }
    }
    if !present.is_empty() {
        let flag = if stage == 2 { "--ours" } else { "--theirs" };
        let mut a = vec!["checkout", flag, "--"];
        a.extend(&present);
        git(&top, &a)?;
        let mut a = vec!["add", "--"];
        a.extend(&present);
        git(&top, &a)?;
    }
    if !absent.is_empty() {
        let mut a = vec!["rm", "-q", "--"];
        a.extend(&absent);
        git(&top, &a)?;
    }
    Ok(())
}

/// Bring the conflict back for already-resolved paths.
pub fn unresolve(root: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    paths.iter().try_for_each(|p| check_rel_path(p))?;
    let top = toplevel(root)?;
    let mut a = vec!["checkout", "-m", "--"];
    a.extend(paths.iter().map(String::as_str));
    git(&top, &a).map(|_| ())
}

/// Skip the commit that stopped a cherry-pick / revert / rebase.
pub fn operation_skip(root: &str) -> Result<(), String> {
    let (top, op) = current_operation(root)?;
    if op == "merge" {
        return Err("a merge can't be skipped".to_string());
    }
    git_noedit(&top, &[&op, "--skip"])
}

/// What an interactive rebase onto `onto` would replay: oldest first, merges
/// excluded, each flagged as pushed or not (3 processes).
pub fn rebase_plan(root: &str, onto: &str) -> Result<RebasePlan, String> {
    check_name(onto)?;
    let top = toplevel(root)?;
    let range = format!("{onto}..HEAD");
    // Unit separator between fields, record separator between commits.
    let log = git(
        &top,
        &[
            "log",
            "--reverse",
            "--no-merges",
            "--format=%H%x1f%h%x1f%s%x1e",
            &range,
            "--",
        ],
    )?;
    let unpushed: HashSet<String> = git(&top, &["rev-list", &range, "--not", "--remotes", "--"])?
        .lines()
        .map(str::to_string)
        .collect();
    let target = format!("{onto}^{{commit}}");
    let o = git(
        &top,
        &["log", "-1", "--format=%H%x1f%h%x1f%s", &target, "--"],
    )?;
    let mut of = o.trim_end().splitn(3, '\x1f');
    let (onto_full, onto_short, onto_subject) = (
        of.next().unwrap_or("").to_string(),
        of.next().unwrap_or("").to_string(),
        of.next().unwrap_or("").to_string(),
    );
    let commits = log
        .split('\x1e')
        .filter_map(|rec| {
            let mut f = rec.trim_start_matches('\n').splitn(3, '\x1f');
            let hash = f.next().filter(|h| !h.is_empty())?.to_string();
            Some(RebaseStep {
                pushed: !unpushed.contains(&hash),
                short: f.next().unwrap_or("").to_string(),
                subject: f.next().unwrap_or("").to_string(),
                hash,
            })
        })
        .collect();
    Ok(RebasePlan {
        onto: onto_full,
        onto_short,
        onto_subject,
        commits,
    })
}

/// Run an interactive rebase non-interactively with a todo we build.
/// `sequence.editor` is `cp '<todo>'`: git appends its own todo path, so the
/// copy overwrites it (on Windows `cp` comes from Git's own sh). A reword is a
/// `pick` plus `exec git commit --amend -F <file>`. `core.editor=true` keeps
/// git's combined message for squash. The files are removed afterwards.
pub fn rebase_interactive(root: &str, onto: &str, steps: &[RebaseAction]) -> Result<(), String> {
    check_name(onto)?;
    let mut first_kept = true;
    for s in steps {
        check_hash(&s.hash)?;
        match s.action.as_str() {
            "pick" | "drop" => {}
            "reword" => {
                if s.message.as_deref().is_none_or(|m| m.trim().is_empty()) {
                    return Err("a reworded commit needs a message".to_string());
                }
            }
            "squash" | "fixup" => {
                if first_kept {
                    return Err("the first commit can't be squashed or fixed up".to_string());
                }
            }
            a => return Err(format!("invalid action: {a}")),
        }
        if s.action != "drop" {
            first_kept = false;
        }
    }
    let top = toplevel(root)?;
    // The todo and reword messages live in a fresh directory inside the repo's own
    // git dir, never in the shared temp dir: there another user could pre-create
    // the predictable names (or symlink them) and swap in a todo with `exec` lines.
    // `create_dir` fails if the name already exists, so the directory is ours.
    let git_dir = git(&top, &["rev-parse", "--absolute-git-dir"])?;
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::path::Path::new(git_dir.trim()).join(format!(
        "bonk-rebase-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir(&dir).map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let result = run_rebase_todo(&top, &dir, onto, steps);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// Write the todo (and reword messages) into `dir` and run the rebase with it.
fn run_rebase_todo(
    top: &str,
    dir: &std::path::Path,
    onto: &str,
    steps: &[RebaseAction],
) -> Result<(), String> {
    let write = |name: &str, body: &str| -> Result<std::path::PathBuf, String> {
        let path = dir.join(name);
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
        std::io::Write::write_all(&mut f, body.as_bytes())
            .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
        Ok(path)
    };
    let mut todo = String::new();
    for (i, s) in steps.iter().enumerate() {
        if s.action != "reword" {
            todo.push_str(&format!("{} {}\n", s.action, s.hash));
            continue;
        }
        let msg = write(&format!("msg{i}"), s.message.as_deref().unwrap_or(""))?;
        todo.push_str(&format!(
            "pick {}\nexec git commit --amend -F {}\n",
            s.hash,
            sh_quote(&msg.display().to_string())
        ));
    }
    let todo_path = write("todo", &todo)?;
    let editor = format!(
        "sequence.editor=cp {}",
        sh_quote(&todo_path.display().to_string())
    );
    git(
        top,
        &[
            "-c",
            &editor,
            "-c",
            "core.editor=true",
            "rebase",
            "-i",
            "--autostash",
            onto,
        ],
    )
    .map(|_| ())
}

/// Single-quote `s` for sh (git runs the editor and `exec` lines through it), so a
/// repo path with spaces or quotes stays one word.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
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
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
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

        let short = commit(root, "first commit", false).unwrap();
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
        commit(root, "init", false).unwrap();

        create_branch(root, "feature").unwrap();
        assert_eq!(current_branch(root).unwrap(), "feature");

        let bs = branches(root).unwrap();
        assert_eq!(
            bs.first().map(String::as_str),
            Some("feature"),
            "current first"
        );
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
        commit(root, "hello world", false).unwrap();

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
        commit(root, "init", false).unwrap();

        // Modify the tracked file → unstaged diff should show it.
        fs::write(dir.join("a.bonk.json"), "{\"v\":2}\n").unwrap();
        let d = diff(root, "a.bonk.json").unwrap();
        assert!(d.contains("a.bonk.json"), "diff should name the file");
        assert!(d.contains("+{\"v\":2}"), "diff should show the new line");
        assert!(d.contains("-{\"v\":1}"), "diff should show the old line");

        // Staged diff fallback: stage the change, working tree now clean.
        stage(root, &[]).unwrap();
        let d2 = diff(root, "a.bonk.json").unwrap();
        assert!(
            d2.contains("+{\"v\":2}"),
            "staged diff fallback should work"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diff_staged_uses_index_not_worktree() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init", false).unwrap();

        fs::write(dir.join("a.bonk.json"), "{\"v\":2}\n").unwrap();
        stage(root, &[]).unwrap();
        fs::write(dir.join("a.bonk.json"), "{\"v\":3}\n").unwrap();

        let staged = diff_staged(root, "a.bonk.json").unwrap();
        assert!(
            staged.contains("+{\"v\":2}"),
            "staged diff should show index version"
        );
        assert!(
            !staged.contains("+{\"v\":3}"),
            "staged diff must not show worktree version"
        );

        let working = diff(root, "a.bonk.json").unwrap();
        assert!(
            working.contains("+{\"v\":3}"),
            "working diff should show worktree version"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn graph_returns_real_git_graph_lines() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.bonk.json"), "{}").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init", false).unwrap();

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
        assert!(
            d.contains("+{\"hello\":\"world\"}"),
            "should show file body as additions: {d}"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_diffs_covers_tracked_staged_untracked() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // Committed, then modified in the working tree (tracked, unstaged).
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init", false).unwrap();
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":2}\n").unwrap();
        // Staged-only new file.
        fs::write(dir.join("staged.bonk.json"), "{\"s\":1}\n").unwrap();
        stage(root, &["staged.bonk.json".to_string()]).unwrap();
        // Untracked file.
        fs::write(dir.join("untracked.bonk.json"), "{\"u\":1}\n").unwrap();

        let diffs = status_diffs(root).unwrap();
        let by = |p: &str| diffs.iter().find(|d| d.path == p).expect(p);

        let t = by("tracked.bonk.json");
        assert!(
            !t.staged && !t.untracked,
            "modified tracked = unstaged working diff"
        );
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
        commit(root, "init", false).unwrap();

        // Modify a tracked file, add an untracked one, stage a brand-new one.
        fs::write(dir.join("tracked.bonk.json"), "{\"v\":999}\n").unwrap();
        fs::write(dir.join("untracked.bonk.json"), "{}").unwrap();
        fs::create_dir_all(dir.join("New Folder")).unwrap();
        fs::write(dir.join("New Folder/спуск.bonk.json"), "{}").unwrap();
        fs::write(dir.join("added.bonk.json"), "{}").unwrap();
        stage(root, &["added.bonk.json".to_string()]).unwrap();

        // All in one call: one batch of git processes, not one per file.
        discard(
            root,
            &[
                "tracked.bonk.json".to_string(),
                "untracked.bonk.json".to_string(),
                "New Folder/спуск.bonk.json".to_string(),
                "added.bonk.json".to_string(),
            ],
        )
        .unwrap();

        // Tracked file is back to its committed contents.
        let content = fs::read_to_string(dir.join("tracked.bonk.json")).unwrap();
        assert_eq!(content, "{\"v\":1}\n");
        // Untracked + staged-new files are gone.
        assert!(!dir.join("untracked.bonk.json").exists());
        assert!(!dir.join("New Folder/спуск.bonk.json").exists());
        assert!(!dir.join("added.bonk.json").exists());
        // Working tree is clean.
        let st = status(root).unwrap();
        assert!(
            st.files.is_empty(),
            "status should be clean: {:?}",
            st.files
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn discard_reverts_staged_rename_to_head() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        // Commit a file, then rename it (git mv stages the rename).
        fs::write(dir.join("old.bonk.json"), "{\"v\":1}\n").unwrap();
        stage(root, &[]).unwrap();
        commit(root, "init", false).unwrap();
        git(root, &["mv", "old.bonk.json", "new.bonk.json"]).unwrap();

        // Discard the rename via the new (index) path.
        discard(root, &["new.bonk.json".to_string()]).unwrap();

        // Original file is back with its committed contents; new path is gone.
        assert!(
            dir.join("old.bonk.json").exists(),
            "original path should be restored"
        );
        let content = fs::read_to_string(dir.join("old.bonk.json")).unwrap();
        assert_eq!(content, "{\"v\":1}\n");
        assert!(
            !dir.join("new.bonk.json").exists(),
            "renamed path should be gone"
        );
        // Working tree (and index) fully clean — no dangling delete-side.
        let st = status(root).unwrap();
        assert!(
            st.files.is_empty(),
            "status should be clean: {:?}",
            st.files
        );
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
        commit(repo_root, "init", false).unwrap();

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
        assert!(
            st3.files.is_empty(),
            "should be clean after discard: {:?}",
            st3.files
        );
        let content = fs::read_to_string(ws.join("a.bonk.json")).unwrap();
        assert_eq!(
            content, "{\"v\":1}\n",
            "file reverted to committed contents"
        );
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
        commit(root, "init", false).unwrap();

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
        let e = diffs
            .iter()
            .find(|d| d.path == "a.bonk.json")
            .expect("entry");
        // Combined HEAD-vs-worktree: BOTH additions appear, not just one side.
        assert!(
            e.diff.contains("+line2"),
            "staged hunk must be visible: {}",
            e.diff
        );
        assert!(
            e.diff.contains("+line3"),
            "unstaged hunk must be visible: {}",
            e.diff
        );
        // Not fully staged (worktree is dirty) → UI offers "Stage", not "Unstage".
        assert!(!e.staged, "MM file is not fully staged");
        let _ = fs::remove_dir_all(dir);
    }

    fn big_file(change: &str) -> String {
        let mut lines: Vec<String> = (0..200).map(|i| format!("line {i}")).collect();
        lines[100] = change.to_string();
        lines.join("\n") + "\n"
    }

    #[test]
    fn diff_is_full_file_head_vs_worktree() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.txt"), big_file("orig")).unwrap();
        stage(root, &["a.txt".to_string()]).unwrap();
        commit(root, "init", false).unwrap();
        fs::write(dir.join("a.txt"), big_file("changed")).unwrap();
        stage(root, &["a.txt".to_string()]).unwrap();
        let d = diff(root, "a.txt").unwrap();
        assert!(d.contains("+changed") && d.contains(" line 0\n") && d.contains(" line 199\n"));
        let ds = diff_staged(root, "a.txt").unwrap();
        assert!(ds.contains(" line 0\n"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diff_untracked_file_is_all_additions() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.txt"), "x\n").unwrap();
        stage(root, &["a.txt".to_string()]).unwrap();
        commit(root, "init", false).unwrap();
        fs::write(dir.join("new.txt"), "hello\nworld\n").unwrap();
        let d = diff(root, "new.txt").unwrap();
        assert!(d.contains("+hello") && d.contains("+world"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn commit_amend_rewrites_last_commit() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.txt"), "x\n").unwrap();
        stage(root, &["a.txt".to_string()]).unwrap();
        commit(root, "first", false).unwrap();
        commit(root, "renamed", true).unwrap();
        let l = log(root, 10).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].subject, "renamed");
        assert!(l[0].time > 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn branch_list_current_first_and_tracking() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        fs::write(dir.join("a.txt"), "x\n").unwrap();
        stage(root, &["a.txt".to_string()]).unwrap();
        commit(root, "init", false).unwrap();
        // A second repo clones the first so we get a remote + upstream.
        let clone = temp_dir();
        git(root, &["clone", "-q", root, clone.to_str().unwrap()]).unwrap();
        let c = clone.to_str().unwrap();
        git(c, &["config", "user.email", "t@e.com"]).unwrap();
        git(c, &["config", "user.name", "Test"]).unwrap();
        git(root, &["branch", "fix/x"]).unwrap();
        git(c, &["fetch", "-q"]).unwrap();
        fs::write(clone.join("b.txt"), "y\n").unwrap();
        stage(c, &["b.txt".to_string()]).unwrap();
        commit(c, "local", false).unwrap();
        create_branch(c, "other").unwrap();
        checkout(c, "other").unwrap();
        checkout(
            c,
            &branches(c)
                .unwrap()
                .into_iter()
                .find(|b| b != "other")
                .unwrap(),
        )
        .unwrap();

        let list = branch_list(c).unwrap();
        assert!(list[0].current && !list[0].remote);
        assert_eq!(list[0].ahead, 1);
        assert!(list[0].upstream.as_deref().unwrap().starts_with("origin/"));
        assert!(list.iter().any(|b| b.name == "other" && !b.current));
        assert!(list.iter().all(|b| !b.name.ends_with("/HEAD")));
        assert!(list.iter().any(|b| b.remote && b.name == "origin/fix/x"));

        checkout_remote(c, "origin/fix/x").unwrap();
        assert_eq!(current_branch(c).unwrap(), "fix/x");
        assert!(checkout_remote(c, "-bad").is_err());
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(clone);
    }

    #[test]
    fn stash_round_trip_with_untracked() {
        let dir = init_repo();
        let root = dir.to_str().unwrap();
        assert!(stash_list(root).unwrap().is_empty(), "unborn repo");
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        stage(root, &["a.txt".to_string()]).unwrap();
        commit(root, "init", false).unwrap();
        assert!(stash_list(root).unwrap().is_empty());

        fs::write(dir.join("a.txt"), "two\n").unwrap();
        fs::write(dir.join("new.txt"), "fresh\n").unwrap();
        stash_push(root, "my work", true, false, false).unwrap();
        assert!(!dir.join("new.txt").exists());

        let list = stash_list(root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].index, 0);
        assert_eq!(list[0].message, "my work");
        assert_eq!(list[0].branch, "main");
        assert!(list[0].time > 0);

        let files = stash_show(root, 0).unwrap();
        let a = files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.status, "M");
        assert!(a.diff.contains("+two"));
        let n = files.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!(n.status, "A");

        stash_pop(root, 0).unwrap();
        assert!(dir.join("new.txt").exists());
        assert!(stash_list(root).unwrap().is_empty());
        assert!(stash_branch(root, "-x", 0).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    fn commit_file(root: &str, name: &str, content: &str, msg: &str) {
        fs::write(std::path::Path::new(root).join(name), content).unwrap();
        git(root, &["add", "-A"]).unwrap();
        git(root, &["commit", "-m", msg]).unwrap();
    }

    fn rev(root: &str, r: &str) -> String {
        git(root, &["rev-parse", r]).unwrap().trim().to_string()
    }

    /// main: a -> b -> M(merge of feat); feat: a -> f1. Tag v1 on a.
    fn merge_repo() -> std::path::PathBuf {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "a\n", "a");
        git(r, &["branch", "-M", "main"]).unwrap();
        git(r, &["tag", "v1"]).unwrap();
        git(r, &["switch", "-c", "feat"]).unwrap();
        commit_file(r, "f.txt", "f\n", "f1");
        git(r, &["switch", "main"]).unwrap();
        commit_file(r, "b.txt", "b\n", "b");
        git(r, &["merge", "--no-ff", "-m", "M", "feat"]).unwrap();
        dir
    }

    #[test]
    fn check_hash_rejects_bad_input() {
        assert!(check_hash("-x").is_err());
        assert!(check_hash("zz").is_err());
        assert!(check_hash("abc").is_err());
        assert!(check_hash("abcd1234").is_ok());
        assert!(check_name("-x").is_err());
        assert!(check_name("").is_err());
    }

    #[test]
    fn graph_log_merge_refs_total_skip() {
        let dir = merge_repo();
        let r = dir.to_str().unwrap();
        let p = graph_log(r, true, 0, 50).unwrap();
        assert_eq!(p.total, 4);
        assert_eq!(p.branches, 2);
        assert_eq!(p.commits.len(), 4);
        let m = &p.commits[0];
        assert_eq!(m.subject, "M");
        assert_eq!(m.parents.len(), 2);
        assert!(m.refs.iter().any(|x| x.kind == "head" && x.name == "main"));
        assert!(p.commits.iter().any(|c| c
            .refs
            .iter()
            .any(|x| x.kind == "branch" && x.name == "feat")));
        assert!(p
            .commits
            .iter()
            .any(|c| c.refs.iter().any(|x| x.kind == "tag" && x.name == "v1")));
        let p2 = graph_log(r, false, 3, 50).unwrap();
        assert_eq!(p2.commits.len(), 1);
        assert_eq!(p2.total, 4);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn graph_log_unborn_is_empty() {
        let dir = init_repo();
        let p = graph_log(dir.to_str().unwrap(), false, 0, 10).unwrap();
        assert!(p.commits.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn commit_detail_files_and_branches() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "1\n2\n", "first");
        commit_file(r, "keep.txt", "k\n", "second");
        fs::write(dir.join("a.txt"), "1\n2\n3\n").unwrap();
        fs::write(dir.join("new.txt"), "n\n").unwrap();
        fs::remove_file(dir.join("keep.txt")).unwrap();
        git(r, &["add", "-A"]).unwrap();
        git(r, &["commit", "-m", "third", "-m", "body text"]).unwrap();
        let d = commit_detail(r, &rev(r, "HEAD")).unwrap();
        assert_eq!(d.subject, "third");
        assert_eq!(d.body, "body text");
        assert_eq!(d.parents.len(), 1);
        assert!(!d.branches.is_empty());
        let get = |p: &str| d.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(get("a.txt").status, "M");
        assert_eq!(get("a.txt").additions, 1);
        assert_eq!(get("new.txt").status, "A");
        assert_eq!(get("keep.txt").status, "D");
        assert_eq!(get("keep.txt").deletions, 1);
        // Root commit diffs against the empty tree.
        let root_c = commit_detail(r, &rev(r, "HEAD~2")).unwrap();
        assert_eq!(root_c.files.len(), 1);
        assert_eq!(root_c.files[0].status, "A");
        assert_eq!(root_c.files[0].additions, 2);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn commit_detail_rename() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "old.txt", "same\ncontent\nhere\n", "add");
        git(r, &["mv", "old.txt", "new.txt"]).unwrap();
        git(r, &["commit", "-m", "mv"]).unwrap();
        let d = commit_detail(r, &rev(r, "HEAD")).unwrap();
        assert_eq!(d.files.len(), 1);
        assert_eq!(d.files[0].path, "new.txt");
        assert_eq!(d.files[0].status, "R");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn commit_file_diff_is_full_file() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "big.txt", &big_file("x"), "base");
        commit_file(r, "big.txt", &big_file("CHANGED"), "edit");
        let out = commit_file_diff(r, &rev(r, "HEAD"), "big.txt").unwrap();
        assert!(out.contains("CHANGED"));
        assert!(out.contains("line 1\n"), "far lines present: {out}");
        let root_out = commit_file_diff(r, &rev(r, "HEAD~1"), "big.txt").unwrap();
        assert!(root_out.contains("+line 1"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cherry_pick_and_revert() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "a\n", "a");
        git(r, &["branch", "-M", "main"]).unwrap();
        git(r, &["switch", "-c", "other"]).unwrap();
        commit_file(r, "x.txt", "x\n", "px");
        commit_file(r, "y.txt", "y\n", "py");
        let (h1, h2) = (rev(r, "HEAD~1"), rev(r, "HEAD"));
        git(r, &["switch", "main"]).unwrap();
        cherry_pick(r, &[h1, h2]).unwrap();
        assert!(dir.join("x.txt").exists() && dir.join("y.txt").exists());
        revert(r, &[rev(r, "HEAD")]).unwrap();
        assert!(!dir.join("y.txt").exists());
        assert!(dir.join("x.txt").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reset_tag_branch_detach() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "1\n", "one");
        let first = rev(r, "HEAD");
        commit_file(r, "a.txt", "2\n", "two");
        create_tag(r, "t1", &first).unwrap();
        assert_eq!(rev(r, "t1"), first);
        reset(r, &first, "soft").unwrap();
        assert_eq!(rev(r, "HEAD"), first);
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "2\n");
        reset(r, &first, "hard").unwrap();
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "1\n");
        assert!(reset(r, &first, "bogus").is_err());
        create_branch_at(r, "nb", &first).unwrap();
        assert_eq!(current_branch(r).unwrap(), "nb");
        checkout_detached(r, &first).unwrap();
        assert_eq!(status(r).unwrap().branch, "");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn format_patch_two_commits() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "1\n", "subject one");
        commit_file(r, "b.txt", "2\n", "subject two");
        let out = format_patch(r, &[rev(r, "HEAD~1"), rev(r, "HEAD")]).unwrap();
        let (i1, i2) = (
            out.find("subject one").unwrap(),
            out.find("subject two").unwrap(),
        );
        assert!(i1 < i2);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn conflicting_cherry_pick_sets_operation_then_abort() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "base\n", "base");
        git(r, &["branch", "-M", "main"]).unwrap();
        git(r, &["switch", "-c", "other"]).unwrap();
        commit_file(r, "a.txt", "other\n", "other change");
        let h = rev(r, "HEAD");
        git(r, &["switch", "main"]).unwrap();
        commit_file(r, "a.txt", "main\n", "main change");
        assert!(cherry_pick(r, &[h]).is_err());
        assert_eq!(status(r).unwrap().operation, "cherry-pick");
        operation_abort(r).unwrap();
        assert_eq!(status(r).unwrap().operation, "");
        assert!(operation_abort(r).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    /// main has "main\n" in a.txt, branch `other` has "other\n" (base "base\n").
    /// Returns the repo and other's tip; HEAD is on main.
    fn conflict_repo() -> (std::path::PathBuf, String) {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "base\n", "base");
        git(r, &["branch", "-M", "main"]).unwrap();
        git(r, &["switch", "-c", "other"]).unwrap();
        commit_file(r, "a.txt", "other\n", "other change");
        let h = rev(r, "HEAD");
        git(r, &["switch", "main"]).unwrap();
        commit_file(r, "a.txt", "main\n", "main change");
        (dir, h)
    }

    #[test]
    fn conflicts_and_operation_info_for_cherry_pick() {
        let (dir, h) = conflict_repo();
        let r = dir.to_str().unwrap();
        assert!(cherry_pick(r, std::slice::from_ref(&h)).is_err());
        let c = conflicts(r).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].path, "a.txt");
        assert_eq!(c[0].base.as_deref(), Some("base\n"));
        assert_eq!(c[0].mine.as_deref(), Some("main\n"));
        assert_eq!(c[0].theirs.as_deref(), Some("other\n"));
        let i = operation_info(r).unwrap();
        assert_eq!(i.kind, "cherry-pick");
        assert_eq!(i.hash, h);
        assert_eq!(i.subject, "other change");
        assert_eq!(i.mine, "main");
        assert_eq!(i.theirs, h[..i.theirs.len()]);
        assert_eq!((i.step, i.total), (1, 1));
        operation_abort(r).unwrap();
        assert_eq!(operation_info(r).unwrap().kind, "");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn operation_info_second_of_two_picks() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "base\n", "base");
        git(r, &["branch", "-M", "main"]).unwrap();
        git(r, &["switch", "-c", "other"]).unwrap();
        commit_file(r, "b.txt", "b\n", "ob");
        commit_file(r, "a.txt", "other\n", "oa");
        let (h1, h2) = (rev(r, "HEAD~1"), rev(r, "HEAD"));
        git(r, &["switch", "main"]).unwrap();
        commit_file(r, "a.txt", "main\n", "ma");
        assert!(cherry_pick(r, &[h1, h2.clone()]).is_err());
        let i = operation_info(r).unwrap();
        assert_eq!((i.step, i.total), (2, 2));
        assert_eq!(i.hash, h2);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_side_mine_and_theirs_then_unresolve() {
        let (dir, h) = conflict_repo();
        let r = dir.to_str().unwrap();
        let p = vec!["a.txt".to_string()];
        assert!(cherry_pick(r, &[h]).is_err());
        resolve_side(r, &p, "theirs").unwrap();
        assert!(conflicts(r).unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "other\n");
        unresolve(r, &p).unwrap();
        assert_eq!(conflicts(r).unwrap().len(), 1);
        resolve_side(r, &p, "mine").unwrap();
        assert!(conflicts(r).unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "main\n");
        assert!(resolve_side(r, &p, "bogus").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn modify_delete_conflict_sides() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "base\n", "base");
        git(r, &["branch", "-M", "main"]).unwrap();
        git(r, &["switch", "-c", "other"]).unwrap();
        commit_file(r, "a.txt", "other\n", "modify");
        let h = rev(r, "HEAD");
        git(r, &["switch", "main"]).unwrap();
        git(r, &["rm", "-q", "a.txt"]).unwrap();
        git(r, &["commit", "-m", "delete"]).unwrap();
        let p = vec!["a.txt".to_string()];
        assert!(cherry_pick(r, &[h]).is_err());
        let c = conflicts(r).unwrap();
        assert!(c[0].mine.is_none());
        assert_eq!(c[0].theirs.as_deref(), Some("other\n"));
        resolve_side(r, &p, "mine").unwrap();
        assert!(!dir.join("a.txt").exists());
        assert!(conflicts(r).unwrap().is_empty());
        // A removed path has no index entry left, so it can't be re-conflicted.
        assert!(unresolve(r, &p).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_file_writes_and_stages_and_rejects_bad_paths() {
        let (dir, h) = conflict_repo();
        let r = dir.to_str().unwrap();
        assert!(cherry_pick(r, &[h]).is_err());
        assert!(resolve_file(r, "../x", "z").is_err());
        assert!(resolve_file(r, "/abs", "z").is_err());
        assert!(resolve_file(r, "sub/../x", "z").is_err());
        resolve_file(r, "a.txt", "merged\n").unwrap();
        assert!(conflicts(r).unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "merged\n");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn operation_skip_cherry_pick_and_merge() {
        let (dir, h) = conflict_repo();
        let r = dir.to_str().unwrap();
        assert!(cherry_pick(r, &[h]).is_err());
        operation_skip(r).unwrap();
        assert_eq!(status(r).unwrap().operation, "");
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "main\n");
        assert!(merge(r, "other").is_err());
        let i = operation_info(r).unwrap();
        assert_eq!((i.kind.as_str(), i.theirs.as_str()), ("merge", "other"));
        assert_eq!(i.mine, "main");
        assert!(operation_skip(r).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rebase_conflict_swaps_sides() {
        let (dir, _) = conflict_repo();
        let r = dir.to_str().unwrap();
        // Rebase `other` (its commit says "other") onto main (says "main").
        git(r, &["switch", "other"]).unwrap();
        assert!(rebase(r, "main").is_err());
        let i = operation_info(r).unwrap();
        assert_eq!(i.kind, "rebase");
        assert_eq!(i.mine, "other");
        assert_eq!(i.theirs, rev(r, "main")[..i.theirs.len()]);
        assert_eq!(i.subject, "other change");
        assert_eq!((i.step, i.total), (1, 1));
        let c = conflicts(r).unwrap();
        assert_eq!(c[0].mine.as_deref(), Some("other\n"));
        assert_eq!(c[0].theirs.as_deref(), Some("main\n"));
        resolve_side(r, &["a.txt".to_string()], "mine").unwrap();
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "other\n");
        let _ = fs::remove_dir_all(dir);
    }

    /// base -> c1 -> c2 -> c3 on main, with c1 pushed to a bare "origin".
    fn plan_repo() -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "base.txt", "b\n", "base");
        git(r, &["branch", "-M", "main"]).unwrap();
        commit_file(r, "f1.txt", "1\n", "c1");
        let remote = temp_dir();
        fs::create_dir_all(&remote).unwrap();
        git(remote.to_str().unwrap(), &["init", "-q", "--bare"]).unwrap();
        git(r, &["remote", "add", "origin", remote.to_str().unwrap()]).unwrap();
        git(r, &["push", "-q", "origin", "main"]).unwrap();
        git(r, &["fetch", "-q", "origin"]).unwrap();
        commit_file(r, "f2.txt", "2\n", "c2");
        commit_file(r, "f3.txt", "3\n", "c3");
        (dir, remote)
    }

    fn subjects(r: &str) -> Vec<String> {
        git(r, &["log", "--format=%s", "--reverse"])
            .unwrap()
            .lines()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn rebase_plan_lists_oldest_first_with_pushed() {
        let (dir, remote) = plan_repo();
        let r = dir.to_str().unwrap();
        let plan = rebase_plan(r, "HEAD~3").unwrap();
        assert_eq!(plan.onto, rev(r, "HEAD~3"));
        assert_eq!(plan.onto_subject, "base");
        let got: Vec<_> = plan
            .commits
            .iter()
            .map(|c| (c.subject.as_str(), c.pushed))
            .collect();
        assert_eq!(got, [("c1", true), ("c2", false), ("c3", false)]);
        assert_eq!(plan.commits[2].hash, rev(r, "HEAD"));
        assert!(rebase_plan(r, "--x").is_err());
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(remote);
    }

    fn act(r: &str, rev_: &str, action: &str, msg: Option<&str>) -> RebaseAction {
        RebaseAction {
            hash: rev(r, rev_),
            action: action.to_string(),
            message: msg.map(str::to_string),
        }
    }

    #[test]
    fn rebase_interactive_reorder_drop_squash_reword_fixup() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "base.txt", "b\n", "base");
        for n in 1..=5 {
            commit_file(r, &format!("f{n}.txt"), "x\n", &format!("c{n}"));
        }
        // c1..c5 -> [c3 reworded, c2 + c4 squashed, c1 dropped, c5 fixed up]
        let steps = [
            act(r, "HEAD~2", "reword", Some("three renamed")),
            act(r, "HEAD~3", "pick", None),
            act(r, "HEAD~1", "squash", None),
            act(r, "HEAD~4", "drop", None),
            act(r, "HEAD", "fixup", None),
        ];
        rebase_interactive(r, "HEAD~5", &steps).unwrap();
        let s = subjects(r);
        assert_eq!(s, ["base", "three renamed", "c2"]);
        // c4 and c5 content landed; c1 did not.
        assert!(dir.join("f4.txt").exists() && dir.join("f5.txt").exists());
        assert!(!dir.join("f1.txt").exists());
        assert_eq!(status(r).unwrap().operation, "");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sh_quote_keeps_a_path_one_word() {
        assert_eq!(sh_quote("/a b/c"), "'/a b/c'");
        assert_eq!(sh_quote("/O'Brien/x"), "'/O'\\''Brien/x'");
    }

    #[test]
    fn rebase_interactive_rejects_bad_input() {
        let dir = init_repo();
        let r = dir.to_str().unwrap();
        commit_file(r, "a.txt", "1\n", "one");
        commit_file(r, "b.txt", "2\n", "two");
        let before = rev(r, "HEAD");
        let squash_first = [
            act(r, "HEAD", "squash", None),
            act(r, "HEAD~1", "pick", None),
        ];
        assert!(rebase_interactive(r, "HEAD~2", &squash_first).is_err());
        let dropped_first = [
            act(r, "HEAD~1", "drop", None),
            act(r, "HEAD", "fixup", None),
        ];
        assert!(rebase_interactive(r, "HEAD~2", &dropped_first).is_err());
        assert!(rebase_interactive(r, "HEAD~2", &[act(r, "HEAD", "reword", Some(" "))]).is_err());
        assert!(rebase_interactive(r, "HEAD~2", &[act(r, "HEAD", "bogus", None)]).is_err());
        assert_eq!(rev(r, "HEAD"), before);
        let _ = fs::remove_dir_all(dir);
    }
}
