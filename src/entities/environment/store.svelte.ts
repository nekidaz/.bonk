import { t } from '$shared/i18n';
import { type Environment, type Tab, type VarRow, mergeScope } from '$shared/model';
import { mcpPrefs } from './mcpPrefs';
import { autoAllowNewEnv, renameEnvAllowance } from './mcpEnvs';
import { tabs } from '$entities/tab';

// Postman-style variables. Globals apply everywhere; the active environment's
// vars override globals. These live in app-state (persist), NOT workspace files,
// so secrets don't leak into shared collection files.
class Environments {
  /** Global variables. Replaced, never mutated in place. */
  globals = $state.raw<VarRow[]>([]);
  /** All environments. Replaced, never mutated in place. */
  list = $state.raw<Environment[]>([]);
  /** The selected environment; null = «No environment». */
  activeId = $state<string | null>(null);
  /** The selected environment, if any. */
  active = $derived(this.list.find((e) => e.id === this.activeId));
}
export const environments = new Environments();

/**
 * The current `{{var}}` resolution scope: globals merged with the active
 * environment (env overrides globals). Read on send / codegen to interpolate
 * placeholders. Returns a plain `name → value` map. `redactSecrets` keeps
 * secret variables as literal `{{key}}` (cURL / code snippets).
 */
export function currentVarScope(redactSecrets = false): Record<string, string> {
  return mergeScope(environments.globals, environments.active, redactSecrets);
}

/**
 * Environment + variable CRUD. Depends only on `entities/tab` and shared
 * layers (never on other entities), keeping the slice graph acyclic. The Environments tab
 * and the toolbar selector drive everything through these helpers.
 */

/** Open (or focus) the single Environments tab with the environments editor (S31). */
export function openEnvironmentsTab(): void {
  const existing = tabs.list.find((t) => t.protocol === 'env');
  if (existing) {
    tabs.activeId = existing.id;
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
  tabs.activeId = tab.id;
}

/** Create a new environment, append it, make it active, and return its id. */
export function addEnvironment(name = t('env.new')): string {
  const id = crypto.randomUUID();
  // Names must be unique: the AI allow-list (and MCP `environment`) is name-based.
  const base = name.trim() || t('env.new');
  const taken = new Set(environments.list.map((e) => e.name));
  let unique = base;
  for (let n = 2; taken.has(unique); n++) unique = `${base} ${n}`;
  const env: Environment = { id, name: unique, vars: [] };
  environments.list = [...environments.list, env];
  mcpPrefs.current = autoAllowNewEnv(mcpPrefs.current, env); // "allow new environments right away" (S32.8)
  environments.activeId = id;
  return id;
}

/** Rename an environment in place (no-op if the id is unknown). */
export function renameEnvironment(id: string, name: string): void {
  const old = environments.list.find((e) => e.id === id);
  environments.list = environments.list.map((e) => (e.id === id ? { ...e, name: name.trim() || e.name } : e));
  const next = environments.list.find((e) => e.id === id);
  if (old && next) mcpPrefs.current = renameEnvAllowance(mcpPrefs.current, old.name, next); // keep the AI allow-list by name in sync
}

/** Delete an environment; clears the active selection if it was the active one. */
export function deleteEnvironment(id: string): void {
  environments.list = environments.list.filter((e) => e.id !== id);
  if (environments.activeId === id) environments.activeId = null;
}

/** Select the active environment, or `null` for "No environment". */
export function setActiveEnvironment(id: string | null): void {
  environments.activeId = id;
}

/** Replace an environment's variable rows (no-op if the id is unknown). */
export function setEnvVars(id: string, rows: VarRow[]): void {
  environments.list = environments.list.map((e) => (e.id === id ? { ...e, vars: rows } : e));
}

/** Replace the globals variable rows. */
export function setGlobalVars(rows: VarRow[]): void {
  environments.globals = rows;
}

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
