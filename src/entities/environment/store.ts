import { get, writable } from 'svelte/store';
import { t } from '$shared/i18n';
import { type Environment, type Tab, type VarRow, mergeScope } from '$shared/model';
import { mcpPrefs } from './mcpPrefs';
import { autoAllowNewEnv, renameEnvAllowance } from './mcpEnvs';
import { tabs, activeTabId } from '$entities/tab';

// Postman-style variables. Globals apply everywhere; the active environment's
// vars override globals. These live in app-state (persist), NOT workspace files,
// so secrets don't leak into shared collection files.
export const globals = writable<VarRow[]>([]);
export const environments = writable<Environment[]>([]);
export const activeEnvironmentId = writable<string | null>(null);

/** Whether the Environments management sheet (EnvironmentsSheet) is open. */
export const environmentsSheetOpen = writable(false);

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

/**
 * Environment + variable CRUD. Depends only on `state` (never on other feature
 * modules), keeping the stores import graph acyclic. The EnvironmentsSheet
 * and the toolbar selector drive everything through these helpers.
 */

/** Open (or focus) the single Environments tab; it hosts the same editor as the sheet. */
export function openEnvironmentsTab(): void {
  const existing = get(tabs).find((t) => t.protocol === 'env');
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'env',
    title: 'Environments',
    manualTitle: true,
    request: { method: 'ENV', url: '', headers: {} },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

/** S31: «Manage environments» in the environment dropdown opens the sheet. */
export function openEnvironmentsSheet(): void {
  environmentsSheetOpen.set(true);
}

/** Create a new environment, append it, make it active, and return its id. */
export function addEnvironment(name = get(t)('env.new')): string {
  const id = crypto.randomUUID();
  // Names must be unique: the AI allow-list (and MCP `environment`) is name-based.
  const base = name.trim() || get(t)('env.new');
  const taken = new Set(get(environments).map((e) => e.name));
  let unique = base;
  for (let n = 2; taken.has(unique); n++) unique = `${base} ${n}`;
  const env: Environment = { id, name: unique, vars: [] };
  environments.update((list) => [...list, env]);
  mcpPrefs.update((p) => autoAllowNewEnv(p, env)); // "allow new environments right away" (S32.8)
  activeEnvironmentId.set(id);
  return id;
}

/** Rename an environment in place (no-op if the id is unknown). */
export function renameEnvironment(id: string, name: string): void {
  const old = get(environments).find((e) => e.id === id);
  environments.update((list) => list.map((e) => (e.id === id ? { ...e, name: name.trim() || e.name } : e)));
  const next = get(environments).find((e) => e.id === id);
  if (old && next) mcpPrefs.update((p) => renameEnvAllowance(p, old.name, next)); // keep the AI allow-list by name in sync
}

/** Delete an environment; clears the active selection if it was the active one. */
export function deleteEnvironment(id: string): void {
  environments.update((list) => list.filter((e) => e.id !== id));
  if (get(activeEnvironmentId) === id) activeEnvironmentId.set(null);
}

/** Select the active environment, or `null` for "No environment". */
export function setActiveEnvironment(id: string | null): void {
  activeEnvironmentId.set(id);
}

/** Replace an environment's variable rows (no-op if the id is unknown). */
export function setEnvVars(id: string, rows: VarRow[]): void {
  environments.update((list) => list.map((e) => (e.id === id ? { ...e, vars: rows } : e)));
}

/** Replace the globals variable rows. */
export function setGlobalVars(rows: VarRow[]): void {
  globals.set(rows);
}

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
