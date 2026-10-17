<script lang="ts">
  // Resources tab chart: inline SVG lines over time, downsampled to the pixel width (peaks kept),
  // event markers as dashed verticals, hover readout. `compact` is a bare sparkline.
  import { clock } from '$entities/environment';
  import { downsample, type EventKind, type MonitorEvent } from './series';

  interface Series {
    label: string;
    color: string;
    values: number[];
  }

  let {
    series,
    times,
    events = [],
    height = 120,
    compact = false,
    format,
  }: {
    series: Series[];
    times: number[];
    events?: MonitorEvent[];
    height?: number;
    compact?: boolean;
    format: (v: number) => string;
  } = $props();

  const EVENT_COLOR: Record<EventKind, string> = {
    workspace: 'var(--color-var)',
    request: 'var(--color-success)',
    runner: 'var(--color-ask)',
    'slow-ipc': 'var(--color-warning)',
    jank: 'var(--color-danger)',
  };

  let width = $state(0);
  let hoverX = $state<number | null>(null);

  const t0 = $derived(times[0] ?? 0);
  const t1 = $derived(times.at(-1) ?? 0);
  const n = $derived(times.length);
  const max = $derived(Math.max(1, ...series.flatMap((s) => s.values)) * 1.1);
  const points = $derived.by(() => {
    const cols = Math.max(2, Math.floor(width));
    return series.map((s) => {
      const vs = downsample(s.values, cols);
      const step = vs.length > 1 ? width / (vs.length - 1) : 0;
      return vs.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(' ');
    });
  });
  const marks = $derived(
    t1 > t0
      ? events.filter((e) => e.at >= t0 && e.at <= t1).map((e) => ({ ...e, x: ((e.at - t0) / (t1 - t0)) * width }))
      : [],
  );
  /** Sample index under the pointer. */
  const hoverIndex = $derived(
    hoverX === null || n === 0 || width === 0
      ? null
      : Math.min(n - 1, Math.max(0, Math.round((hoverX / width) * (n - 1)))),
  );
  const hoverEvents = $derived(
    hoverIndex === null ? [] : events.filter((e) => Math.abs(e.at - times[hoverIndex]) <= 2000),
  );

  function onMove(e: PointerEvent): void {
    hoverX = e.offsetX;
  }
</script>

<div class="lc" class:compact bind:clientWidth={width}>
  {#if !compact}
    <div class="legend">
      {#each series as s (s.label)}<span><i style:background={s.color}></i>{s.label}</span>{/each}
      <span class="max">{format(max / 1.1)}</span>
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- Inline size: base.css sizes every `.bs svg` as a 16px icon, and that beats width/height attributes. -->
  <svg
    style:width={`${width}px`}
    style:height={`${height}px`}
    viewBox={`0 0 ${width} ${height}`}
    onpointermove={compact ? undefined : onMove}
    onpointerleave={() => (hoverX = null)}
  >
    {#each marks as m, i (i)}
      <line x1={m.x} x2={m.x} y1="0" y2={height} stroke={EVENT_COLOR[m.kind]} stroke-dasharray="3 3" />
    {/each}
    {#each points as p, i (i)}
      <polyline points={p} fill="none" stroke={series[i].color} stroke-width={compact ? 1 : 1.5} />
    {/each}
    {#if hoverIndex !== null && n > 1}
      <line class="cursor" x1={(hoverIndex / (n - 1)) * width} x2={(hoverIndex / (n - 1)) * width} y1="0" y2={height} />
    {/if}
  </svg>
  {#if hoverIndex !== null && !compact}
    <div class="tip" style:left={`${Math.min(hoverX ?? 0, Math.max(0, width - 180))}px`}>
      <div class="when">{clock(times[hoverIndex])}</div>
      {#each series as s (s.label)}
        <div><i style:background={s.color}></i>{s.label}: {format(s.values[hoverIndex] ?? 0)}</div>
      {/each}
      {#each hoverEvents as e, i (i)}<div class="ev" style:color={EVENT_COLOR[e.kind]}>{e.label}</div>{/each}
    </div>
  {/if}
</div>

<style>
  .lc {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  .lc.compact {
    width: 96px;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .legend {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-ui);
  }
  .legend i,
  .tip i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
    vertical-align: -1px;
  }
  .max {
    margin-left: auto;
    color: var(--color-text-muted);
  }
  .cursor {
    stroke: var(--color-text-muted);
  }
  .tip {
    position: absolute;
    top: 18px;
    z-index: 1;
    min-width: 160px;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-raised);
    box-shadow: var(--shadow-sm);
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-ui);
    pointer-events: none;
  }
  .when {
    color: var(--color-text-muted);
  }
</style>
