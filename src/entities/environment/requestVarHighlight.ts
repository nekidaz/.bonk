/**
 * Store-side wiring for the framework-free `variableHighlight` extension
 * (varDecorations.ts). Components call this from a `$derived` over the three
 * variable stores, so a new Extension instance is produced whenever globals /
 * environments / the active selection change — CodeEditor then swaps it in via
 * its var compartment and the decorations flip without a remount.
 */
import { t } from '$shared/i18n';
import type { Extension } from '@codemirror/state';
import { type Environment, type VarRow, lookupVar } from '$shared/model';
import { ENV_COLOR_VAR, envColor } from './palette';
import { environments, openEnvironmentsTab, setEnvVars, setGlobalVars } from './store.svelte';
import { variableHighlight } from './varDecorations';
import { askUi, inputs } from '$entities/input';
import { dynamicSample, dynamicSamplesLoaded, openDynamicCatalog, refreshDynamicSamples } from './dynamic.svelte';

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
  // Read here, not in the callbacks, so the caller's `$derived` rebuilds when a field is added or removed.
  const asked = inputs.defs;
  const active = activeEnvId !== null ? envs.find((e) => e.id === activeEnvId) : undefined;
  const globalsSource = { name: t('env.scope_globals') };
  const source = (env: Environment) => ({ name: env.name, color: ENV_COLOR_VAR[envColor(env)] });
  const findRow = (rows: VarRow[], key: string) => rows.findLast((r) => r.enabled && r.key.trim() === key);
  return variableHighlight({
    getScopeInfo(name) {
      const key = name.trim();
      const envRow = active ? findRow(active.vars, key) : undefined;
      const globalRow = findRow(globalRows, key);
      if (active && envRow) {
        return {
          value: envRow.value,
          source: source(active),
          global: false,
          secret: !!envRow.secret,
          shadowed: globalRow && !globalRow.secret ? globalRow.value : undefined,
        };
      }
      if (!globalRow) return null;
      return { value: globalRow.value, source: globalsSource, global: true, secret: !!globalRow.secret };
    },
    addTarget: () => (active ? source(active) : globalsSource),
    envsWith: (name) => envs.filter((e) => e !== active && findRow(e.vars, name.trim())).map(source),
    onOpenEnvs: openEnvironmentsTab,
    ask: {
      isAsked: (name) => name in asked,
      onContext: (name, at) => askUi.openMenu(name, at),
      onSettings: (name, rect) => askUi.openSettings(name, rect),
    },
    dynamic: {
      sample: dynamicSample,
      samplesLoaded: dynamicSamplesLoaded,
      refreshSamples: refreshDynamicSamples,
      onOpenCatalog: openDynamicCatalog,
      variables() {
        // The active environment wins over globals, like resolution; `$` names are reserved.
        const scope = new Map<string, string>();
        for (const row of [...globalRows, ...(active?.vars ?? [])]) {
          const key = row.key.trim();
          if (row.enabled && key && !key.startsWith('$')) scope.set(key, row.secret ? '••••••••' : row.value);
        }
        return [...scope].map(([name, value]) => ({ name, value }));
      },
    },
    onAdd(name, value) {
      const key = name.trim();
      if (key === '') return;
      const row: VarRow = { key, value, enabled: true };
      if (active) {
        const current = environments.list.find((e) => e.id === active.id);
        if (!current) return;
        setEnvVars(current.id, [...current.vars, row]);
      } else {
        setGlobalVars([...environments.globals, row]);
      }
    },
    onUpdate(name, value) {
      const key = name.trim();
      if (key === '') return;
      // Re-read the stores at click time and re-resolve which scope owns the
      // name, so the write lands where the tooltip's value actually came from.
      const currentEnv = active !== undefined ? environments.list.find((e) => e.id === active.id) : undefined;
      const hit = lookupVar(key, environments.globals, currentEnv);
      if (!hit) return;
      if (hit.source === 'env' && currentEnv) {
        setEnvVars(currentEnv.id, updateLastEnabled(currentEnv.vars, key, value));
      } else {
        setGlobalVars(updateLastEnabled(environments.globals, key, value));
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
