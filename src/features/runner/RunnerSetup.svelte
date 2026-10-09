<script lang="ts">
  /**
   * Runner R2 «Настройка прогона»: which requests run and in what order
   * (checks, drag to reorder, "only the failed ones"), plus environment, data
   * file, iterations, delay and stop-on-failure, and what will be sent.
   * Shared atoms (.rn-eyebrow, .rn-btn …) are styled by RunnerView.
   */
  import { findNode, parentId, workspace } from '$entities/workspace';
  import { environments } from '$entities/environment';
  import {
    setExcluded,
    setRunOrder,
    setRunnerStage,
    setIterations,
    setDelay,
    setStopOnFailure,
    setSaveResponses,
    savePreset,
    loadDataRows,
    clearData,
    runCollection,
    runner,
  } from './store.svelte';
  import { runnerScopeTitle, orderedRequests } from './runnerPlan';
  import { EnvironmentSelector } from '$entities/environment/components';
  import { parseDataFile } from './runnerData';
  import { methodColor, type RequestNode } from '$shared/model';
  import { testCount, varLinks } from './runnerStats';
  import { t, tp } from '$shared/i18n';

  const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

  const cfg = $derived(runner.config);
  const scope = $derived(cfg.folderIds.filter((id) => findNode(workspace.tree, id)));
  const title = $derived(runnerScopeTitle(scope, workspace.tree, t));
  const all = $derived(orderedRequests(cfg, workspace.tree));
  const on = (n: RequestNode) => !cfg.excludedIds.includes(n.id);
  const planned = $derived(all.filter(on));
  const links = $derived(varLinks(planned));
  const linkOf = (n: RequestNode) => links[planned.indexOf(n)];
  const methodOf = (n: RequestNode) => (n.protocol === 'grpc' ? 'gRPC' : n.request.method);

  // A folder header precedes each run of requests from a sub-folder of the scope.
  const rows = $derived.by(() => {
    const out: (
      { kind: 'folder'; id: string; name: string; ids: string[] } | { kind: 'req'; node: RequestNode; no: number }
    )[] = [];
    let last: string | undefined;
    let no = 0;
    for (const n of all) {
      const p = parentId(n.id);
      if (p !== last && p && !scope.includes(p)) {
        out.push({ kind: 'folder', id: p, name: findNode(workspace.tree, p)?.name ?? '', ids: [] });
      }
      last = p;
      const head = out.findLast((r) => r.kind === 'folder');
      if (head?.kind === 'folder' && head.id === p) head.ids.push(n.id);
      out.push({ kind: 'req', node: n, no: on(n) ? ++no : 0 });
    }
    return out;
  });

  function setChecked(ids: string[], checked: boolean): void {
    setExcluded(checked ? cfg.excludedIds.filter((x) => !ids.includes(x)) : [...new Set([...cfg.excludedIds, ...ids])]);
  }
  const groupState = (ids: string[]) => {
    const n = ids.filter((id) => !cfg.excludedIds.includes(id)).length;
    return { checked: n === ids.length && n > 0, indeterminate: n > 0 && n < ids.length };
  };
  const allState = $derived(groupState(all.map((n) => n.id)));

  // "Только упавшие в #N": the failed calls of the last run in this tab.
  const failedIds = $derived(new Set(runner.run.results.filter((r) => !r.ok && r.nodeId).map((r) => r.nodeId!)));
  const onlyFailed = () => setExcluded(all.filter((n) => !failedIds.has(n.id)).map((n) => n.id));

  // ---- Drag to reorder ----
  let dragId = $state<string | null>(null);
  let overId = $state<string | null>(null);
  function drop(targetId: string): void {
    if (dragId && dragId !== targetId) {
      const ids = all.map((n) => n.id).filter((id) => id !== dragId);
      ids.splice(ids.indexOf(targetId), 0, dragId);
      setRunOrder(ids);
    }
    dragId = overId = null;
  }

  // ---- Settings ----
  const env = $derived(environments.active);
  const dataDriven = $derived(cfg.dataRows.length > 0);
  const iterations = $derived(dataDriven ? cfg.dataRows.length : cfg.iterations);
  let fileInput: HTMLInputElement | undefined = $state();
  let dataError = $state('');
  async function onFilePicked(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;
    dataError = '';
    try {
      const parsed = parseDataFile(file.name, await file.text());
      if (parsed.length === 0) dataError = t('runner.dataEmpty');
      else loadDataRows(file.name, parsed);
    } catch (err) {
      dataError = err instanceof Error ? err.message : String(err);
    }
  }

  let presetSaved = $state(false);
  function doSavePreset(): void {
    savePreset();
    presetSaved = true;
    setTimeout(() => (presetSaved = false), 1400);
  }

  // ---- Will be sent ----
  const calls = $derived(planned.length * iterations);
  const estimate = $derived.by(() => {
    // ponytail: p95 of the last run per call — a rough upper bound, enough for "~N s".
    const perCall = runner.history.at(-1)?.p95Ms || 150;
    return Math.max(1, Math.round((calls * perCall + cfg.delayMs * Math.max(0, calls - 1)) / 1000));
  });
  const mutating = $derived(planned.filter((n) => MUTATING.includes(methodOf(n))));
  const mutatingText = $derived.by(() => {
    const n = mutating.length * iterations;
    const methods = MUTATING.filter((m) => mutating.some((x) => methodOf(x) === m)).join(', ');
    const word = tp(n, ['изменяющий', 'изменяющих', 'изменяющих'], ['mutating', 'mutating']);
    return env
      ? t('runner.setup.mutatingIn', { n, word, methods, env: env.name })
      : t('runner.setup.mutating', { n, word, methods });
  });
</script>

{#snippet check(state: { checked: boolean; indeterminate: boolean }, onchange: (v: boolean) => void, label: string)}
  <input
    class="rs-check"
    type="checkbox"
    checked={state.checked}
    indeterminate={state.indeterminate}
    aria-label={label}
    onchange={(e) => onchange(e.currentTarget.checked)}
  />
{/snippet}

<header class="rs-head">
  <div class="rs-crumb">
    <div class="rn-eyebrow">{t('runner.setup.crumb')}</div>
    <div class="rs-titlerow">
      <h2 class="rs-title" {title}>{title}</h2>
      <button class="rs-change" type="button" onclick={() => setRunnerStage('pick')}>
        <span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>{t('runner.setup.change')}
      </button>
    </div>
  </div>
  <button class="rn-btn" type="button" onclick={doSavePreset} disabled={all.length === 0}>
    <span class="material-symbols-outlined" aria-hidden="true">{presetSaved ? 'check' : 'bookmark_add'}</span
    >{presetSaved ? t('runner.preset.saved') : t('runner.preset.save')}
  </button>
  <button class="rn-btn primary" type="button" onclick={() => void runCollection()} disabled={planned.length === 0}>
    <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span><b
      >{t('runner.setup.run', { n: planned.length, total: all.length })}</b
    ><kbd>⌘R</kbd>
  </button>
</header>

<div class="rs-split">
  <section class="rs-list">
    <div class="rs-listhead">
      {@render check(
        allState,
        (v) =>
          setChecked(
            all.map((n) => n.id),
            v,
          ),
        t('runner.col.request'),
      )}
      <span class="rn-eyebrow">{t('runner.setup.requests', { n: planned.length, total: all.length })}</span>
      <span class="sp"></span>
      {#if failedIds.size > 0}
        <button class="rs-pill" type="button" onclick={onlyFailed}>
          <span class="material-symbols-outlined" aria-hidden="true">replay</span>{t('runner.setup.onlyFailed', {
            n: runner.run.n,
          })}
        </button>
      {/if}
      <span class="rs-hint">{t('runner.setup.drag')}</span>
    </div>
    <div class="rs-scroll">
      {#each rows as r (r.kind === 'folder' ? `f:${r.id}` : r.node.id)}
        {#if r.kind === 'folder'}
          <div class="rs-folder">
            {@render check(groupState(r.ids), (v) => setChecked(r.ids, v), r.name)}
            <span class="material-symbols-outlined" aria-hidden="true">folder</span>{r.name}
          </div>
        {:else}
          {@const n = r.node}
          {@const link = linkOf(n)}
          {@const tests = testCount(n)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="rs-row"
            class:off={!on(n)}
            class:over={overId === n.id && dragId !== n.id}
            draggable="true"
            ondragstart={(e) => {
              dragId = n.id;
              e.dataTransfer?.setData('text/plain', n.id);
            }}
            ondragend={() => (dragId = overId = null)}
            ondragover={(e) => {
              if (!dragId) return;
              e.preventDefault();
              overId = n.id;
            }}
            ondrop={(e) => {
              e.preventDefault();
              drop(n.id);
            }}
          >
            <span class="material-symbols-outlined rs-grip" aria-hidden="true">drag_indicator</span>
            {@render check({ checked: on(n), indeterminate: false }, (v) => setChecked([n.id], v), n.name)}
            <span class="rs-no">{r.no ? String(r.no).padStart(2, '0') : '–'}</span>
            <b class="rs-method" style="color:{methodColor(n.protocol === 'grpc' ? 'GRPC' : n.request.method)}"
              >{methodOf(n)}</b
            >
            <span class="rs-name" title={n.name}>{n.name}</span>
            {#if link}
              {#each link.sets as v (v)}
                <span class="rs-var sets" title={t('runner.setup.sets', { name: v })}
                  ><span class="material-symbols-outlined" aria-hidden="true">output</span>{`{{${v}}}`}</span
                >
              {/each}
              {#each link.uses as v (v)}
                <span class="rs-var" title={t('runner.setup.uses', { name: v })}
                  ><span class="material-symbols-outlined" aria-hidden="true">link</span>{`{{${v}}}`}</span
                >
              {/each}
            {/if}
            <span class="rs-tests"
              >{tests ? `${tests} ${tp(tests, ['тест', 'теста', 'тестов'], ['test', 'tests'])}` : ''}</span
            >
          </div>
        {/if}
      {/each}
      {#if all.length === 0}<p class="rn-muted rs-empty">{t('runner.empty')}</p>{/if}
    </div>
  </section>

  <aside class="rs-side">
    <div class="rs-card">
      <div class="rs-set">
        <span class="rs-lbl">{t('runner.setup.env')}</span>
        <span class="rs-env"><EnvironmentSelector /></span>
      </div>
      <div class="rs-set">
        <span class="rs-lbl">{t('runner.setup.data')}<small>{t('runner.setup.dataDesc')}</small></span>
        {#if cfg.dataFileName}
          <span class="rs-file"
            >{cfg.dataFileName}<button type="button" aria-label={t('runner.dataRemove')} onclick={clearData}
              ><span class="material-symbols-outlined" aria-hidden="true">close</span></button
            ></span
          >
        {:else}
          <button class="rn-btn sm" type="button" onclick={() => fileInput?.click()}>{t('runner.dataPick')}</button>
        {/if}
        <input bind:this={fileInput} type="file" accept=".csv,.json" onchange={onFilePicked} hidden />
      </div>
      {#if dataError}<div class="rn-err" role="alert">{dataError}</div>{/if}
      <div class="rs-set">
        <span class="rs-lbl"
          >{t('runner.setup.iter')}{#if dataDriven}<small
              >{t('runner.setup.iterFile', {
                n: iterations,
                rows: tp(iterations, ['строка', 'строки', 'строк'], ['row', 'rows']),
              })}</small
            >{/if}</span
        >
        <input
          class="rs-num"
          type="number"
          min="1"
          value={iterations}
          disabled={dataDriven}
          aria-label={t('runner.setup.iter')}
          oninput={(e) => setIterations(Number(e.currentTarget.value))}
        />
      </div>
      <div class="rs-set">
        <span class="rs-lbl">{t('runner.setup.delay')}<small>{t('runner.setup.delayDesc')}</small></span>
        <label class="rs-num unit"
          ><input
            type="number"
            min="0"
            step="50"
            value={cfg.delayMs}
            aria-label={t('runner.setup.delay')}
            oninput={(e) => setDelay(Number(e.currentTarget.value))}
          /><span>ms</span></label
        >
      </div>
      <div class="rs-set">
        <span class="rs-lbl">{t('runner.stopOnFail')}</span>
        <button
          class="mono-switch sm"
          type="button"
          role="switch"
          aria-checked={cfg.stopOnFailure}
          aria-label={t('runner.stopOnFail')}
          onclick={() => setStopOnFailure(!cfg.stopOnFailure)}
        ></button>
      </div>
      <div class="rs-set">
        <span class="rs-lbl">{t('runner.saveResponses')}<small>{t('runner.saveResponses.desc')}</small></span>
        <button
          class="mono-switch sm"
          type="button"
          role="switch"
          aria-checked={cfg.saveResponses}
          aria-label={t('runner.saveResponses')}
          onclick={() => setSaveResponses(!cfg.saveResponses)}
        ></button>
      </div>
    </div>

    <div class="rs-card rs-sum">
      <div class="rn-eyebrow">{t('runner.setup.willSend')}</div>
      <div class="rs-sumrow">
        <b>{calls}</b><span
          >{tp(calls, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])} · ~{estimate} s</span
        >
      </div>
      {#if mutating.length > 0}
        <div class="rs-warn">
          <span class="material-symbols-outlined" aria-hidden="true">edit_note</span>{mutatingText}
        </div>
      {/if}
    </div>
  </aside>
</div>

<style>
  .rs-head {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    flex: none;
  }
  .rs-crumb {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rs-titlerow {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .rs-title {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 22px/27px var(--font-ui);
    letter-spacing: -0.5px;
  }
  .rs-change {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 12px var(--font-ui);
  }
  .rs-change:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .rs-change .material-symbols-outlined {
    font-size: 15px;
  }

  .rs-split {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
  }
  .rs-list {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 5px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .rs-listhead {
    height: 38px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
  }
  .rs-listhead .sp {
    flex: 1;
  }
  .rs-pill {
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    color: var(--color-text);
    font: 500 11px var(--font-ui);
  }
  .rs-pill:hover {
    border-color: var(--color-border);
  }
  .rs-pill .material-symbols-outlined {
    font-size: 14px;
    color: var(--color-danger);
  }
  .rs-hint {
    color: var(--color-text-muted);
    font: 11px var(--font-ui);
    white-space: nowrap;
  }
  .rs-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rs-check {
    appearance: none;
    flex: none;
    width: 16px;
    height: 16px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1px solid var(--color-border);
    border-radius: 5px;
    background: transparent;
  }
  .rs-check:checked,
  .rs-check:indeterminate {
    border-color: var(--color-action);
    background: var(--color-action);
  }
  .rs-check:checked::after {
    content: '';
    width: 7px;
    height: 4px;
    margin-top: -2px;
    border: solid var(--color-on-action);
    border-width: 0 0 1.6px 1.6px;
    transform: rotate(-45deg);
  }
  .rs-check:indeterminate::after {
    content: '';
    width: 8px;
    height: 1.6px;
    background: var(--color-on-action);
  }
  .rs-check:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }
  .rs-folder {
    height: 34px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px 0 38px;
    color: var(--color-text);
    font: 600 12px var(--font-ui);
  }
  .rs-folder .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .rs-row {
    height: 34px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    border-radius: var(--radius-control);
  }
  .rs-row:hover {
    background: var(--color-hover);
  }
  .rs-row.over {
    box-shadow: inset 0 2px 0 var(--color-action);
  }
  .rs-row.off {
    opacity: 0.45;
  }
  .rs-grip {
    flex: none;
    width: 14px;
    font-size: 15px;
    color: var(--color-text-muted);
    cursor: grab;
  }
  .rs-no {
    flex: none;
    width: 18px;
    color: var(--color-text-muted);
    font: 10px var(--font-code);
  }
  .rs-method {
    flex: none;
    width: 50px;
    font: 600 10px var(--font-code);
    letter-spacing: 0.4px;
  }
  .rs-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 13px var(--font-ui);
  }
  .rs-var {
    flex: none;
    height: 20px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--color-var-soft);
    color: var(--color-var);
    font: 10px var(--font-code);
  }
  .rs-var.sets {
    background: none;
    box-shadow: inset 0 0 0 1px var(--color-var);
  }
  .rs-var .material-symbols-outlined {
    font-size: 12px;
  }
  .rs-tests {
    flex: none;
    min-width: 48px;
    text-align: right;
    color: var(--color-text-muted);
    font: 10px var(--font-code);
  }
  .rs-empty {
    margin: 16px 12px;
  }

  .rs-side {
    flex: none;
    width: 330px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
  }
  .rs-card {
    display: flex;
    flex-direction: column;
    padding: 4px 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .rs-set {
    min-height: 50px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
  }
  .rs-set + .rs-set {
    border-top: 1px solid var(--color-border-subtle);
  }
  .rs-lbl {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--color-text);
    font: 500 12px var(--font-ui);
  }
  .rs-lbl small {
    color: var(--color-text-muted);
    font: 10px/13px var(--font-ui);
  }
  .rs-env :global(.bs-env-menu) {
    right: 0;
  }
  .rs-file {
    flex: none;
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 10px;
    border-radius: 999px;
    background: var(--color-var-soft);
    color: var(--color-var);
    font: 11px var(--font-code);
  }
  .rs-file button {
    display: inline-flex;
    color: inherit;
  }
  .rs-file .material-symbols-outlined {
    font-size: 14px;
  }
  .rs-num,
  .rs-num.unit {
    flex: none;
    width: 72px;
    height: 32px;
    box-sizing: border-box;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    background: var(--color-panel);
    color: var(--color-text);
    font: 12px var(--font-code);
  }
  .rs-num.unit {
    width: 92px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .rs-num.unit input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: inherit;
    font: inherit;
  }
  .rs-num.unit span {
    color: var(--color-text-muted);
    font-size: 10px;
  }
  .rs-num:disabled {
    opacity: 0.6;
  }
  .rs-num::-webkit-inner-spin-button,
  .rs-num input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .rs-sum {
    gap: 6px;
    padding: 12px 14px;
  }
  .rs-sumrow {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .rs-sumrow b {
    font: 600 22px/27px var(--font-code);
  }
  .rs-sumrow span {
    color: var(--color-text-secondary);
    font: 12px var(--font-ui);
  }
  .rs-warn {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-warning);
    font: 11px/14px var(--font-ui);
  }
  .rs-warn .material-symbols-outlined {
    font-size: 14px;
  }
</style>
