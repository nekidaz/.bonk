//! bonk's own processes for the dev-only resource monitor: the app itself, everything it
//! spawned (terminal shells, git) and the webview processes, with memory, CPU, disk I/O and,
//! when the Resources tab is visible, thread and open-file counts.

use serde::Serialize;
use std::collections::HashMap;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// One row of the OS process list, as much as picking bonk's processes needs.
pub struct RawProc {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    /// A Linux thread (sysinfo lists them as entries whose parent is the owning process).
    pub thread: bool,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ProcKind {
    Main,
    Webview,
    Child,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcStat {
    pub pid: u32,
    pub name: String,
    pub kind: ProcKind,
    pub mem_bytes: u64,
    /// Percent of one core (a busy process on 4 cores can show 400).
    pub cpu_pct: f32,
    pub threads: Option<u32>,
    pub open_files: Option<u32>,
    /// Cumulative since the process started; the frontend turns them into rates.
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
}

/// WebKit (macOS/Linux) and WebView2 (Windows) helper processes. Linux names arrive cut to
/// 15 characters (`WebKitWebProces`), hence the bare `WebKit` prefix.
pub fn is_webview_name(name: &str) -> bool {
    name.starts_with("com.apple.WebKit.")
        || name.starts_with("WebKit")
        || name.to_ascii_lowercase().starts_with("msedgewebview2")
}

/// `me` first, then by pid. A descendant of `me` is a Child (or Webview by name); a process
/// outside the tree is a Webview when the OS says `me` is responsible for it (macOS XPC), or,
/// for a dev build launched from a terminal, when it is a WebKit process sharing `me`'s
/// responsible app (the terminal or editor is then responsible for both).
pub fn select_own(
    all: &[RawProc],
    me: u32,
    responsible: &dyn Fn(u32) -> Option<u32>,
) -> Vec<(u32, ProcKind)> {
    let parents: HashMap<u32, Option<u32>> = all.iter().map(|p| (p.pid, p.parent)).collect();
    let descends = |pid: u32| {
        let mut cur = parents.get(&pid).copied().flatten();
        // At most one step per process: a cycle in a stale list ends here.
        for _ in 0..all.len() {
            match cur {
                Some(p) if p == me => return true,
                Some(p) => cur = parents.get(&p).copied().flatten(),
                None => return false,
            }
        }
        false
    };
    let my_responsible = responsible(me).filter(|&r| r != me);
    let mut out: Vec<(u32, ProcKind)> = all
        .iter()
        .filter(|p| p.pid != me && !p.thread)
        .filter_map(|p| {
            if descends(p.pid) {
                Some((
                    p.pid,
                    if is_webview_name(&p.name) {
                        ProcKind::Webview
                    } else {
                        ProcKind::Child
                    },
                ))
            } else if responsible(p.pid) == Some(me)
                || (is_webview_name(&p.name)
                    && my_responsible.is_some()
                    && responsible(p.pid) == my_responsible)
            {
                // ponytail: in a dev build this also counts WebKit helpers of other apps
                // started from the same terminal; release builds match on `me` only.
                Some((p.pid, ProcKind::Webview))
            } else {
                None
            }
        })
        .collect();
    out.sort_by_key(|(pid, _)| *pid);
    out.insert(0, (me, ProcKind::Main));
    out
}

pub struct ProcMonitor {
    sys: System,
}

impl Default for ProcMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcMonitor {
    pub fn new() -> Self {
        Self { sys: System::new() }
    }

    /// Refreshes the process list; `threads` / `open_files` only when `detailed`, else `None`.
    pub fn sample(&mut self, detailed: bool) -> Vec<ProcStat> {
        // ponytail: refreshes every process each tick (a few ms for ~600); refresh only our pids
        // between full scans if this ever shows up in the monitor itself.
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_memory()
                .with_cpu()
                .with_disk_usage()
                .with_tasks(),
        );
        let procs = self.sys.processes();
        let raw: Vec<RawProc> = procs
            .values()
            .map(|p| RawProc {
                pid: p.pid().as_u32(),
                parent: p.parent().map(Pid::as_u32),
                name: p.name().to_string_lossy().into_owned(),
                thread: p.thread_kind().is_some(),
            })
            .collect();
        select_own(&raw, std::process::id(), &responsible_pid)
            .into_iter()
            .filter_map(|(pid, kind)| {
                let p = procs.get(&Pid::from_u32(pid))?;
                let disk = p.disk_usage();
                Some(ProcStat {
                    pid,
                    name: p.name().to_string_lossy().into_owned(),
                    kind,
                    mem_bytes: footprint(pid).unwrap_or_else(|| p.memory()),
                    cpu_pct: p.cpu_usage(),
                    threads: if detailed { threads(p) } else { None },
                    open_files: if detailed {
                        p.open_files().and_then(|n| u32::try_from(n).ok())
                    } else {
                        None
                    },
                    disk_read_bytes: disk.total_read_bytes,
                    disk_write_bytes: disk.total_written_bytes,
                })
            })
            .collect()
    }
}

#[cfg(target_os = "macos")]
fn responsible_pid(pid: u32) -> Option<u32> {
    use std::sync::OnceLock;
    type Responsible = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;
    // Private libSystem call (Activity Monitor uses it to group XPC helpers under their app).
    // Looked up at runtime so a macOS without it shows «not found» instead of failing to load.
    static FN: OnceLock<Option<Responsible>> = OnceLock::new();
    let f = FN.get_or_init(|| {
        let sym = unsafe {
            libc::dlsym(
                libc::RTLD_DEFAULT,
                c"responsibility_get_pid_responsible_for_pid".as_ptr(),
            )
        };
        (!sym.is_null())
            .then(|| unsafe { std::mem::transmute::<*mut libc::c_void, Responsible>(sym) })
    });
    let r = unsafe { (*f)?(pid as libc::pid_t) };
    (r > 0).then_some(r as u32)
}

#[cfg(not(target_os = "macos"))]
fn responsible_pid(_pid: u32) -> Option<u32> {
    None
}

/// macOS «Memory» column of Activity Monitor (physical footprint); RSS overstates shared pages.
#[cfg(target_os = "macos")]
fn footprint(pid: u32) -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v2>::zeroed();
    let rc = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V2,
            info.as_mut_ptr().cast(),
        )
    };
    (rc == 0).then(|| unsafe { info.assume_init() }.ri_phys_footprint)
}

#[cfg(not(target_os = "macos"))]
fn footprint(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
fn threads(p: &sysinfo::Process) -> Option<u32> {
    let mut info = std::mem::MaybeUninit::<libc::proc_taskinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
    let got = unsafe {
        libc::proc_pidinfo(
            p.pid().as_u32() as libc::c_int,
            libc::PROC_PIDTASKINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    (got == size).then(|| unsafe { info.assume_init() }.pti_threadnum as u32)
}

#[cfg(not(target_os = "macos"))]
fn threads(p: &sysinfo::Process) -> Option<u32> {
    p.tasks().and_then(|t| u32::try_from(t.len()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: Option<u32>, name: &str) -> RawProc {
        RawProc {
            pid,
            parent,
            name: name.into(),
            thread: false,
        }
    }
    const NOBODY: &dyn Fn(u32) -> Option<u32> = &|_| None;

    #[test]
    fn picks_main_and_all_descendants() {
        let all = [
            p(1, None, "launchd"),
            p(10, Some(1), "bonk"),
            p(11, Some(10), "zsh"),
            p(12, Some(11), "git"),
            p(20, Some(1), "Safari"),
        ];
        assert_eq!(
            select_own(&all, 10, NOBODY),
            vec![
                (10, ProcKind::Main),
                (11, ProcKind::Child),
                (12, ProcKind::Child)
            ]
        );
    }

    #[test]
    fn webview_by_responsible_pid_and_by_child_name() {
        let all = [
            p(1, None, "launchd"),
            p(10, Some(1), "bonk"),
            p(30, Some(1), "com.apple.WebKit.WebContent"),
            p(31, Some(1), "com.apple.WebKit.WebContent"),
            p(40, Some(10), "msedgewebview2.exe"),
        ];
        let resp = |pid: u32| (pid == 30).then_some(10);
        assert_eq!(
            select_own(&all, 10, &resp),
            vec![
                (10, ProcKind::Main),
                (30, ProcKind::Webview),
                (40, ProcKind::Webview)
            ]
        );
    }

    #[test]
    fn dev_build_shares_its_responsible_app_with_webkit() {
        // `tauri dev` from an editor's terminal: macOS makes the editor (99) responsible for
        // bonk and for bonk's WebKit helpers alike.
        let all = [
            p(10, Some(5), "bonk"),
            p(30, Some(1), "com.apple.WebKit.WebContent"),
            p(31, Some(1), "zsh"),
            p(32, Some(1), "com.apple.WebKit.WebContent"),
        ];
        let resp = |pid: u32| match pid {
            10 | 30 | 31 => Some(99),
            32 => Some(77),
            _ => None,
        };
        assert_eq!(
            select_own(&all, 10, &resp),
            vec![(10, ProcKind::Main), (30, ProcKind::Webview)]
        );
    }

    #[test]
    fn no_attribution_means_main_and_children_only() {
        let all = [
            p(10, Some(1), "bonk"),
            p(30, Some(1), "com.apple.WebKit.WebContent"),
        ];
        assert_eq!(select_own(&all, 10, NOBODY), vec![(10, ProcKind::Main)]);
    }

    #[test]
    fn parent_cycle_does_not_hang() {
        let all = [
            p(10, Some(1), "bonk"),
            p(50, Some(51), "a"),
            p(51, Some(50), "b"),
        ];
        assert_eq!(select_own(&all, 10, NOBODY), vec![(10, ProcKind::Main)]);
    }

    #[test]
    fn linux_threads_are_not_processes() {
        let thread = RawProc {
            thread: true,
            ..p(11, Some(10), "tokio-runtime-w")
        };
        let all = [p(10, Some(1), "bonk"), thread, p(12, Some(10), "zsh")];
        assert_eq!(
            select_own(&all, 10, NOBODY),
            vec![(10, ProcKind::Main), (12, ProcKind::Child)]
        );
    }

    #[test]
    fn linux_truncated_webkit_names() {
        // sysinfo cuts Linux process names to 15 characters.
        assert!(is_webview_name("WebKitWebProces"));
        assert!(is_webview_name("WebKitNetworkPr"));
    }

    #[test]
    fn webview_names() {
        assert!(is_webview_name("com.apple.WebKit.Networking"));
        assert!(is_webview_name("msedgewebview2.exe"));
        assert!(is_webview_name("WebKitWebProcess"));
        assert!(!is_webview_name("git"));
    }

    #[test]
    fn sample_includes_this_process() {
        let mut m = ProcMonitor::new();
        let stats = m.sample(true);
        let me = stats
            .iter()
            .find(|s| s.kind == ProcKind::Main)
            .expect("main");
        assert_eq!(me.pid, std::process::id());
        assert!(me.mem_bytes > 0);
    }
}
