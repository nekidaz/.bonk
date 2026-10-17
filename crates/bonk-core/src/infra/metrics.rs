//! Process-wide counters for the dev-only resource monitor (`monitor_snapshot`): network
//! traffic per protocol, file writes per kind and script runs. Lock-free atomics, so the hot
//! paths (every request, every state.json write) pay one `fetch_add`.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

#[derive(Clone, Copy)]
pub enum NetProto {
    Http,
    Grpc,
    Sse,
}

#[derive(Clone, Copy)]
pub enum DiskKind {
    State,
    Settings,
    Workspace,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetTotals {
    pub sent: u64,
    pub received: u64,
    pub count: u64,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteTotals {
    pub count: u64,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTotals {
    pub runs: u64,
    pub total_ms: u64,
    pub peak_mem_bytes: u64,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetCounters {
    pub http: NetTotals,
    pub grpc: NetTotals,
    pub sse: NetTotals,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteCounters {
    pub state: WriteTotals,
    pub settings: WriteTotals,
    pub workspace: WriteTotals,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Counters {
    pub net: NetCounters,
    pub disk_writes: WriteCounters,
    pub scripts: ScriptTotals,
}

#[derive(Default)]
struct NetAtomics {
    sent: AtomicU64,
    received: AtomicU64,
    count: AtomicU64,
}

impl NetAtomics {
    const fn new() -> Self {
        Self {
            sent: AtomicU64::new(0),
            received: AtomicU64::new(0),
            count: AtomicU64::new(0),
        }
    }
    fn read(&self) -> NetTotals {
        NetTotals {
            sent: self.sent.load(Relaxed),
            received: self.received.load(Relaxed),
            count: self.count.load(Relaxed),
        }
    }
}

#[derive(Default)]
struct WriteAtomics {
    count: AtomicU64,
    bytes: AtomicU64,
}

impl WriteAtomics {
    const fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
        }
    }
    fn read(&self) -> WriteTotals {
        WriteTotals {
            count: self.count.load(Relaxed),
            bytes: self.bytes.load(Relaxed),
        }
    }
}

#[derive(Default)]
pub struct Metrics {
    net: [NetAtomics; 3],
    writes: [WriteAtomics; 3],
    script_runs: AtomicU64,
    script_ms: AtomicU64,
    script_peak: AtomicU64,
}

/// The app's counters; `Metrics::default()` gives tests their own.
pub static METRICS: Metrics = Metrics::new();

impl Metrics {
    pub const fn new() -> Self {
        Self {
            net: [NetAtomics::new(), NetAtomics::new(), NetAtomics::new()],
            writes: [
                WriteAtomics::new(),
                WriteAtomics::new(),
                WriteAtomics::new(),
            ],
            script_runs: AtomicU64::new(0),
            script_ms: AtomicU64::new(0),
            script_peak: AtomicU64::new(0),
        }
    }

    pub fn record_net(&self, proto: NetProto, sent: u64, received: u64) {
        let n = &self.net[proto as usize];
        n.sent.fetch_add(sent, Relaxed);
        n.received.fetch_add(received, Relaxed);
        n.count.fetch_add(1, Relaxed);
    }

    pub fn record_disk_write(&self, kind: DiskKind, bytes: u64) {
        let w = &self.writes[kind as usize];
        w.count.fetch_add(1, Relaxed);
        w.bytes.fetch_add(bytes, Relaxed);
    }

    pub fn record_script(&self, elapsed_ms: u64, mem_bytes: u64) {
        self.script_runs.fetch_add(1, Relaxed);
        self.script_ms.fetch_add(elapsed_ms, Relaxed);
        self.script_peak.fetch_max(mem_bytes, Relaxed);
    }

    /// Cumulative totals; `scripts.peak_mem_bytes` is the max since the previous call (reset to 0).
    pub fn snapshot(&self) -> Counters {
        Counters {
            net: NetCounters {
                http: self.net[NetProto::Http as usize].read(),
                grpc: self.net[NetProto::Grpc as usize].read(),
                sse: self.net[NetProto::Sse as usize].read(),
            },
            disk_writes: WriteCounters {
                state: self.writes[DiskKind::State as usize].read(),
                settings: self.writes[DiskKind::Settings as usize].read(),
                workspace: self.writes[DiskKind::Workspace as usize].read(),
            },
            scripts: ScriptTotals {
                runs: self.script_runs.load(Relaxed),
                total_ms: self.script_ms.load(Relaxed),
                peak_mem_bytes: self.script_peak.swap(0, Relaxed),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn net_totals_add_up_per_protocol() {
        let m = Metrics::default();
        m.record_net(NetProto::Http, 10, 100);
        m.record_net(NetProto::Http, 5, 50);
        m.record_net(NetProto::Sse, 1, 2);
        let c = m.snapshot();
        assert_eq!(
            (c.net.http.sent, c.net.http.received, c.net.http.count),
            (15, 150, 2)
        );
        assert_eq!(
            (c.net.sse.sent, c.net.sse.received, c.net.sse.count),
            (1, 2, 1)
        );
        assert_eq!(c.net.grpc.count, 0);
    }

    #[test]
    fn disk_writes_count_per_kind() {
        let m = Metrics::default();
        m.record_disk_write(DiskKind::State, 300);
        m.record_disk_write(DiskKind::State, 200);
        let c = m.snapshot();
        assert_eq!(
            (c.disk_writes.state.count, c.disk_writes.state.bytes),
            (2, 500)
        );
        assert_eq!(c.disk_writes.workspace.count, 0);
    }

    #[test]
    fn script_peak_resets_after_snapshot() {
        let m = Metrics::default();
        m.record_script(5, 1_000);
        m.record_script(7, 4_000);
        let c = m.snapshot();
        assert_eq!(
            (c.scripts.runs, c.scripts.total_ms, c.scripts.peak_mem_bytes),
            (2, 12, 4_000)
        );
        assert_eq!(m.snapshot().scripts.peak_mem_bytes, 0);
        assert_eq!(m.snapshot().scripts.runs, 2); // totals stay cumulative
    }
}
