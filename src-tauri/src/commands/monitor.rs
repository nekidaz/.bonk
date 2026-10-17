// --- Dev-only Resources tab: one snapshot per second (logic: bonk_core::infra::{procmon, metrics}) ---

use std::collections::HashMap;
use std::sync::Mutex;

use bonk_core::infra::metrics::{now_ms, Counters, METRICS};
use bonk_core::infra::procmon::ProcStat;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// Sizes of the runtime maps in `AppState`: what is open or running right now.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveCounts {
    pub http_clients: usize,
    pub grpc_conns: usize,
    pub grpc_streams: usize,
    pub live_streams: usize,
    pub in_flight: usize,
    pub runs: usize,
    pub pending_inputs: usize,
    pub oauth_logins: usize,
    pub terminals: usize,
    pub watcher_on: bool,
    pub cookie_jars: usize,
    pub cookies: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    pub at_ms: u64,
    pub procs: Vec<ProcStat>,
    pub counters: Counters,
    pub live: LiveCounts,
}

/// Length of a map behind a mutex; a poisoned lock reads as 0 (this is a monitor, not a gate).
fn len<K, V>(m: &Mutex<HashMap<K, V>>) -> usize {
    m.lock().map_or(0, |m| m.len())
}

/// `detailed` (the tab is visible) adds thread and open-file counts per process.
/// Async so the process scan runs off the main thread.
#[tauri::command]
pub async fn monitor_snapshot(
    state: State<'_, AppState>,
    detailed: bool,
) -> Result<MonitorSnapshot, String> {
    let procs = state
        .monitor
        .lock()
        .map(|mut m| m.sample(detailed))
        .unwrap_or_default();
    let (cookie_jars, cookies) = state.cookie_counts();
    let live = LiveCounts {
        http_clients: state.http_client_count(),
        grpc_conns: len(&state.conns),
        grpc_streams: len(&state.grpc_streams),
        live_streams: len(&state.stream_stops),
        in_flight: len(&state.cancels),
        runs: len(&state.runs),
        pending_inputs: len(&state.inputs),
        oauth_logins: len(&state.oauth_logins),
        terminals: len(&state.ptys),
        watcher_on: state.workspace_watcher.lock().is_ok_and(|w| w.is_some()),
        cookie_jars,
        cookies,
    };
    let at_ms = now_ms();
    METRICS.touch_at(at_ms);
    Ok(MonitorSnapshot {
        at_ms,
        procs,
        counters: METRICS.snapshot(),
        live,
    })
}
