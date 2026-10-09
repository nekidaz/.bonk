<script lang="ts">
  /**
   * Collection Runner (S36), shown as a full-pane 'runner' tab (see openRunnerTab).
   * Stages: R1 pick a collection (RunnerPick), R2 set the run up (RunnerSetup),
   * then the run itself — R3 while it goes (progress strip + live log, pause /
   * stop) and R4 once it is done (summary with deltas to the previous run, the
   * requests × iterations matrix with a waterfall, the selected call's details).
   * Run logic lives in the runner store; the math in domain/runnerStats.
   */
  import { onMount } from 'svelte';
  import {
    collections,
    environments,
    activeEnvironmentId,
    runnerConfig,
    runnerRun,
    runnerHistory,
    runnerStage,
    runnerRecords,
    runnerViewing,
    viewRun,
    loadRunnerState,
    runnerScopeTitle,
    plannedRequests,
    setRunnerStage,
    runCollection,
    rerunFailed,
    rerunCall,
    togglePause,
    stopRun,
    bindIdFrom,
    exportReport,
    openSavedRequest,
  } from '../stores';
  import RunnerPick from './RunnerPick.svelte';
  import RunnerSetup from './RunnerSetup.svelte';
  import { findNode } from '../domain/tree';
  import { methodColor } from '../domain/method';
  import { formatBytes } from '../domain/http';
  import { highlightJson } from '../domain/highlight';
  import { ENV_COLOR_VAR, envColor } from '../domain/palette';
  import {
    buildMatrix, callTone, compactJson, durationDelta, insightFor, p95Delta, passedDelta, runBars,
    runTimeLabel, statusLabel, summarizeRun, testDetail, waterfall, type MatrixRow,
  } from '../domain/runnerStats';
  import type { RequestNode } from '../domain/types';
  import { t, tp } from '../i18n';

  onMount(() => void loadRunnerState());

  // ---- Scope ----
  const scopeIds = $derived($runnerConfig.folderIds.filter((id) => findNode($collections, id)));
  // A past run (opened from the bars) shows its own scope + environment, read-only.
  const viewing = $derived($runnerViewing);
  const viewed = $derived(viewing === null ? undefined : $runnerHistory.find((h) => h.n === viewing));
  const title = $derived(viewed?.title ?? runnerScopeTitle(scopeIds, $collections, $t));
  const planned = $derived(plannedRequests($runnerConfig, $collections));
  const scopeText = $derived.by(() => {
    const extra = scopeIds.slice(1).map((id) => findNode($collections, id)?.name).filter(Boolean);
    const count = `${planned.length} ${$tp(planned.length, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])}`;
    return extra.length ? `+ ${extra.join(', ')} · ${count}` : count;
  });

  const env = $derived($environments.find((e) => e.id === (viewed ? viewed.envId : $activeEnvironmentId)));
  const envLabel = $derived(viewed ? (viewed.envName ?? $t('runner.noEnv')) : (env?.name ?? $t('runner.noEnv')));
  const dataDriven = $derived($runnerConfig.dataRows.length > 0);
  const iterationCount = $derived(dataDriven ? $runnerConfig.dataRows.length : $runnerConfig.iterations);

  // ---- Run + summary ----
  const run = $derived($runnerRun);
  const running = $derived(run.status === 'running');
  const hasRun = $derived(run.n > 0 && run.startedAt !== null);
  const failedRows = $derived(run.results.filter((r) => !r.ok));
  const current = $derived(
    hasRun ? summarizeRun(run.n, run.startedAt ?? 0, run.finishedAt ?? Date.now(), run.results) : undefined,
  );
  const prev = $derived(current ? $runnerHistory.filter((h) => h.n < current.n).at(-1) : undefined);
  const bars = $derived(runBars($runnerHistory));
  const currentN = $derived(run.n || $runnerHistory.at(-1)?.n);

  // A live clock while running (elapsed, ETA, the call in flight).
  let now = $state(Date.now());
  $effect(() => {
    if (!running) return;
    const id = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(id);
  });

  // ---- R3: progress + log ----
  const curIter = $derived(run.iterStarts.length);
  const okCount = $derived(run.results.filter((r) => r.ok).length);
  const elapsedS = $derived(run.startedAt ? (now - run.startedAt) / 1000 : 0);
  const leftS = $derived(run.completed > 0 ? (elapsedS / run.completed) * (run.total - run.completed) : 0);
  const fmtLogTime = (ms: number) => (ms / 1000).toFixed(3).padStart(6, '0');
  const log = $derived.by(() => {
    const items = run.results.map((r) => ({ at: r.endMs ?? 0, kind: 'call' as const, r }));
    const iters = run.iterations > 1 ? run.iterStarts.map((at, i) => ({ at, kind: 'iter' as const, n: i + 1 })) : [];
    return [...items, ...iters].sort((a, b) => b.at - a.at || (a.kind === 'iter' ? 1 : -1));
  });

  // ---- Matrix ----
  const iterations = $derived(hasRun ? run.iterations : iterationCount);
  const emptyRow = (n: RequestNode): MatrixRow => ({
    key: n.id, name: n.name, method: n.protocol === 'grpc' ? 'gRPC' : n.request.method, protocol: n.protocol, nodeId: n.id,
    cells: Array(iterations).fill(undefined),
  });
  const rows: MatrixRow[] = $derived.by(() => {
    const base = buildMatrix(run.results, iterations);
    // While running, requests not reached yet still get their (pending) row.
    if (running) return [...base, ...planned.filter((n) => !base.some((r) => r.nodeId === n.id)).map(emptyRow)];
    return base.length > 0 ? base : planned.map(emptyRow);
  });

  let sel = $state<{ key: string; iter: number } | null>(null);
  const selIdx = $derived(sel ? rows.findIndex((r) => r.key === sel!.key) : -1);
  const selCall = $derived(sel && selIdx >= 0 ? rows[selIdx].cells[sel.iter - 1] : undefined);
  const wfIter = $derived(running ? Math.max(1, curIter) : (sel?.iter ?? iterations));
  const bars2 = $derived(waterfall(rows.map((r) => r.cells[wfIter - 1])));

  // A fresh run clears the selection; a finished one selects its first failure.
  let lastStatus = '';
  $effect(() => {
    const st = run.status;
    if (st === lastStatus) return;
    if (st === 'running' && run.completed === 0) sel = null;
    if ((st === 'done' || st === 'stopped') && !sel && failedRows[0]) sel = { key: keyOf(failedRows[0]), iter: failedRows[0].iteration };
    lastStatus = st;
  });
  // Opening another (past) run starts from its first failure.
  let lastN = 0;
  $effect(() => {
    const n = run.n;
    if (n === lastN) return;
    lastN = n;
    if (!running) sel = failedRows[0] ? { key: keyOf(failedRows[0]), iter: failedRows[0].iteration } : null;
  });
  function keyOf(r: { nodeId?: string; method: string; requestName: string }): string {
    return r.nodeId ?? `${r.method} ${r.requestName}`;
  }

  function move(dRow: number, dIter: number): void {
    if (rows.length === 0) return;
    const i = Math.min(rows.length - 1, Math.max(0, (selIdx < 0 ? 0 : selIdx + dRow)));
    const it = Math.min(iterations, Math.max(1, (sel?.iter ?? iterations) + dIter));
    sel = { key: rows[i].key, iter: it };
  }

  function onKey(e: KeyboardEvent): void {
    const stage = $runnerStage;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      if (!running && stage !== 'pick' && planned.length > 0) void runCollection();
      return;
    }
    const tgt = e.target as HTMLElement | null;
    if (stage !== 'run' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (tgt?.closest('input, textarea, select, [contenteditable], [role=tablist], [role=menu], [role=listbox], [role=dialog]')) return;
    if (e.key === 'Escape' && running) {
      e.preventDefault();
      stopRun();
      return;
    }
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d || running) return;
    e.preventDefault();
    move(d[0], d[1]);
  }

  // ---- Detail ----
  const insight = $derived(selCall ? insightFor(selCall, run.results, $t) : null);
  const testsPassed = $derived(selCall ? selCall.tests.filter((x) => x.passed).length : 0);
  let bound = $state<string | null>(null);
  async function bind(): Promise<void> {
    if (!selCall?.nodeId || !insight?.bind) return;
    if (await bindIdFrom(selCall.nodeId, insight.bind)) bound = selCall.id;
  }
  function openRequest(): void {
    const node = selCall?.nodeId ? findNode($collections, selCall.nodeId) : undefined;
    if (node?.kind === 'request') openSavedRequest(node);
  }
  const pad2 = (n: number) => String(n).padStart(2, '0');

  let copied = $state(false);
  async function doExport(): Promise<void> {
    if (!(await exportReport())) return;
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
  const setup = () => setRunnerStage('setup');
</script>

<svelte:window onkeydown={onKey} />

{#snippet eyebrow(text: string)}<div class="rn-eyebrow">{text}</div>{/snippet}
{#snippet delta(d: { text: string; tone: string } | null)}{#if d}<span class="rn-delta {d.tone}">{d.text}</span>{/if}{/snippet}

<div class="rn">
  {#if $runnerStage === 'pick'}
    <RunnerPick />
  {:else if $runnerStage === 'setup'}
    <RunnerSetup />
  {:else}
  <header class="rn-head">
    <div class="rn-crumb">
      {@render eyebrow(hasRun
        ? `RUNNER  /  ${$t('runner.runN', { n: run.n })}  ·  ${running ? $t(run.paused ? 'runner.crumb.paused' : 'runner.crumb.live') : runTimeLabel(run.startedAt ?? 0, Date.now(), $t)}`
        : 'RUNNER')}
      <div class="rn-titlerow">
        <h2 class="rn-title" title={title}>{title}</h2>
        <button class="rn-chip" type="button" onclick={setup} disabled={running}>
          <span class="material-symbols-outlined" aria-hidden="true">folder</span>{scopeText}
        </button>
        <button class="rn-chip" type="button" onclick={setup} disabled={running}>
          <i class="rn-dot" style="background:{env ? ENV_COLOR_VAR[envColor(env)] : 'var(--color-text-muted)'}"></i>{envLabel}
        </button>
        <button class="rn-chip" type="button" onclick={setup} disabled={running}>
          <span class="material-symbols-outlined" aria-hidden="true">repeat</span>{iterations} {$tp(iterations, ['итерация', 'итерации', 'итераций'], ['iteration', 'iterations'])}
        </button>
        <button class="rn-chip" type="button" onclick={setup} disabled={running}>
          <span class="material-symbols-outlined" aria-hidden="true">timer</span>{$runnerConfig.delayMs} ms
        </button>
        <button class="rn-icon" type="button" title={$t('runner.settings')} aria-label={$t('runner.settings')} onclick={setup} disabled={running}>
          <span class="material-symbols-outlined" aria-hidden="true">tune</span>
        </button>
        {#if !running && run.results.length > 0}
          <button class="rn-icon" type="button" title={copied ? $t('runner.copied') : $t('runner.exportReport')} aria-label={$t('runner.exportReport')} onclick={doExport}>
            <span class="material-symbols-outlined" aria-hidden="true">{copied ? 'check' : 'ios_share'}</span>
          </button>
        {/if}
      </div>
    </div>
    {#if running}
      <button class="rn-btn" type="button" onclick={togglePause}>{run.paused ? $t('runner.resume') : $t('runner.pause')}</button>
      <button class="rn-btn stop" type="button" onclick={stopRun}>
        <i class="rn-stopicon" aria-hidden="true"></i><b>{$t('runner.stop')}</b><kbd>Esc</kbd>
      </button>
    {:else}
      {#if viewing !== null}
        <span class="rn-viewing">{$t('runner.viewing', { n: viewing })}<button type="button" onclick={() => viewRun($runnerHistory.at(-1)?.n ?? viewing)}>{$t('runner.viewLatest')}</button></span>
      {:else if failedRows.length > 0}
        <button class="rn-btn" type="button" onclick={() => void rerunFailed()}>
          <span class="material-symbols-outlined danger" aria-hidden="true">replay</span>{$t('runner.rerunFailed', { n: failedRows.length })}
        </button>
      {/if}
      <button class="rn-btn primary" type="button" onclick={() => void runCollection()} disabled={planned.length === 0}>
        <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span><b>{$t('runner.runAll')}</b><kbd>⌘R</kbd>
      </button>
    {/if}
  </header>

  {#if running}
    <section class="rn-progress" aria-live="polite">
      <div class="rn-prow">
        <b class="rn-pnum">{run.completed}</b><span class="rn-pof">{$t('runner.progress.of', { n: run.total })}</span>
        {#if run.iterations > 1}<span class="rn-ppill">{$t('runner.progress.iter', { i: curIter, n: run.iterations })}</span>{/if}
        <span class="sp"></span>
        <span class="rn-pok">{okCount} ✓</span>
        {#if run.completed - okCount > 0}<span class="rn-pbad">{run.completed - okCount} ✗</span>{/if}
        <span class="rn-ptime">{$t('runner.progress.time', { el: elapsedS.toFixed(1), left: leftS.toFixed(1) })}</span>
      </div>
      <div class="rn-segs" class:dense={run.total > 60}>
        {#each { length: run.total } as _, i (i)}
          <i class:ok={run.results[i]?.ok} class:bad={run.results[i] && !run.results[i].ok} class:cur={i === run.completed}></i>
        {/each}
      </div>
    </section>
  {:else}
  <section class="rn-stats">
    <div class="rn-stat">
      {@render eyebrow($t('runner.stat.passed'))}
      <div class="rn-stat-row">
        <b class="ok">{current ? current.passed : '—'}</b>{#if current}<span>/ {current.total}</span>{/if}
        {@render delta(current ? passedDelta(current, prev, $t) : null)}
      </div>
    </div>
    <div class="rn-stat">
      {@render eyebrow($t('runner.stat.total'))}
      <div class="rn-stat-row">
        <b>{current ? (current.durationMs / 1000).toFixed(1) : '—'}</b>{#if current}<span>s</span>{/if}
        {@render delta(current ? durationDelta(current, prev) : null)}
      </div>
    </div>
    <div class="rn-stat">
      {@render eyebrow($t('runner.stat.p95'))}
      <div class="rn-stat-row">
        <b>{current ? current.p95Ms : '—'}</b>{#if current}<span>ms</span>{/if}
        {@render delta(current ? p95Delta(current, prev) : null)}
      </div>
    </div>
    <div class="rn-stat">
      {@render eyebrow($t('runner.stat.last', { n: Math.max(bars.length, 1), runs: $tp(Math.max(bars.length, 1), ['ПРОГОН', 'ПРОГОНА', 'ПРОГОНОВ'], ['RUN', 'RUNS']) }))}
      <div class="rn-bars" aria-label={$t('runner.stat.durations')}>
        {#each bars as b, i (i)}
          {@const saved = $runnerRecords.some((r) => r.n === b.n)}
          <button type="button" class="rn-bar" class:failed={b.failed} class:current={b.n === currentN} style="height:{b.h}px"
            title={saved ? `#${b.n}` : $t('runner.bar.noData')} aria-label={$t('runner.runN', { n: b.n })} disabled={!saved || running} onclick={() => viewRun(b.n)}></button>
        {/each}
      </div>
    </div>
  </section>
  {/if}

  <div class="rn-split">
    <section class="rn-matrix" style="--iters:{iterations}">
      <div class="rn-scroll">
        <div class="rn-grid rn-ghead">
          <span></span>
          <span>{$t('runner.col.request')}</span>
          {#each { length: iterations } as _, i (i)}<span class="c">{$t('runner.col.iter', { n: i + 1 })}</span>{/each}
          <span>{$t('runner.col.waterfall', { n: wfIter })}</span>
          <span class="r">{$t('runner.col.time')}</span>
        </div>
        {#each rows as row, ri (row.key)}
          {@const call = row.cells[wfIter - 1]}
          {@const bar = bars2[ri]}
          {@const live = running && run.current?.nodeId === row.nodeId}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="rn-grid rn-row" class:sel={running ? live : ri === selIdx} class:live
            onclick={() => !running && (sel = { key: row.key, iter: sel?.iter ?? iterations })}>
            <span class="rn-no">{pad2(ri + 1)}</span>
            <span class="rn-req">
              <b style="color:{methodColor(row.protocol === 'grpc' ? 'GRPC' : row.method)}">{row.method}</b>
              <span class="rn-name" title={row.name}>{row.name}</span>
            </span>
            {#each row.cells as c, ci (ci)}
              {@const cur = live && ci + 1 === curIter}
              <span class="c">
                <button type="button" class="rn-cell" class:ok={c?.ok} class:bad={c && !c.ok} class:pending={running && !c} class:cur
                  class:on={!running && ri === selIdx && sel?.iter === ci + 1} disabled={running}
                  aria-label={$t('runner.cell.aria', { name: row.name, n: ci + 1, status: c ? statusLabel(c.status) : $t('runner.cell.noData') })}
                  onclick={(e) => { e.stopPropagation(); sel = { key: row.key, iter: ci + 1 }; }}>{c ? c.status : cur ? '···' : '—'}</button>
              </span>
            {/each}
            <span class="rn-wf">{#if bar}<i class={bar.tone} style="left:{bar.left}%;width:{bar.width}%"></i>{/if}</span>
            <span class="rn-time r" class:slow={call && callTone(call) === 'slow'}>
              {call ? `${call.elapsedMs} ms` : live && run.current ? `${((now - run.current.startedAt) / 1000).toFixed(1)} s` : running ? '—' : ''}
            </span>
          </div>
        {/each}
        <div class="rn-legend">
          <span><i></i>{$t('runner.legend.normal')}</span>
          <span><i class="slow"></i>{$t('runner.legend.slow')}</span>
          <span><i class="error"></i>{$t('runner.legend.error')}</span>
          <span class="sp"></span>
          <span>{$t('runner.legend.keys')}</span>
        </div>
        {#if rows.length === 0}
          <p class="rn-empty">{$t('runner.empty')}</p>
        {/if}
      </div>
    </section>

    {#if running}
      <aside class="rn-detail rn-log" aria-label={$t('runner.log')}>
        {@render eyebrow($t('runner.log'))}
        <div class="rn-logcur">
          <span class="rn-logstate"><i class:paused={run.paused}></i>{run.paused ? $t('runner.log.paused') : $t('runner.log.running')}</span>
          {#if run.current}<span class="rn-logcall">{run.current.method} {run.current.name} · {((now - run.current.startedAt) / 1000).toFixed(1)} s</span>{/if}
        </div>
        <div class="rn-logs">
          {#each log as e (e.kind === 'call' ? e.r.id : `i${e.n}`)}
            <div class="rn-logrow">
              <span class="rn-logt">{fmtLogTime(e.at)}</span>
              {#if e.kind === 'call'}
                <span class="rn-logbody">
                  <b>{e.r.method} {e.r.requestName}</b>
                  <small class:bad={!e.r.ok}>{e.r.status} · {e.r.ok ? `${e.r.elapsedMs} ms` : (e.r.error ?? $t('runner.log.testFailed'))}</small>
                </span>
              {:else}
                <span class="rn-logbody">
                  <b>{$t('runner.log.iter', { n: e.n })}</b>
                  {#if $runnerConfig.dataFileName}<small class="mute">{$t('runner.log.row', { file: $runnerConfig.dataFileName, n: e.n })}</small>{/if}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </aside>
    {:else if selCall}
      <aside class="rn-detail" aria-label={$t('runner.detail')}>
        <div class="rn-dhead">
          <div class="rn-drow">
            {@render eyebrow($t('runner.detail.iteration', { n: selCall.iteration, pos: pad2(selIdx + 1), total: pad2(rows.length) }))}
            <button class="rn-icon" type="button" aria-label={$t('common.close')} onclick={() => (sel = null)}>
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
          <div class="rn-dtitle">
            <b style="color:{methodColor(selCall.protocol === 'grpc' ? 'GRPC' : selCall.method)}">{selCall.method}</b>
            <span>{selCall.requestName}</span>
          </div>
          <div class="rn-dstatus">
            <span class="rn-pill" class:ok={selCall.ok}>{statusLabel(selCall.status)}</span>
            <span>{[`${selCall.elapsedMs} ms`, selCall.sizeBytes !== undefined ? formatBytes(selCall.sizeBytes) : ''].filter(Boolean).join(' · ')}</span>
          </div>
          {#if selCall.error}<div class="rn-err">{selCall.error}</div>{/if}
        </div>

        {#if insight}
          <div class="rn-insight">
            <div class="rn-insight-head"><span class="material-symbols-outlined" aria-hidden="true">lightbulb</span>{$t('runner.detail.cause')}</div>
            <p>{insight.text}</p>
            {#if insight.bind && selCall.nodeId}
              <button class="rn-link" type="button" onclick={bind} disabled={bound === selCall.id}>
                <span class="material-symbols-outlined" aria-hidden="true">{bound === selCall.id ? 'check' : 'link'}</span>
                {bound === selCall.id ? $t('runner.detail.bound', { name: insight.bind.varName }) : $t('runner.detail.bindFrom', { name: insight.bind.sourceName })}
              </button>
            {/if}
          </div>
        {/if}

        {#if selCall.tests.length > 0}
          <div class="rn-tests">
            {@render eyebrow($t('runner.detail.tests', { passed: testsPassed, total: selCall.tests.length }))}
            {#each selCall.tests as tr, i (i)}
              <div class="rn-test" class:fail={!tr.passed}>
                <b>{tr.passed ? '✓' : '✗'}</b><span>{tr.name}</span><small>{testDetail(tr, selCall)}</small>
              </div>
            {/each}
          </div>
        {/if}

        {#if selCall.responseBody}
          <div class="rn-resp">
            {@render eyebrow($t('runner.detail.response'))}
            <div class="rn-code">{@html highlightJson(compactJson(selCall.responseBody), false)}</div>
          </div>
        {/if}

        <div class="rn-actions">
          <button class="rn-btn grow" type="button" onclick={openRequest} disabled={!selCall.nodeId}>{$t('runner.detail.open')}</button>
          <button class="rn-btn" type="button" onclick={() => selCall && void rerunCall(selCall.id)} disabled={running || viewing !== null}>{$t('runner.detail.retry')}</button>
        </div>
      </aside>
    {/if}
  </div>
  {/if}
</div>

<style>
  .rn {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 6px 20px 20px;
    overflow: hidden;
    line-height: normal;
    color: var(--color-text);
  }
  .rn :global(.material-symbols-outlined) { font-variation-settings: 'wght' 300; }
  .rn :global(.rn-eyebrow) {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) / 13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    white-space: pre;
  }
  .rn :global(.rn-muted) { color: var(--color-text-muted); font-size: 12px; }

  /* Header */
  .rn-head { display: flex; align-items: flex-end; gap: 10px; flex: none; }
  .rn-crumb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .rn-titlerow { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; }
  .rn-title { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 22px/27px var(--font-ui); letter-spacing: -0.5px; }
  .rn-chip {
    flex: none;
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 9px 0 7px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font: 500 12px var(--font-ui);
    white-space: nowrap;
  }
  button.rn-chip:hover:not(:disabled) { color: var(--color-text); border-color: var(--color-border); }
  .rn-chip .material-symbols-outlined { font-size: 13px; color: var(--color-text-muted); }
  .rn :global(.rn-dot) { width: 7px; height: 7px; border-radius: 50%; }
  .rn-icon {
    flex: none;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
  }
  .rn-icon:disabled { opacity: 0.5; }
  .rn-icon:hover:not(:disabled) { background: var(--color-hover); color: var(--color-text); }
  .rn-icon .material-symbols-outlined { font-size: 15px; }

  .rn :global(.rn-btn) {
    flex: none;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 13px 0 11px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: 500 12px var(--font-ui);
    white-space: nowrap;
    transition: background-color var(--duration-hover);
  }
  .rn :global(.rn-btn:hover:not(:disabled)) { background: var(--color-hover); }
  .rn :global(.rn-btn:disabled) { opacity: 0.5; cursor: default; }
  .rn :global(.rn-btn .material-symbols-outlined) { font-size: 16px; }
  .rn-btn .danger { color: var(--color-danger); }
  .rn :global(.rn-btn.primary) { padding: 0 16px 0 12px; border: 0; background: var(--color-action); color: var(--color-on-action); }
  .rn :global(.rn-btn.primary:hover:not(:disabled)) { background: var(--primary-hover, var(--color-action)); }
  .rn :global(.rn-btn.primary b) { font-weight: 600; }
  .rn :global(.rn-btn.primary kbd) { font: 10px var(--font-code); opacity: 0.7; }
  .rn :global(.rn-btn.sm) { height: 30px; padding: 0 12px; font-size: 11px; }
  .rn-btn.grow { flex: 1; height: 34px; }
  .rn-actions .rn-btn { height: 34px; padding: 0 15px; }

  .rn :global(.rn-err) { color: var(--color-danger); font: 11px var(--font-code); white-space: pre-wrap; }

  .rn-btn.stop { padding: 0 14px 0 12px; border: 0; background: var(--color-danger-soft); color: var(--color-danger); }
  .rn-btn.stop b { font-weight: 600; }
  .rn-btn.stop kbd { font: 10px var(--font-code); opacity: 0.7; }
  .rn-stopicon { width: 10px; height: 10px; border-radius: 2px; background: currentColor; }

  /* R3: progress */
  .rn-progress {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 18px 16px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .rn-prow { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .rn-prow .sp { flex: 1; }
  .rn-pnum { font: 600 22px/27px var(--font-code); }
  .rn-pof { color: var(--color-text-muted); font: 12px var(--font-ui); }
  .rn-ppill { height: 22px; display: inline-flex; align-items: center; margin-left: 6px; padding: 0 9px; border-radius: 999px; background: var(--color-panel); color: var(--color-text); font: 500 11px var(--font-ui); }
  .rn-pok { color: var(--color-success); font: 600 12px var(--font-code); }
  .rn-pbad { color: var(--color-danger); font: 600 12px var(--font-code); }
  .rn-ptime { margin-left: 6px; color: var(--color-text-muted); font: 11px var(--font-code); }
  .rn-segs { display: flex; gap: 3px; }
  .rn-segs.dense { gap: 0; }
  .rn-segs i { flex: 1 1 0; min-width: 0; height: 5px; border-radius: 999px; background: var(--color-border-subtle); }
  .rn-segs.dense i { border-radius: 0; }
  .rn-segs i.ok { background: var(--color-success); }
  .rn-segs i.bad { background: var(--color-danger); }
  .rn-segs i.cur { background: var(--color-text); }

  /* R3: log */
  .rn-log { gap: 10px; }
  .rn-logcur { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1.5px solid var(--color-text); border-radius: 14px; }
  .rn-logstate { display: flex; align-items: center; gap: 6px; font: 600 11px var(--font-ui); }
  .rn-logstate i { width: 7px; height: 7px; border-radius: 50%; background: var(--color-text); }
  .rn-logstate i.paused { background: var(--color-warning); }
  .rn-logcall { font: 12px/16px var(--font-code); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rn-logs { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px 2px; }
  .rn-logrow { display: flex; gap: 14px; }
  .rn-logt { flex: none; width: 46px; color: var(--color-text-muted); font: 10px/15px var(--font-code); }
  .rn-logbody { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .rn-logbody b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 11px/15px var(--font-code); }
  .rn-logbody small { color: var(--color-success); font: 10px/13px var(--font-code); overflow-wrap: anywhere; }
  .rn-logbody small.bad { color: var(--color-danger); }
  .rn-logbody small.mute { color: var(--color-text-muted); }

  /* Summary */
  .rn-stats {
    flex: none;
    display: flex;
    padding: 13px 5px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .rn-stat { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 0 16px; }
  .rn-stat:not(:last-child) { border-right: 1px solid var(--color-border-subtle); }
  .rn-stat-row { height: 29px; display: flex; align-items: flex-end; gap: 6px; white-space: nowrap; }
  .rn-stat-row b { font: 600 22px/29px var(--font-code); color: var(--color-text); }
  .rn-stat-row b.ok { color: var(--color-success); }
  .rn-stat-row > span { font: 12px/15px var(--font-ui); color: var(--color-text-muted); }
  .rn-delta { height: 18px; display: inline-flex; align-items: center; padding: 0 6px; border-radius: var(--radius-control); font: 600 10px var(--font-code); }
  .rn-delta.success { background: var(--color-success-soft); color: var(--color-success); }
  .rn-delta.warning { background: var(--color-warning-soft); color: var(--color-warning); }
  .rn-delta.danger { background: var(--color-danger-soft); color: var(--color-danger); }
  .rn-bars { height: 28px; display: flex; align-items: flex-end; gap: 4px; }
  .rn-bar { width: 14px; padding: 0; border: 0; border-radius: 4px; background: var(--color-success); opacity: 0.55; cursor: pointer; }
  .rn-bar:disabled { cursor: default; }
  .rn-bar:hover:not(:disabled) { opacity: 0.85; }
  .rn-bar.failed { background: var(--color-danger); }
  .rn-bar.current { opacity: 1; }
  .rn-viewing { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 4px 0 10px; border-radius: 999px; background: var(--color-var-soft); color: var(--color-var); font: 500 11px var(--font-ui); white-space: nowrap; }
  .rn-viewing button { height: 20px; padding: 0 8px; border-radius: 999px; background: var(--color-var); color: var(--color-raised); font: 600 10px var(--font-ui); }

  /* Matrix */
  .rn-split { flex: 1; min-height: 0; display: flex; gap: 12px; }
  .rn-matrix {
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
  .rn-scroll { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
  .rn-grid {
    display: grid;
    grid-template-columns: 22px minmax(140px, 1fr) repeat(var(--iters), 58px) minmax(120px, 300px) 56px;
    column-gap: 10px;
    align-items: center;
    padding: 0 12px;
    flex: none;
  }
  .rn-ghead { height: 30px; color: var(--color-text-muted); font: 500 var(--font-size-micro) / 13px var(--font-code); letter-spacing: 1px; white-space: nowrap; }
  .c { display: flex; justify-content: center; }
  .r { text-align: right; justify-self: end; }
  .rn-row { height: 38px; border-radius: var(--radius-control); cursor: default; }
  .rn-row:hover { background: var(--color-hover); }
  .rn-row.sel { background: var(--color-selected); }
  .rn-no { color: var(--color-text-muted); font: 10px/13px var(--font-code); }
  .rn-req { min-width: 0; display: flex; align-items: center; gap: 10px; }
  .rn-req b { flex: none; width: 50px; font: 600 10px/13px var(--font-code); letter-spacing: 0.4px; }
  .rn-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); font: 13px/16px var(--font-ui); }
  .rn-row.live .rn-name, .rn-row.sel .rn-name { color: var(--color-text); font-weight: 600; }
  .rn-cell {
    width: 46px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--color-text-muted);
    font: 600 10px var(--font-code);
  }
  .rn-cell.ok { background: var(--color-success-soft); color: var(--color-success); }
  .rn-cell.bad { background: var(--color-danger-soft); color: var(--color-danger); }
  .rn-cell.pending { box-shadow: inset 0 0 0 1px var(--color-border-subtle); }
  .rn-cell.cur { box-shadow: inset 0 0 0 1.5px var(--color-text); color: var(--color-text); }
  .rn-cell:disabled { cursor: default; }
  .rn-cell.on { box-shadow: inset 0 0 0 1.5px currentColor; }
  .rn-wf { position: relative; height: 24px; }
  .rn-wf i { position: absolute; top: 8px; height: 8px; min-width: 4px; border-radius: 999px; background: var(--color-text-muted); }
  .rn-wf i.slow { background: var(--color-warning); }
  .rn-wf i.error { background: var(--color-danger); }
  .rn-time { color: var(--color-text-muted); font: 10px/13px var(--font-code); white-space: nowrap; }
  .rn-time.slow { color: var(--color-warning); }
  .rn-legend { display: flex; align-items: center; gap: 14px; padding: 10px 12px 4px; color: var(--color-text-muted); font: 11px/13px var(--font-ui); white-space: nowrap; flex: none; }
  .rn-legend > span { display: inline-flex; align-items: center; gap: 6px; }
  .rn-legend i { width: 14px; height: 6px; border-radius: 999px; background: var(--color-text-muted); }
  .rn-legend i.slow { background: var(--color-warning); }
  .rn-legend i.error { background: var(--color-danger); }
  .rn-legend .sp { flex: 1; }
  .rn-empty { margin: 24px 12px; color: var(--color-text-muted); font-size: 12px; }

  /* Detail */
  .rn-detail {
    flex: none;
    width: 340px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 13px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: auto;
  }
  .rn-dhead { display: flex; flex-direction: column; gap: 6px; }
  .rn-drow { height: 26px; display: flex; align-items: center; justify-content: space-between; }
  .rn-dtitle { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .rn-dtitle b { flex: none; font: 700 11px/15px var(--font-code); }
  .rn-dtitle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 16px/19px var(--font-ui); }
  .rn-dstatus { display: flex; align-items: center; gap: 8px; color: var(--color-text-muted); font: 10px/13px var(--font-code); }
  .rn-pill { height: 22px; display: inline-flex; align-items: center; padding: 0 9px; border-radius: var(--radius-control); background: var(--color-danger-soft); color: var(--color-danger); font-weight: 600; }
  .rn-pill.ok { background: var(--color-success-soft); color: var(--color-success); }
  .rn-insight { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 16px; background: var(--color-var-soft); }
  .rn-insight-head { display: flex; align-items: center; gap: 6px; color: var(--color-var); font: 600 12px/15px var(--font-ui); }
  .rn-insight-head .material-symbols-outlined { font-size: 14px; }
  .rn-insight p { margin: 0; color: var(--color-text); font: 12px/17px var(--font-ui); }
  .rn-link {
    align-self: flex-start;
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-var);
    font: 600 12px var(--font-ui);
  }
  .rn-link:hover:not(:disabled) { background: var(--color-var-soft); }
  .rn-link .material-symbols-outlined { font-size: 16px; }
  .rn-tests, .rn-resp { display: flex; flex-direction: column; gap: 6px; }
  .rn-test { display: flex; align-items: center; gap: 8px; min-height: 16px; font: 11px/15px var(--font-code); }
  .rn-test.fail { min-height: 19px; }
  .rn-test b { flex: none; width: 8px; color: var(--color-success); font: 700 13px/15px var(--font-code); }
  .rn-test span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rn-test small { flex: none; color: var(--color-success); font-size: 10px; }
  .rn-test.fail b, .rn-test.fail small { color: var(--color-danger); }
  .rn-code {
    padding: 10px 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    font: 11px/15px var(--font-code);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 120px;
    overflow: hidden;
  }
  .rn-code :global(.k) { color: var(--sk); }
  .rn-code :global(.s2) { color: var(--ss); }
  .rn-code :global(.n2), .rn-code :global(.b2) { color: var(--sn); }
  .rn-code :global(.pu), .rn-code :global(.br) { color: var(--syntax-punct, var(--sp)); }
  .rn-actions { margin-top: auto; display: flex; gap: 6px; }

  @media (prefers-reduced-motion: reduce) {
    .rn-btn { transition: none; }
  }
</style>
