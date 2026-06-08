import { writable } from 'svelte/store';

/**
 * Per-tab runtime state for in-flight requests, shared via stores so the
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
export type BusyEntry = { kind: 'http' | 'invoke' | 'connect'; requestId?: string };

/** Per-tab in-flight map. Absent key = that tab is idle. */
export const busyMap = writable<Record<string, BusyEntry>>({});

/** Per-tab gRPC error text. Absent key = no error for that tab. */
export const grpcErrorMap = writable<Record<string, string>>({});
