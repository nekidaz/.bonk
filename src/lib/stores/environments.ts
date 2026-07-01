import { get } from 'svelte/store';
import type { Environment, VarRow } from '../domain/types';
import { environments, activeEnvironmentId, globals } from './state';

/**
 * Environment + variable CRUD. Depends only on `state` (never on other feature
 * modules), keeping the stores import graph acyclic. The EnvironmentsModal and
 * the AppTabBar selector drive everything through these helpers.
 */

/** Create a new environment, append it, make it active, and return its id. */
export function addEnvironment(name = 'New Environment'): string {
  const id = crypto.randomUUID();
  const env: Environment = { id, name: name.trim() || 'New Environment', vars: [] };
  environments.update((list) => [...list, env]);
  activeEnvironmentId.set(id);
  return id;
}

/** Rename an environment in place (no-op if the id is unknown). */
export function renameEnvironment(id: string, name: string): void {
  environments.update((list) =>
    list.map((e) => (e.id === id ? { ...e, name: name.trim() || e.name } : e)),
  );
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
