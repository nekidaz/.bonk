import { untrack } from 'svelte';

/**
 * Per-tab runtime state for in-flight requests, shared so the
 * gRPC/HTTP editor components can read/write it without prop-drilling.
 *
 * Both maps are keyed by tab id: a request started in tab A must never show
 * busy/error state in tab B. Entries are REMOVED (key deleted) when idle —
 * never set to an "idle" sentinel — matching the original App.svelte logic.
 */

/**
 * One in-flight request for a tab. `requestId` lets Cancel target the right
 * backend request (absent for `connect`, which can't be cancelled).
 */
export type BusyEntry = {
  kind: 'http' | 'invoke' | 'connect';
  requestId?: string;
  startedAt?: number;
  /** Client/bidi stream still accepting messages (until End). */
  writable?: boolean;
};

/** A gRPC error shown for a tab; `code` is set for backend failures (`GrpcErrorCode` in Rust). */
export type GrpcTabError = { message: string; code?: string };

class RequestRuntime {
  /** Per-tab in-flight map. Absent key = that tab is idle. */
  busy = $state.raw<Record<string, BusyEntry>>({});
  /** Per-tab gRPC error. Absent key = no error for that tab. */
  grpcErrors = $state.raw<Record<string, GrpcTabError>>({});

  /** Replace `busy` with `fn(busy)`; reads untracked, so it is safe inside an $effect. */
  updateBusy(fn: (m: Record<string, BusyEntry>) => Record<string, BusyEntry>): void {
    this.busy = fn(untrack(() => this.busy));
  }

  setGrpcError(tabId: string, message: string, code?: string): void {
    this.grpcErrors = { ...untrack(() => this.grpcErrors), [tabId]: { message, code } };
  }

  clearGrpcError(tabId: string): void {
    const current = untrack(() => this.grpcErrors);
    if (!(tabId in current)) return;
    const { [tabId]: _removed, ...rest } = current;
    this.grpcErrors = rest;
  }
}
export const requestRuntime = new RequestRuntime();
