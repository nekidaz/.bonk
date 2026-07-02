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
  <!-- Config bar -->
  <div class="bs-run-config">
    <label class="bs-run-field">
      <span class="bs-run-label">Folder</span>
      <select
        value={$runnerConfig.folderId ?? RUNNER_ROOT}
        onchange={(e) => setRunnerFolder(e.currentTarget.value === RUNNER_ROOT ? null : e.currentTarget.value)}
        disabled={running}
      >
        {#each folders as f (f.id)}
          <option value={f.id}>{f.label}</option>
        {/each}
      </select>
    </label>

    <label class="bs-run-field sm">
      <span class="bs-run-label">Iterations</span>
      {#if dataDriven}
        <input type="text" value={`${$runnerConfig.dataRows.length} from data`} disabled title="Iteration count comes from the loaded data file" />
      {:else}
        <input
          type="number"
          min="1"
          value={$runnerConfig.iterations}
          oninput={(e) => setIterations(Number(e.currentTarget.value))}
          disabled={running}
        />
      {/if}
    </label>

    <label class="bs-run-field sm">
      <span class="bs-run-label">Delay (ms)</span>
      <input
        type="number"
        min="0"
        value={$runnerConfig.delayMs}
        oninput={(e) => setDelay(Number(e.currentTarget.value))}
        disabled={running}
      />
    </label>

    <label class="bs-run-check">
      <input
        type="checkbox"
        checked={$runnerConfig.stopOnFailure}
        onchange={(e) => setStopOnFailure(e.currentTarget.checked)}
        disabled={running}
      />
      <span>Stop on failure</span>
    </label>

    <div class="bs-run-field grow">
      <span class="bs-run-label">Data file</span>
      {#if $runnerConfig.dataFileName}
        <div class="bs-run-datafile">
          <span class="material-symbols-outlined" style="font-size:16px">description</span>
          <span class="bs-run-dataname" title={$runnerConfig.dataFileName}>{$runnerConfig.dataFileName}</span>
          <span class="bs-run-datacount">{$runnerConfig.dataRows.length} rows</span>
          <button class="bs-run-icon" type="button" title="Remove data file" aria-label="Remove data file" onclick={clearData} disabled={running}>
            <span class="material-symbols-outlined" style="font-size:15px">close</span>
          </button>
        </div>
      {:else}
        <button class="bs-run-file" type="button" onclick={() => fileInput?.click()} disabled={running}>
          <span class="material-symbols-outlined" style="font-size:16px">upload_file</span>
          Choose CSV / JSON…
        </button>
      {/if}
    </div>
    <input bind:this={fileInput} type="file" accept=".csv,.json" onchange={onFilePicked} style="display:none" />
  </div>

  {#if dataError}<div class="bs-run-err">{dataError}</div>{/if}

  <!-- Run controls + progress -->
  <div class="bs-run-actions">
    {#if running}
      <div class="bs-run-progress" role="progressbar" aria-valuemin={0} aria-valuemax={$runnerRun.total} aria-valuenow={$runnerRun.completed}>
        <div class="bs-run-bar" style="width:{progressPct}%"></div>
      </div>
      <span class="bs-run-count">{$runnerRun.completed} / {$runnerRun.total}</span>
    {:else}
      <button
        class="bs-run-go"
        type="button"
        onclick={() => void runCollection()}
        disabled={selectedRequestCount === 0}
      >
        <span class="material-symbols-outlined" style="font-size:18px">play_arrow</span>
        Run{selectedRequestCount > 0 ? ` (${selectedRequestCount}${dataDriven ? ` × ${$runnerConfig.dataRows.length}` : $runnerConfig.iterations > 1 ? ` × ${$runnerConfig.iterations}` : ''})` : ''}
      </button>
    {/if}
  </div>

  <!-- Summary (when done/stopped) -->
  {#if finished && $runnerRun.results.length > 0}
    <div class="bs-run-summary">
      <div class="bs-run-stat pass"><b>{passed}</b> passed</div>
      <div class="bs-run-stat fail"><b>{failed}</b> failed</div>
      <div class="bs-run-stat"><b>{$runnerRun.completed}</b> requests</div>
      <div class="bs-run-stat"><b>{wallClockMs}</b> ms</div>
      {#if $runnerRun.status === 'stopped'}<div class="bs-run-stat stopped">stopped early</div>{/if}
      <span class="bs-spacer"></span>
      <button class="bs-run-btn" type="button" onclick={() => void runCollection()}>
        <span class="material-symbols-outlined" style="font-size:16px">replay</span>
        Run again
      </button>
      <button class="bs-run-btn" type="button" onclick={doExport}>
        <span class="material-symbols-outlined" style="font-size:16px">{copied ? 'check' : 'content_copy'}</span>
        {copied ? 'Copied' : 'Export report'}
      </button>
    </div>
  {/if}

  <!-- Results list -->
  <div class="bs-run-results">
    {#if $runnerRun.results.length === 0 && !running}
      <div class="bs-run-empty">
        {#if selectedRequestCount === 0}
          <span class="material-symbols-outlined" style="font-size:28px">folder_off</span>
          <p>No requests to run. Pick a folder with saved requests, or choose “All requests”.</p>
        {:else}
          <span class="material-symbols-outlined" style="font-size:28px">playlist_play</span>
          <p>{selectedRequestCount} request{selectedRequestCount === 1 ? '' : 's'} ready. Press Run to start.</p>
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

<style>
  .bs-run {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bs-run-config {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 0.5px solid var(--sepsoft);
  }
  .bs-run-field { display: flex; flex-direction: column; gap: 4px; }
  .bs-run-field.sm { width: 96px; flex: none; }
  .bs-run-field.grow { flex: 1; min-width: 200px; }
  .bs-run-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t3);
  }
  .bs-run-field select,
  .bs-run-field input {
    height: 30px;
    border-radius: 7px;
    border: 0.5px solid var(--sep);
    background: var(--inset);
    padding: 0 8px;
    font-size: 13px;
    color: var(--text);
    outline: none;
  }
  .bs-run-field select { min-width: 200px; }
  .bs-run-field select:focus-visible,
  .bs-run-field input:focus-visible { border-color: var(--accent); }
  .bs-run-field input:disabled { color: var(--t3); }
  .bs-run-check {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }
  .bs-run-file,
  .bs-run-datafile {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    border: 0.5px solid var(--sep);
    background: var(--inset);
    font-size: 13px;
    color: var(--text);
  }
  .bs-run-file:hover { background: var(--hover); }
  .bs-run-file .material-symbols-outlined,
  .bs-run-datafile .material-symbols-outlined { color: var(--t2); flex: none; }
  .bs-run-dataname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
  .bs-run-datacount { color: var(--t3); font-size: 11.5px; }
  .bs-run-icon {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--t3);
    flex: none;
    margin-left: auto;
  }
  .bs-run-icon:hover { background: var(--hover); color: var(--red); }
  .bs-run-err { padding: 0 16px 10px; color: var(--red); font-size: 12.5px; }

  .bs-run-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
  }
  .bs-run-go {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 16px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
  }
  .bs-run-go:hover { filter: brightness(1.05); }
  .bs-run-go:disabled { opacity: 0.5; cursor: default; }
  .bs-run-go .material-symbols-outlined { color: #fff; }
  .bs-run-progress {
    flex: 1;
    height: 8px;
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
  .bs-run-count { font-size: 12.5px; color: var(--t2); font-variant-numeric: tabular-nums; }

  .bs-run-summary {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    border-top: 0.5px solid var(--sepsoft);
    border-bottom: 0.5px solid var(--sepsoft);
    flex-wrap: wrap;
  }
  .bs-run-stat { font-size: 12.5px; color: var(--t2); }
  .bs-run-stat b { color: var(--text); font-weight: 700; }
  .bs-run-stat.pass b { color: var(--green, #10b981); }
  .bs-run-stat.fail b { color: var(--red); }
  .bs-run-stat.stopped { color: var(--red); font-weight: 600; }
  .bs-run-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    border: 0.5px solid var(--sep);
    background: var(--inset);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .bs-run-btn:hover { background: var(--hover); }
  .bs-run-btn .material-symbols-outlined { color: var(--t2); }

  .bs-run-results { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 16px; }
  .bs-run-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    color: var(--t3);
    text-align: center;
  }
  .bs-run-empty p { font-size: 13px; max-width: 340px; }
  .bs-run-row {
    border: 0.5px solid var(--sepsoft);
    border-radius: 8px;
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

  @media (prefers-reduced-motion: reduce) {
    .bs-run-bar { transition: none; }
  }
</style>
