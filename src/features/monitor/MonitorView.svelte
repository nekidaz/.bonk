<script lang="ts">
  // Dev-only Resources tab (`dev.monitor`): what bonk itself consumes, live, one sample a second.
  // Data comes from store.svelte.ts (ring buffers filled in the background); this view only reads.
  import { onMount } from 'svelte';
  import { t } from '$shared/i18n';
  import { formatBytes } from '$shared/model';
  import type { MonitorSnapshot } from '$shared/ipc';
  import { clock } from '$entities/environment';
  import LineChart from './LineChart.svelte';
  import { startFrames } from './frames';
  import { monitor, recordFrames, recordJank } from './store.svelte';
  import { aggregateIpc, JANK_MS, peak, rate, SLOW_IPC_MS, WINDOWS, type IpcRow, type WindowKey } from './series';

  const WINDOW_KEYS = Object.keys(WINDOWS) as WindowKey[];
  const C = {
    main: 'var(--color-text)',
    webview: 'var(--color-var)',
    other: 'var(--color-text-muted)',
    cpu: 'var(--color-success)',
    fps: 'var(--color-warning)',
  };

  // The tab is on screen: detailed snapshots, FPS and «data held» run only now.
  onMount(() => {
    let stop: (() => void) | null = null;
    const sync = () => {
      const on = document.visibilityState === 'visible';
      monitor.visible = on;
      if (on && !stop) stop = startFrames(recordFrames, recordJank);
      if (!on && stop) {
        stop();
        stop = null;
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      stop?.();
      monitor.visible = false;
    };
  });

  const mb = (v: number) => formatBytes(Math.round(v));
  const perSec = (v: number) => `${formatBytes(Math.round(v))}/s`;
  const pct = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
  const ms = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
  const num = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

  const view = $derived.by(() => {
    void monitor.rev;
    const latest = monitor.latest;
    const now = latest?.atMs ?? Date.now();
    const from = now - WINDOWS[monitor.windowKey];
    const samples = monitor.samples.values().filter((s) => s.at >= from);
    return {
      now,
      latest,
      previous: monitor.previous,
      samples,
      times: samples.map((s) => s.at),
      frames: monitor.frameHistory.values().filter((f) => f.at >= from),
      events: monitor.events.values().filter((e) => e.at >= from),
      calls: monitor.calls.values().filter((c) => c.at >= from),
      procHistory: monitor.procHistory,
    };
  });

  const series = $derived({
    memTotal: view.samples.map((s) => s.memTotal),
    memMain: view.samples.map((s) => s.memMain),
    memWebview: view.samples.map((s) => s.memWebview ?? 0),
    memOther: view.samples.map((s) => s.memOther),
    cpu: view.samples.map((s) => s.cpuTotal),
  });
  const last = $derived(view.samples.at(-1));

  /** Per-second rate between the last two snapshots. */
  function live(pick: (s: MonitorSnapshot) => number): number {
    const { latest, previous } = view;
    if (!latest || !previous) return 0;
    return rate(pick(previous), pick(latest), latest.atMs - previous.atMs);
  }

  const cards = $derived([
    { label: t('monitor.card.memTotal'), value: last ? mb(last.memTotal) : '—', values: series.memTotal, fmt: mb },
    { label: t('monitor.card.cpu'), value: last ? pct(last.cpuTotal) : '—', values: series.cpu, fmt: pct },
    { label: t('monitor.card.memMain'), value: last ? mb(last.memMain) : '—', values: series.memMain, fmt: mb },
    {
      label: t('monitor.card.memWebview'),
      value: last?.memWebview == null ? '—' : mb(last.memWebview),
      values: last?.memWebview == null ? [] : series.memWebview,
      fmt: mb,
      missing: last !== undefined && last.memWebview === null,
    },
  ]);

  const collecting = $derived.by(() => {
    if (!monitor.startedAt) return '';
    const min = Math.floor((view.now - monitor.startedAt) / 60_000);
    return t('monitor.collecting', { time: min < 1 ? '< 1 min' : `${min} min` });
  });

  // 2. IPC
  let ipcSort = $state<keyof IpcRow>('count');
  const ipcRows = $derived(
    aggregateIpc(view.calls, view.now, Infinity).sort((a, b) =>
      ipcSort === 'cmd' ? a.cmd.localeCompare(b.cmd) : (b[ipcSort] as number) - (a[ipcSort] as number),
    ),
  );
  const ipcCols: { key: keyof IpcRow; label: string; fmt: (r: IpcRow) => string }[] = [
    { key: 'cmd', label: t('monitor.col.command'), fmt: (r) => r.cmd },
    { key: 'count', label: t('monitor.col.calls'), fmt: (r) => String(r.count) },
    { key: 'perSec', label: t('monitor.col.perSec'), fmt: (r) => String(r.perSec) },
    { key: 'avgMs', label: t('monitor.col.avg'), fmt: (r) => ms(r.avgMs) },
    { key: 'p95Ms', label: t('monitor.col.p95'), fmt: (r) => ms(r.p95Ms) },
    { key: 'maxMs', label: t('monitor.col.max'), fmt: (r) => ms(r.maxMs) },
    { key: 'bytesTotal', label: t('monitor.col.bytes'), fmt: (r) => mb(r.bytesTotal) },
    { key: 'bytesLast', label: t('monitor.col.last'), fmt: (r) => mb(r.bytesLast) },
  ];
  const channelRows = $derived(
    Object.entries(monitor.channels).map(([cmd, c]) => {
      const before = monitor.prevChannels[cmd];
      return {
        cmd,
        msgs: rate(before?.msgs, c.msgs, 1000),
        bytes: rate(before?.bytes, c.bytes, 1000),
      };
    }),
  );
  const slowCalls = $derived(
    view.calls
      .filter((c) => c.ms > SLOW_IPC_MS)
      .slice(-20)
      .reverse(),
  );

  // 3. Smoothness
  const smooth = $derived({
    fps: view.frames.map((f) => f.fps),
    times: view.frames.map((f) => f.at),
    janks: view.frames.reduce((n, f) => n + f.janks, 0),
    longest: Math.max(0, ...view.frames.map((f) => f.longestMs)),
  });

  // 4. Data held
  const heldMax = $derived(Math.max(1, ...monitor.held.map((r) => r.bytes ?? 0)));

  // 5. Live
  const liveRows = $derived.by(() => {
    const l = view.latest?.live;
    if (!l) return [];
    return [
      [t('monitor.live.httpClients'), l.httpClients],
      [t('monitor.live.grpcConns'), l.grpcConns],
      [t('monitor.live.grpcStreams'), l.grpcStreams],
      [t('monitor.live.liveStreams'), l.liveStreams],
      [t('monitor.live.inFlight'), l.inFlight],
      [t('monitor.live.runs'), l.runs],
      [t('monitor.live.pendingInputs'), l.pendingInputs],
      [t('monitor.live.oauthLogins'), l.oauthLogins],
      [t('monitor.live.terminals'), l.terminals],
      [t('monitor.live.cookieJars'), l.cookieJars],
      [t('monitor.live.watcher'), l.watcherOn ? t('monitor.live.on') : t('monitor.live.off')],
    ] as [string, number | string][];
  });
  const scripts = $derived.by(() => {
    const s = view.latest?.counters.scripts;
    return {
      perSec: live((x) => x.counters.scripts.runs),
      avg: s && s.runs > 0 ? s.totalMs / s.runs : 0,
      peak: monitor.scriptPeak,
    };
  });

  // 6. Network & disk
  const PROTOS = ['http', 'grpc', 'sse'] as const;
  const DISK = ['state', 'settings', 'workspace'] as const;
</script>

<div class="mon">
  <header class="head">
    <span class="material-symbols-outlined" aria-hidden="true">monitor_heart</span>
    <h2>{t('monitor.title')}</h2>
    <span class="muted">{collecting}</span>
    <div class="seg" role="group">
      {#each WINDOW_KEYS as k (k)}
        <button type="button" class:on={monitor.windowKey === k} onclick={() => (monitor.windowKey = k)}
          >{t(`monitor.window.${k}`)}</button
        >
      {/each}
    </div>
  </header>

  {#if !view.latest}
    <p class="empty">{t('monitor.waiting')}</p>
  {:else}
    <div class="body">
      <div class="cards">
        {#each cards as c (c.label)}
          {@const p = peak(c.values, view.times)}
          <div class="card">
            <span class="label">{c.label}</span>
            <b>{c.value}</b>
            {#if c.missing}
              <span class="warn">{t('monitor.webviewMissing')}</span>
            {:else if p}
              <span class="muted">{t('monitor.peak', { value: c.fmt(p.value), time: clock(p.at) })}</span>
            {/if}
          </div>
        {/each}
      </div>

      <section class="chart">
        <h3>{t('monitor.chart.memory')}</h3>
        <LineChart
          times={view.times}
          events={view.events}
          format={mb}
          series={[
            { label: t('monitor.series.main'), color: C.main, values: series.memMain },
            { label: t('monitor.series.webview'), color: C.webview, values: series.memWebview },
            { label: t('monitor.series.other'), color: C.other, values: series.memOther },
          ]}
        />
      </section>
      <section class="chart">
        <h3>{t('monitor.chart.cpu')}</h3>
        <LineChart
          times={view.times}
          events={view.events}
          height={70}
          format={pct}
          series={[{ label: t('monitor.series.cpu'), color: C.cpu, values: series.cpu }]}
        />
      </section>

      <details open>
        <summary>{t('monitor.sec.procs')}</summary>
        <table>
          <thead>
            <tr>
              <th>{t('monitor.col.process')}</th>
              <th>{t('monitor.col.kind')}</th>
              <th class="r">{t('monitor.col.memory')}</th>
              <th></th>
              <th class="r">{t('monitor.col.cpu')}</th>
              <th></th>
              <th class="r">{t('monitor.col.threads')}</th>
              <th class="r">{t('monitor.col.files')}</th>
              <th class="r">{t('monitor.col.diskRead')}</th>
              <th class="r">{t('monitor.col.diskWrite')}</th>
            </tr>
          </thead>
          <tbody>
            {#each view.latest.procs as p (p.pid)}
              {@const h = view.procHistory.get(p.pid)}
              {@const before = view.previous?.procs.find((x) => x.pid === p.pid)}
              {@const dt = view.previous ? view.latest.atMs - view.previous.atMs : 0}
              <tr>
                <td class="mono name" title={`${p.name} · pid ${p.pid}`}>{p.name}</td>
                <td>{t(`monitor.kind.${p.kind}`)}</td>
                <td class="r">{mb(p.memBytes)}</td>
                <td
                  >{#if h}<LineChart
                      compact
                      height={18}
                      times={[]}
                      format={mb}
                      series={[{ label: '', color: C.main, values: h.mem.values() }]}
                    />{/if}</td
                >
                <td class="r">{pct(p.cpuPct)}</td>
                <td
                  >{#if h}<LineChart
                      compact
                      height={18}
                      times={[]}
                      format={pct}
                      series={[{ label: '', color: C.cpu, values: h.cpu.values() }]}
                    />{/if}</td
                >
                <td class="r">{p.threads ?? '—'}</td>
                <td class="r">{p.openFiles ?? '—'}</td>
                <td class="r">{perSec(rate(before?.diskReadBytes, p.diskReadBytes, dt))}</td>
                <td class="r">{perSec(rate(before?.diskWriteBytes, p.diskWriteBytes, dt))}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>

      <details open>
        <summary>{t('monitor.sec.ipc')}</summary>
        {#if ipcRows.length === 0}
          <p class="muted">{t('monitor.noCalls')}</p>
        {:else}
          <table>
            <thead>
              <tr>
                {#each ipcCols as col (col.key)}
                  <th class:r={col.key !== 'cmd'}>
                    <button type="button" class:on={ipcSort === col.key} onclick={() => (ipcSort = col.key)}
                      >{col.label}</button
                    >
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each ipcRows as row (row.cmd)}
                <tr>
                  {#each ipcCols as col (col.key)}
                    <td class:r={col.key !== 'cmd'} class:mono={col.key === 'cmd'}>{col.fmt(row)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if channelRows.length > 0}
          <table>
            <thead>
              <tr>
                <th>{t('monitor.col.channel')}</th>
                <th class="r">{t('monitor.col.msgsPerSec')}</th>
                <th class="r">{t('monitor.col.bytesPerSec')}</th>
              </tr>
            </thead>
            <tbody>
              {#each channelRows as c (c.cmd)}
                <tr>
                  <td class="mono">{c.cmd}</td>
                  <td class="r">{num(c.msgs)}</td>
                  <td class="r">{perSec(c.bytes)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if slowCalls.length > 0}
          <h4>{t('monitor.slowCalls', { ms: SLOW_IPC_MS })}</h4>
          <ul class="list">
            {#each slowCalls as c, i (i)}
              <li>
                <span class="muted">{clock(c.at)}</span> <span class="mono">{c.cmd}</span>
                {ms(c.ms)} · {mb(c.bytes)}
              </li>
            {/each}
          </ul>
        {/if}
      </details>

      <details open>
        <summary>{t('monitor.sec.smooth')}</summary>
        <div class="stats">
          <span>{t('monitor.series.fps')}: <b>{monitor.frames?.fps ?? '—'}</b></span>
          <span>{t('monitor.smooth.janks', { ms: JANK_MS })}: <b>{smooth.janks}</b></span>
          <span>{t('monitor.smooth.longest')}: <b>{ms(smooth.longest)}</b></span>
          <span>{t('monitor.smooth.dom')}: <b>{monitor.frames?.dom ?? '—'}</b></span>
        </div>
        <LineChart
          times={smooth.times}
          events={view.events.filter((e) => e.kind === 'jank')}
          height={60}
          format={num}
          series={[{ label: t('monitor.series.fps'), color: C.fps, values: smooth.fps }]}
        />
        <p class="note">{t('monitor.smooth.note')}</p>
      </details>

      <details open>
        <summary>{t('monitor.sec.held')}</summary>
        {#if monitor.held.length === 0}
          <p class="muted">{t('monitor.held.pending')}</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th>{t('monitor.col.what')}</th>
                <th class="r">{t('monitor.col.count')}</th>
                <th class="r">{t('monitor.col.size')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each monitor.held as row (row.name)}
                <tr>
                  <td>{row.name}</td>
                  <td class="r">{row.count}</td>
                  <td class="r">{row.bytes === null ? '—' : mb(row.bytes)}</td>
                  <td><span class="bar"><i style:width={`${((row.bytes ?? 0) / heldMax) * 100}%`}></i></span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <p class="note">{t('monitor.held.note')}</p>
      </details>

      <details open>
        <summary>{t('monitor.sec.live')}</summary>
        <div class="grid">
          {#each liveRows as [label, value] (label)}
            <div><span class="muted">{label}</span><b>{value}</b></div>
          {/each}
        </div>
        <div class="stats">
          <span>{t('monitor.scripts')}:</span>
          <span><b>{num(scripts.perSec)}</b> {t('monitor.scripts.perSec')}</span>
          <span>{t('monitor.scripts.avg')} <b>{ms(scripts.avg)}</b></span>
          <span>{t('monitor.scripts.peak')} <b>{mb(scripts.peak)}</b></span>
        </div>
      </details>

      <details open>
        <summary>{t('monitor.sec.net')}</summary>
        <table>
          <thead>
            <tr>
              <th>{t('monitor.col.proto')}</th>
              <th class="r">{t('monitor.col.in')}</th>
              <th class="r">{t('monitor.col.out')}</th>
              <th class="r">{t('monitor.col.reqPerSec')}</th>
              <th class="r">{t('monitor.col.bytes')}</th>
            </tr>
          </thead>
          <tbody>
            {#each PROTOS as proto (proto)}
              {@const total = view.latest.counters.net[proto]}
              <tr>
                <td>{proto.toUpperCase()}</td>
                <td class="r">{perSec(live((s) => s.counters.net[proto].received))}</td>
                <td class="r">{perSec(live((s) => s.counters.net[proto].sent))}</td>
                <td class="r">{num(live((s) => s.counters.net[proto].count))}</td>
                <td class="r">{mb(total.received + total.sent)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>{t('monitor.col.file')}</th>
              <th class="r">{t('monitor.col.writes')}</th>
              <th class="r">{t('monitor.col.bytesPerSec')}</th>
              <th class="r">{t('monitor.col.bytes')}</th>
            </tr>
          </thead>
          <tbody>
            {#each DISK as kind (kind)}
              {@const total = view.latest.counters.diskWrites[kind]}
              <tr>
                <td>{t(`monitor.disk.${kind}`)}</td>
                <td class="r">{total.count}</td>
                <td class="r">{perSec(live((s) => s.counters.diskWrites[kind].bytes))}</td>
                <td class="r">{mb(total.bytes)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>

      <details open>
        <summary>{t('monitor.sec.events')}</summary>
        {#if view.events.length === 0}
          <p class="muted">{t('monitor.noEvents')}</p>
        {:else}
          <ul class="list">
            {#each view.events.slice(-50).reverse() as e, i (i)}
              <li><span class="muted">{clock(e.at)}</span> <span class={`ev ${e.kind}`}>{e.label}</span></li>
            {/each}
          </ul>
        {/if}
      </details>
    </div>
  {/if}
</div>

<style>
  .mon {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-panel);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 44px;
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .head > .material-symbols-outlined {
    font-size: 16px;
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
  }
  h3,
  h4 {
    margin: 0 0 var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    font-weight: var(--weight-medium);
  }
  h4 {
    margin-top: var(--space-3);
  }
  .seg {
    display: flex;
    margin-left: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    padding: 2px var(--space-2);
    border: 0;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--color-action);
    color: var(--color-on-action);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .empty {
    padding: var(--space-6);
    color: var(--color-text-muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-2);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .card b {
    font-size: var(--font-size-heading);
    font-weight: var(--weight-semibold);
  }
  .label,
  .muted {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-caption);
  }
  .chart,
  details {
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  /* A wide table scrolls inside its card, never the whole tab sideways. (Not on .chart: it would
     clip the hover tooltip.) */
  details {
    overflow-x: auto;
  }
  /* .body is a fixed-height flex column: a child with overflow other than visible may shrink to
     0 height, so no section shrinks — .body scrolls instead. */
  .body > * {
    flex-shrink: 0;
  }
  summary {
    cursor: pointer;
    font-weight: var(--weight-medium);
  }
  details[open] > summary {
    margin-bottom: var(--space-2);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: var(--space-2);
  }
  th,
  td {
    padding: 3px var(--space-2);
    border-bottom: 1px solid var(--color-border-subtle);
    text-align: left;
    white-space: nowrap;
  }
  th {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    font-weight: var(--weight-medium);
  }
  th button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  th button.on {
    color: var(--color-text);
    text-decoration: underline;
  }
  .r {
    text-align: right;
  }
  .mono {
    font-family: var(--font-code);
  }
  .name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    display: inline-block;
    width: 120px;
    height: 6px;
    border-radius: 3px;
    background: var(--color-hover-strong);
    overflow: hidden;
    vertical-align: middle;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--color-text);
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-bottom: var(--space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .grid div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .note {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    padding: 2px 0;
  }
  .ev.workspace {
    color: var(--color-var);
  }
  .ev.request {
    color: var(--color-success);
  }
  .ev.runner {
    color: var(--color-ask);
  }
  .ev.slow-ipc {
    color: var(--color-warning);
  }
  .ev.jank {
    color: var(--color-danger);
  }
</style>
