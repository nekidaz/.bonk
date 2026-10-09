import { writable, get } from 'svelte/store';
import type { ProxyMode, HttpRequest, Tab, HistoryEntry, TreeNode, Environment, VarRow } from '../domain/types';
import type { Flow } from '../domain/flow';
import { mergeScope } from '../domain/vars';
import { t } from '../i18n';
import { withEffectiveAuth } from '../domain/authInherit';

/**
 * Core store singletons and the lowest-level tab mutators. Feature modules
 * (tabs / workspace / requests / history / git / persistence) all depend on this
 * module and never on each other for these primitives, which keeps the import
 * graph acyclic.
 */

/** fs root rel path. Shared by every workspace/request operation. */
export const ROOT = '';

// No tabs until the user opens one: the main panel shows the welcome / "no open tabs" screen.
export const tabs = writable<Tab[]>([]);
export const activeTabId = writable<string>('');
export const history = writable<HistoryEntry[]>([]);
// 0 = unlimited. Otherwise keep the last N history entries.
export const historyLimit = writable<number>(500);
// While true, new requests are not recorded into history.
export const historyPaused = writable<boolean>(false);
// Pretty response viewers wrap long lines by default; Raw can still be copied unchanged.
export const responseLineWrap = writable<boolean>(true);
// Global request behavior mirrors Postman-style app settings.
export const requestTimeoutMs = writable<number>(30_000);
export const requestFollowRedirects = writable<boolean>(true);
export const requestValidateTls = writable<boolean>(true);
export const responseBodyLimitMb = writable<number>(25);
// Open JSON responses in Pretty (true) or Raw (false) by default.
export const responsePrettyDefault = writable<boolean>(true);
// Network: proxy (system | none | manual) and TLS files (PEM paths), applied to every HTTP send.
export const proxyMode = writable<ProxyMode>('system');
export const proxyUrl = writable<string>('');
export const proxyBypass = writable<string>('');
export const trustedCaPaths = writable<string[]>([]);
// gRPC defaults (consumed by GrpcEditor): deadline in ms and auto server-reflection on connect.
export const grpcDeadlineMs = writable<number>(30_000);
export const grpcAutoReflect = writable<boolean>(true);
export const collections = writable<TreeNode[]>([]);
export const workspacePath = writable<string>('');
export const recentWorkspacePaths = writable<string[]>([]);

// Postman-style variables. Globals apply everywhere; the active environment's
// vars override globals. These live in app-state (persist), NOT workspace files,
// so secrets don't leak into shared collection files.
export const globals = writable<VarRow[]>([]);
export const environments = writable<Environment[]>([]);
export const activeEnvironmentId = writable<string | null>(null);

/** Whether the Environments management sheet (EnvironmentsSheet) is open. */
export const environmentsSheetOpen = writable(false);

// Flows (node-graph orchestration documents). Live in app-state like
// environments — they reference saved requests by id, not by content.
export const flows = writable<Flow[]>([]);

/**
 * The current `{{var}}` resolution scope: globals merged with the active
 * environment (env overrides globals). Read on send / codegen to interpolate
 * placeholders. Returns a plain `name → value` map. `redactSecrets` keeps
 * secret variables as literal `{{key}}` (cURL / code snippets).
 */
export function currentVarScope(redactSecrets = false): Record<string, string> {
  const activeId = get(activeEnvironmentId);
  const active = activeId ? get(environments).find((e) => e.id === activeId) : undefined;
  return mergeScope(get(globals), active, redactSecrets);
}

/** `x` with collection auth resolved into `request.auth` (id = saved request id); use before building/previewing a send. */
export function withInheritedAuth<T extends { request: HttpRequest }>(x: T, id: string | undefined): T {
  return withEffectiveAuth(x, get(collections), id);
}

/** One-shot confirm dialog state; `null` when no dialog is open. `altLabel` adds a third button that resolves `'alt'`. */
export const confirmState = writable<{
  message: string;
  confirmLabel: string;
  altLabel?: string;
  resolve: (ok: boolean | 'alt') => void;
} | null>(null);

/** Show an in-app confirm modal (the Tauri webview has no window.confirm). */
export function requestConfirm(message: string, confirmLabel = get(t)('app.confirm.ok')): Promise<boolean> {
  return requestChoice(message, confirmLabel).then((r) => r === true);
}

/** Three-way confirm: `true` = confirm, `'alt'` = the secondary action (e.g. «Не сохранять»), `false` = cancel. */
export function requestChoice(message: string, confirmLabel: string, altLabel?: string): Promise<boolean | 'alt'> {
  // Resolve any still-open confirm as cancelled so its awaiter never hangs.
  get(confirmState)?.resolve(false);
  return new Promise((resolve) => confirmState.set({ message, confirmLabel, altLabel, resolve }));
}

/** Save-to dialog (folder + name) for the active tab; `copy` = «Сохранить как…». `null` when closed. */
export const saveDialog = writable<{ copy: boolean; resolve: (saved: boolean) => void } | null>(null);

/** Open the save-to dialog; resolves `true` once the request is written, `false` on cancel. */
export function requestSaveDialog(copy = false): Promise<boolean> {
  get(saveDialog)?.resolve(false);
  return new Promise((resolve) => saveDialog.set({ copy, resolve }));
}

/** Production send guard: the request awaiting a typed confirmation; `null` when closed. */
export interface ProductionSend {
  method: string;
  url: string;
  envName: string;
  host: string;
}
export const productionGuard = writable<(ProductionSend & { resolve: (ok: boolean) => void }) | null>(null);

export function requestProductionSend(info: ProductionSend): Promise<boolean> {
  get(productionGuard)?.resolve(false);
  return new Promise((resolve) => productionGuard.set({ ...info, resolve }));
}

export function updateActiveTab(fn: (tab: Tab) => Tab): void {
  const id = get(activeTabId);
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

/** Update a specific tab by id, regardless of which tab is currently active. */
export function updateTabById(id: string, fn: (tab: Tab) => Tab): void {
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

// --- HMR (dev only) ---
// These store singletons hold all in-memory app state; persistence.hydrate()
// fills them from disk once at startup behind a one-shot guard. A partial HMR
// swap re-creates them EMPTY without re-running hydrate(), so the env selector,
// history, and tabs go blank until a manual reload (the on-disk state stays
// intact). Force a clean full reload whenever this module is hot-updated — the
// normal startup path then re-hydrates from disk. Stripped from production
// builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
