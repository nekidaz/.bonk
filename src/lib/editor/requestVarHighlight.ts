/**
 * Store-side wiring for the framework-free `variableHighlight` extension
 * (varDecorations.ts). Components call this from a `$derived` over the three
 * variable stores, so a new Extension instance is produced whenever globals /
 * environments / the active selection change — CodeEditor then swaps it in via
 * its var compartment and the decorations flip without a remount.
 */
import { get } from 'svelte/store';
import { t } from '../i18n';
import type { Extension } from '@codemirror/state';
import type { Environment, VarRow } from '../domain/types';
import { lookupVar } from '../domain/vars';
import { environments, globals, setEnvVars, setGlobalVars } from '../stores';
import { variableHighlight } from './varDecorations';

/**
 * Build the `{{var}}` highlight extension for the given scope snapshot. Pass
 * the *subscribed* store values (`$globals`, `$environments`,
 * `$activeEnvironmentId`) so the caller's `$derived` re-runs on any change.
 * `onAdd` reads the stores fresh (via `get`) at click time, so a quick-set
 * never clobbers rows edited after this snapshot was taken.
 */
export function requestVariableHighlight(
  globalRows: VarRow[],
  envs: Environment[],
  activeEnvId: string | null,
): Extension {
  const active = activeEnvId !== null ? envs.find((e) => e.id === activeEnvId) : undefined;
  return variableHighlight({
    getScopeInfo(name) {
      const hit = lookupVar(name, globalRows, active);
      if (!hit) return null;
      return {
        value: hit.value,
        scopeLabel: hit.source === 'env' && active ? get(t)('env.scope', { name: active.name }) : get(t)('env.scope_globals'),
      };
    },
    activeEnvName: () => active?.name ?? null,
    onAdd(name, value, target) {
      const key = name.trim();
      if (key === '') return;
      const row: VarRow = { key, value, enabled: true };
      if (target === 'env') {
        if (!active) return;
        const current = get(environments).find((e) => e.id === active.id);
        if (!current) return;
        setEnvVars(current.id, [...current.vars, row]);
      } else {
        setGlobalVars([...get(globals), row]);
      }
    },
    onUpdate(name, value) {
      const key = name.trim();
      if (key === '') return;
      // Re-read the stores at click time and re-resolve which scope owns the
      // name, so the write lands where the tooltip's value actually came from.
      const currentEnv =
        active !== undefined ? get(environments).find((e) => e.id === active.id) : undefined;
      const hit = lookupVar(key, get(globals), currentEnv);
      if (!hit) return;
      if (hit.source === 'env' && currentEnv) {
        setEnvVars(currentEnv.id, updateLastEnabled(currentEnv.vars, key, value));
      } else {
        setGlobalVars(updateLastEnabled(get(globals), key, value));
      }
    },
  });
}

/**
 * Overwrite the value of the row that `lookupVar` resolves — the LAST enabled
 * row with a matching (trimmed) key, mirroring its duplicate-wins semantics.
 */
function updateLastEnabled(rows: VarRow[], key: string, value: string): VarRow[] {
  let idx = -1;
  rows.forEach((r, i) => {
    if (r.enabled && r.key.trim() === key) idx = i;
  });
  if (idx === -1) return rows;
  return rows.map((r, i) => (i === idx ? { ...r, value } : r));
}
