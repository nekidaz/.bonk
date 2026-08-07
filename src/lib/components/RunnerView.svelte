<script lang="ts">
  /**
   * Collection Runner, shown as a full-pane 'runner' tab (see openRunnerTab) —
   * the sibling of EnvironmentsView. Runs a whole folder of saved requests
   * (HTTP + gRPC) in sequence, with iterations, per-request delay,
   * stop-on-failure, an optional CSV/JSON data file, live-streaming results, a
   * summary, "Run again", and "Export report". All run logic lives in the runner
   * store; this view is presentation + config editing only, mirroring how
   * EnvironmentsView drives everything through the environments store helpers.
   */
  import {
    collections,
    runnerConfig,
    runnerRun,
    RUNNER_ROOT,
    setRunnerFolder,
    setIterations,
    setDelay,
    setStopOnFailure,
    loadDataRows,
    clearData,
    runCollection,
    exportReport,
  } from '../stores';
  import { idToRel } from '../domain/tree';
  import { parseDataFile } from '../domain/runnerData';
  import { methodColor } from '../domain/method';
  import type { TreeNode, RunResultRow } from '../domain/types';

  /** Flatten the tree into the pickable folder list: root + every folder, in tree order. */
  interface FolderOption {
    id: string;
    label: string;
  }
  function folderOptions(nodes: TreeNode[]): FolderOption[] {
    const out: FolderOption[] = [{ id: RUNNER_ROOT, label: 'All requests' }];
    const walk = (list: TreeNode[], depth: number): void => {
      for (const node of list) {
        if (node.kind !== 'folder') continue;
        out.push({ id: node.id, label: `${'  '.repeat(depth)}${node.name}` });
        walk(node.children, depth + 1);
      }
    };
    walk(nodes, 1);
    return out;
  }
  const folders = $derived(folderOptions($collections));

  // Count how many requests the chosen folder holds, for the empty state + hint.
  function countRequests(nodes: TreeNode[]): number {
    let n = 0;
    for (const node of nodes) {
      if (node.kind === 'request') n++;
      else n += countRequests(node.children);
    }
    return n;
  }
  function findFolder(nodes: TreeNode[], id: string): TreeNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.kind === 'folder') {
        const hit = findFolder(node.children, id);
        if (hit) return hit;
      }
    }
    return undefined;
  }
  const selectedRequestCount = $derived.by(() => {
    const fid = $runnerConfig.folderId;
    if (!fid || fid === RUNNER_ROOT) return countRequests($collections);
    const node = findFolder($collections, fid);
    if (!node) return 0;
    if (node.kind === 'request') return 1;
    return countRequests(node.children);
  });

  const dataDriven = $derived($runnerConfig.dataRows.length > 0);
  const iterationCount = $derived(dataDriven ? $runnerConfig.dataRows.length : $runnerConfig.iterations);
  const plannedExecutions = $derived(selectedRequestCount * iterationCount);
  const selectedFolderLabel = $derived(
    (folders.find((folder) => folder.id === ($runnerConfig.folderId ?? RUNNER_ROOT))?.label ?? 'All requests')
      .replace(/ /g, ' ')
      .trim(),
  );
  const running = $derived($runnerRun.status === 'running');
  const finished = $derived($runnerRun.status === 'done' || $runnerRun.status === 'stopped');
  const passed = $derived($runnerRun.results.filter((r) => r.ok).length);
  const failed = $derived($runnerRun.results.filter((r) => !r.ok).length);
  const progressPct = $derived(
    $runnerRun.total > 0 ? Math.round(($runnerRun.completed / $runnerRun.total) * 100) : 0,
  );
  const wallClockMs = $derived(
    $runnerRun.startedAt && $runnerRun.finishedAt ? $runnerRun.finishedAt - $runnerRun.startedAt : 0,
  );

  // Hidden file input drives the data-file picker. This is a Tauri webview, so a
  // browser <input type=file> + FileReader reads the text directly (no fs round
  // trip); the picked file's extension selects the parser.
  let fileInput: HTMLInputElement | undefined = $state();
  let dataError = $state('');

  async function onFilePicked(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;
    dataError = '';
    try {
      const text = await file.text();
      const rows = parseDataFile(file.name, text);
      if (rows.length === 0) {
        dataError = 'That data file has no rows.';
        return;
      }
      loadDataRows(file.name, rows);
    } catch (err) {
      dataError = err instanceof Error ? err.message : String(err);
    }
  }

  // Expandable result rows.
  let expanded = $state<Record<string, boolean>>({});
  function toggle(id: string): void {
    expanded = { ...expanded, [id]: !expanded[id] };
  }

  // Transient "Copied" confirmation after Export report.
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function doExport(): Promise<void> {
    const ok = await exportReport();
    if (!ok) return;
    copied = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1400);
  }

  function statusOk(row: RunResultRow): boolean {
    return row.ok;
  }
  function statusText(row: RunResultRow): string {
    return String(row.status);
  }
</script>

<div class="bs-run">
  <div class="bs-run-shell">
    <header class="bs-run-hero">
      <div>
        <h2>Collection Runner</h2>
        <p>{selectedFolderLabel} · {selectedRequestCount} request{selectedRequestCount === 1 ? '' : 's'} · {plannedExecutions} execution{plannedExecutions === 1 ? '' : 's'}</p>
      </div>
      <button
        class="bs-run-go"
        type="button"
        onclick={() => void runCollection()}
        disabled={selectedRequestCount === 0 || running}
      >
        <span class="material-symbols-outlined">{running ? 'progress_activity' : finished ? 'replay' : 'play_arrow'}</span>
        {running ? 'Running…' : finished ? 'Run again' : 'Run'}
        {#if !running && plannedExecutions > 0}<small>{plannedExecutions}</small>{/if}
      </button>
    </header>

    <section class="bs-run-config">
      <div class="bs-run-config-grid">
        <label class="bs-run-field scope">
          <span class="bs-run-label">Request scope</span>
          <span class="bs-run-control">
            <span class="material-symbols-outlined">folder_open</span>
            <select
              value={$runnerConfig.folderId ?? RUNNER_ROOT}
              onchange={(e) => setRunnerFolder(e.currentTarget.value === RUNNER_ROOT ? null : e.currentTarget.value)}
              disabled={running}
            >
              {#each folders as f (f.id)}
                <option value={f.id}>{f.label}</option>
              {/each}
            </select>
            <span class="material-symbols-outlined chevron">expand_more</span>
          </span>
        </label>

        <label class="bs-run-field sm">
          <span class="bs-run-label">Iterations</span>
          {#if dataDriven}
            <span class="bs-run-control">
              <span class="material-symbols-outlined">table_rows</span>
              <input type="text" value={`${$runnerConfig.dataRows.length} rows`} disabled title="Iteration count comes from the loaded data file" />
            </span>
          {:else}
            <span class="bs-run-control">
              <span class="material-symbols-outlined">repeat</span>
              <input
                type="number"
                min="1"
                value={$runnerConfig.iterations}
                oninput={(e) => setIterations(Number(e.currentTarget.value))}
                disabled={running}
              />
            </span>
          {/if}
        </label>

        <label class="bs-run-field sm">
          <span class="bs-run-label">Delay</span>
          <span class="bs-run-control suffix">
            <span class="material-symbols-outlined">timer</span>
            <input
              type="number"
              min="0"
              value={$runnerConfig.delayMs}
              oninput={(e) => setDelay(Number(e.currentTarget.value))}
              disabled={running}
            />
            <i>ms</i>
          </span>
        </label>

        <label class="bs-run-stop">
          <input
            type="checkbox"
            checked={$runnerConfig.stopOnFailure}
            onchange={(e) => setStopOnFailure(e.currentTarget.checked)}
            disabled={running}
          />
          <span class="bs-run-switch"><i></i></span>
          <span><b>Stop on failure</b><small>End the run after the first failed request</small></span>
        </label>
      </div>

      <div class="bs-run-data-row">
        <div class="bs-run-data-copy">
          <span class="material-symbols-outlined">database</span>
          <div><b>Iteration data</b><small>Optional CSV or JSON variables for data-driven runs</small></div>
        </div>
        {#if $runnerConfig.dataFileName}
          <div class="bs-run-datafile">
            <span class="material-symbols-outlined">description</span>
            <span class="bs-run-dataname" title={$runnerConfig.dataFileName}>{$runnerConfig.dataFileName}</span>
            <span class="bs-run-datacount">{$runnerConfig.dataRows.length} rows</span>
            <button class="bs-run-icon" type="button" title="Remove data file" aria-label="Remove data file" onclick={clearData} disabled={running}>
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        {:else}
          <button class="bs-run-file" type="button" onclick={() => fileInput?.click()} disabled={running}>
            <span class="material-symbols-outlined">upload_file</span>
            Choose CSV or JSON
          </button>
        {/if}
        <input bind:this={fileInput} type="file" accept=".csv,.json" onchange={onFilePicked} style="display:none" />
      </div>

      {#if dataError}
        <div class="bs-run-err"><span class="material-symbols-outlined">error</span>{dataError}</div>
      {/if}

      {#if running}
        <div class="bs-run-running">
          <div class="bs-run-running-copy"><span>Running collection</span><b>{$runnerRun.completed} / {$runnerRun.total}</b></div>
          <div class="bs-run-progress" role="progressbar" aria-valuemin={0} aria-valuemax={$runnerRun.total} aria-valuenow={$runnerRun.completed}>
            <div class="bs-run-bar" style="width:{progressPct}%"></div>
          </div>
        </div>
      {/if}
    </section>

  <!-- Summary (when done/stopped) -->
  {#if finished && $runnerRun.results.length > 0}
    <div class="bs-run-summary">
      <div class="bs-run-summary-title"><span class="material-symbols-outlined">analytics</span><div><b>Run complete</b><small>{$runnerRun.status === 'stopped' ? 'Stopped before every request completed' : 'All scheduled requests completed'}</small></div></div>
      <div class="bs-run-stat pass"><b>{passed}</b><span>Passed</span></div>
      <div class="bs-run-stat fail"><b>{failed}</b><span>Failed</span></div>
      <div class="bs-run-stat"><b>{$runnerRun.completed}</b><span>Requests</span></div>
      <div class="bs-run-stat"><b>{wallClockMs}</b><span>Milliseconds</span></div>
      {#if $runnerRun.status === 'stopped'}<div class="bs-run-stat stopped">stopped early</div>{/if}
      <span class="bs-spacer"></span>
      <button class="bs-run-btn" type="button" onclick={doExport}>
        <span class="material-symbols-outlined">{copied ? 'check' : 'content_copy'}</span>
        {copied ? 'Copied' : 'Export report'}
      </button>
    </div>
  {/if}

  <!-- Results list -->
  <div class="bs-run-results">
    {#if $runnerRun.results.length > 0 || running}
      <div class="bs-run-results-head">
        <div><b>Run results</b><span>Requests appear here as they complete.</span></div>
        {#if running}<span class="bs-run-live"><i></i>Live</span>{/if}
      </div>
    {/if}
    {#if $runnerRun.results.length === 0 && !running}
      <div class="bs-run-empty">
        {#if selectedRequestCount === 0}
          <span class="material-symbols-outlined bs-run-empty-symbol">folder_off</span>
          <h3>No requests in this scope</h3>
          <p>Choose a folder with saved requests, or select “All requests”.</p>
        {:else}
          <span class="material-symbols-outlined bs-run-empty-symbol">playlist_play</span>
          <h3>Ready to run</h3>
          <p>{selectedRequestCount} request{selectedRequestCount === 1 ? '' : 's'}, {iterationCount} iteration{iterationCount === 1 ? '' : 's'}, {plannedExecutions} total execution{plannedExecutions === 1 ? '' : 's'}.</p>
        {/if}
      </div>
    {:else}
      {#each $runnerRun.results as row (row.id)}
        {@const hasDetail = row.tests.length > 0 || row.logs.length > 0 || !!row.error}
        <div class="bs-run-row" class:fail={!statusOk(row)}>
          <button class="bs-run-rowhead" type="button" onclick={() => hasDetail && toggle(row.id)} disabled={!hasDetail}>
            <span class="bs-run-chev">
              {#if hasDetail}<span class="material-symbols-outlined" style="font-size:16px">{expanded[row.id] ? 'expand_more' : 'chevron_right'}</span>{/if}
            </span>
            <span class="bs-run-iter">#{row.iteration}</span>
            <span class="bs-run-method" style="color:{methodColor(row.protocol === 'grpc' ? 'GRPC' : row.method)}">{row.protocol === 'grpc' ? 'gRPC' : row.method}</span>
            <span class="bs-run-name" title={row.target}>{row.requestName}</span>
            <span class="bs-run-target" title={row.target}>{row.target}</span>
            <span class="bs-spacer"></span>
            {#if row.tests.length > 0}
              <span class="bs-run-tests">{row.tests.filter((t) => t.passed).length}/{row.tests.length} tests</span>
            {/if}
            <span class="bs-run-status" class:ok={statusOk(row)}>{statusText(row)}</span>
            <span class="bs-run-ms">{row.elapsedMs} ms</span>
          </button>
          {#if hasDetail && expanded[row.id]}
            <div class="bs-run-detail">
              {#if row.error}
                <div class="bs-run-fatal">{row.error}</div>
              {/if}
              {#each row.tests as t, i (i)}
                <div class="bs-run-test" class:fail={!t.passed}>
                  <span class="material-symbols-outlined" style="font-size:15px">{t.passed ? 'check_circle' : 'cancel'}</span>
                  <span class="bs-run-test-name">{t.name}</span>
                  {#if !t.passed && t.error}<span class="bs-run-test-err">{t.error}</span>{/if}
                </div>
              {/each}
              {#if row.logs.length > 0}
                <div class="bs-run-logs">
                  {#each row.logs as line, i (i)}
                    <div class="bs-run-logline">{line}</div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  </div>
</div>

<style>
  .bs-run {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--canvas);
  }
  .bs-run-shell {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bs-run-hero {
    min-height: 58px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex: none;
    padding: 9px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-run-hero > div { min-width: 0; }
  .bs-run-hero h2 { margin: 0; color: var(--text); font-size: 14px; line-height: 1.25; }
  .bs-run-hero p { margin: 2px 0 0; overflow: hidden; color: var(--t3); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
  .bs-run-config {
    flex: none;
    overflow: hidden;
    margin: 12px 14px 0;
    background: var(--surface);
    border: 1px solid var(--sepsoft);
    border-radius: 7px;
  }
  .bs-run-config-grid {
    display: grid;
    grid-template-columns: minmax(230px, 1.4fr) 130px 130px minmax(230px, 1fr);
    gap: 10px;
    padding: 10px 12px;
  }
  .bs-run-field { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .bs-run-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--t3);
  }
  .bs-run-control {
    height: 34px;
    min-width: 0;
    display: flex;
    align-items: center;
    position: relative;
    color: var(--t3);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 6px;
  }
  .bs-run-control:focus-within { border-color: color-mix(in srgb, var(--accent) 60%, var(--sep)); }
  .bs-run-control > .material-symbols-outlined { flex: none; margin-left: 9px; font-size: 15px; }
  .bs-run-control > .chevron { margin: 0 8px 0 2px; pointer-events: none; }
  .bs-run-field select,
  .bs-run-field input {
    width: 100%;
    height: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 0 8px;
    font-size: 11.5px;
    color: var(--text);
    outline: none;
  }
  .bs-run-field select { appearance: none; padding-right: 0; }
  .bs-run-field input:disabled { color: var(--t3); }
  .bs-run-control.suffix i { flex: none; margin-right: 9px; color: var(--t3); font-size: 9.5px; font-style: normal; }
  .bs-run-stop {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    align-self: end;
    height: 34px;
    padding: 0 9px;
    color: var(--t2);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 6px;
    cursor: pointer;
  }
  .bs-run-stop > input { position: absolute; opacity: 0; pointer-events: none; }
  .bs-run-switch {
    width: 28px;
    height: 16px;
    display: flex;
    align-items: center;
    flex: none;
    padding: 2px;
    background: color-mix(in srgb, var(--t3) 32%, transparent);
    border-radius: 99px;
    transition: background 120ms ease;
  }
  .bs-run-switch i { width: 12px; height: 12px; background: var(--surface-solid); border-radius: 50%; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22); transition: transform 120ms ease; }
  .bs-run-stop > input:checked + .bs-run-switch { background: var(--accent); }
  .bs-run-stop > input:checked + .bs-run-switch i { transform: translateX(12px); }
  .bs-run-stop > input:focus-visible + .bs-run-switch { outline: 2px solid color-mix(in srgb, var(--accent) 40%, transparent); outline-offset: 2px; }
  .bs-run-stop b, .bs-run-stop small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-run-stop b { color: var(--text); font-size: 10.5px; font-weight: 600; }
  .bs-run-stop small { margin-top: 1px; color: var(--t3); font-size: 8.5px; }
  .bs-run-data-row {
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 7px 12px;
    background: var(--surface);
    border-top: 1px solid var(--sepsoft);
  }
  .bs-run-data-copy { min-width: 0; display: flex; align-items: center; gap: 9px; }
  .bs-run-data-copy > .material-symbols-outlined { color: var(--t3); font-size: 17px; }
  .bs-run-data-copy b, .bs-run-data-copy small { display: block; }
  .bs-run-data-copy b { color: var(--text); font-size: 10.5px; font-weight: 600; }
  .bs-run-data-copy small { margin-top: 1px; color: var(--t3); font-size: 9px; }
  .bs-run-file,
  .bs-run-datafile {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    margin-left: auto;
    padding: 0 9px;
    border-radius: 7px;
    border: 1px solid var(--sep);
    background: var(--surface);
    font-size: 10.5px;
    color: var(--t2);
  }
  .bs-run-file:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 35%, var(--sep)); }
  .bs-run-file .material-symbols-outlined,
  .bs-run-datafile .material-symbols-outlined { color: var(--t3); flex: none; font-size: 15px; }
  .bs-run-dataname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
  .bs-run-datacount { color: var(--t3); font-size: 9.5px; }
  .bs-run-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    color: var(--t3);
    flex: none;
  }
  .bs-run-icon:hover { background: var(--hover); color: var(--red); }
  .bs-run-err {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 15px;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 6%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--red) 16%, var(--sepsoft));
    font-size: 10.5px;
  }
  .bs-run-err .material-symbols-outlined { font-size: 14px; }
  .bs-run-go {
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    margin-left: auto;
    padding: 0 9px 0 11px;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-size: 11.5px;
    font-weight: 650;
  }
  .bs-run-go:hover { filter: brightness(1.05); }
  .bs-run-go:disabled { opacity: 0.5; cursor: default; }
  .bs-run-go .material-symbols-outlined { color: #fff; font-size: 16px; }
  .bs-run-go small {
    min-width: 22px;
    padding: 2px 5px;
    color: rgba(255, 255, 255, 0.88);
    background: rgba(0, 0, 0, 0.14);
    border-radius: 5px;
    font-family: var(--mono);
    font-size: 9px;
    text-align: center;
  }
  .bs-run-running { padding: 9px 15px 12px; border-top: 1px solid var(--sepsoft); }
  .bs-run-running-copy { display: flex; justify-content: space-between; margin-bottom: 7px; color: var(--t3); font-size: 9.5px; }
  .bs-run-running-copy b { color: var(--t2); font-family: var(--mono); }
  .bs-run-progress {
    width: 100%;
    height: 6px;
    border-radius: 5px;
    background: var(--inset);
    overflow: hidden;
  }
  .bs-run-bar {
    height: 100%;
    background: var(--accent);
    border-radius: 5px;
    transition: width 0.2s ease;
  }
  .bs-run-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    margin: 10px 14px 0;
    padding: 9px;
    background: var(--surface);
    border: 1px solid var(--sepsoft);
    border-radius: 7px;
    flex-wrap: wrap;
  }
  .bs-run-summary-title { min-width: 190px; display: flex; align-items: center; gap: 8px; padding: 0 5px; }
  .bs-run-summary-title > .material-symbols-outlined { color: var(--accent); font-size: 17px; }
  .bs-run-summary-title b, .bs-run-summary-title small { display: block; }
  .bs-run-summary-title b { color: var(--text); font-size: 10.5px; }
  .bs-run-summary-title small { color: var(--t3); font-size: 8.5px; }
  .bs-run-stat { min-width: 62px; padding: 5px 8px; background: var(--inset); border-radius: 5px; color: var(--t3); }
  .bs-run-stat b, .bs-run-stat span { display: block; }
  .bs-run-stat b { color: var(--text); font-family: var(--mono); font-size: 11px; font-weight: 700; }
  .bs-run-stat span { margin-top: 1px; font-size: 8.5px; }
  .bs-run-stat.pass b { color: var(--green, #10b981); }
  .bs-run-stat.fail b { color: var(--red); }
  .bs-run-stat.stopped { color: var(--red); font-weight: 600; }
  .bs-run-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 9px;
    border-radius: 7px;
    border: 1px solid var(--sep);
    background: var(--inset);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text);
  }
  .bs-run-btn:hover { background: var(--hover); }
  .bs-run-btn .material-symbols-outlined { color: var(--t2); font-size: 14px; }

  .bs-run-results { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 14px; }
  .bs-run-results-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 0 2px;
  }
  .bs-run-results-head b, .bs-run-results-head div > span { display: block; }
  .bs-run-results-head b { color: var(--text); font-size: 11.5px; }
  .bs-run-results-head div > span { margin-top: 1px; color: var(--t3); font-size: 9.5px; }
  .bs-run-live { display: inline-flex; align-items: center; gap: 5px; color: var(--t2); font-size: 9.5px; }
  .bs-run-live i { width: 6px; height: 6px; background: var(--green); border-radius: 50%; animation: run-pulse 1.5s ease-in-out infinite; }
  @keyframes run-pulse { 50% { opacity: 0.35; } }
  .bs-run-empty {
    width: 100%;
    min-height: 180px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin: 0;
    padding: 20px;
    color: var(--t3);
    text-align: center;
  }
  .bs-run-empty-symbol { margin-bottom: 3px; color: var(--t3); font-size: 26px; }
  .bs-run-empty h3 { margin: 0; color: var(--text); font-size: 13px; }
  .bs-run-empty p { margin: 0; font-size: 10.5px; max-width: 340px; }
  .bs-run-row {
    background: var(--surface);
    border: 1px solid var(--sepsoft);
    border-radius: 6px;
    margin-bottom: 6px;
    overflow: hidden;
  }
  .bs-run-row.fail { border-color: color-mix(in srgb, var(--red) 45%, var(--sepsoft)); }
  .bs-run-rowhead {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    text-align: left;
    font-size: 12.5px;
    color: var(--text);
  }
  .bs-run-rowhead:not(:disabled):hover { background: var(--hover); }
  .bs-run-chev { width: 16px; flex: none; display: flex; color: var(--t3); }
  .bs-run-iter { color: var(--t3); font-variant-numeric: tabular-nums; flex: none; width: 30px; }
  .bs-run-method { font-weight: 700; flex: none; width: 46px; }
  .bs-run-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: none; max-width: 220px; }
  .bs-run-target { color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 11.5px; }
  .bs-run-tests { color: var(--t3); font-size: 11.5px; flex: none; }
  .bs-run-status {
    flex: none;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--red);
    min-width: 40px;
    text-align: right;
  }
  .bs-run-status.ok { color: var(--green, #10b981); }
  .bs-run-ms { flex: none; color: var(--t3); font-variant-numeric: tabular-nums; min-width: 52px; text-align: right; }

  .bs-run-detail {
    padding: 8px 12px 10px 36px;
    border-top: 0.5px solid var(--sepsoft);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .bs-run-fatal {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--red);
    white-space: pre-wrap;
  }
  .bs-run-test { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--t2); }
  .bs-run-test .material-symbols-outlined { color: var(--green, #10b981); flex: none; }
  .bs-run-test.fail { color: var(--text); }
  .bs-run-test.fail .material-symbols-outlined { color: var(--red); }
  .bs-run-test-name { flex: none; }
  .bs-run-test-err { color: var(--red); font-family: var(--mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bs-run-logs {
    margin-top: 4px;
    border-radius: 6px;
    background: var(--inset);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bs-run-logline { font-family: var(--mono); font-size: 11px; color: var(--t2); white-space: pre-wrap; }

  .bs-spacer { flex: 1; }

  @media (max-width: 920px) {
    .bs-run-config-grid { grid-template-columns: minmax(220px, 1fr) 120px 120px; }
    .bs-run-stop { grid-column: 1 / -1; }
  }
  @media (max-width: 680px) {
    .bs-run-hero { min-height: 56px; padding: 8px 10px; }
    .bs-run-config { margin: 10px 10px 0; }
    .bs-run-config-grid { grid-template-columns: 1fr 1fr; }
    .bs-run-field.scope, .bs-run-stop { grid-column: 1 / -1; }
    .bs-run-data-row { align-items: flex-start; flex-wrap: wrap; }
    .bs-run-file, .bs-run-datafile { width: 100%; margin-left: 0; }
    .bs-run-summary { margin: 10px 10px 0; }
    .bs-run-summary-title { width: 100%; }
    .bs-run-results { padding: 10px; }
    .bs-run-target { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .bs-run-bar, .bs-run-switch, .bs-run-switch i { transition: none; }
    .bs-run-live i { animation: none; }
  }
</style>
