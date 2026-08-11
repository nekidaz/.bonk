<script lang="ts">
  /**
   * One block on the Flow canvas: icon + title + a live status dot fed by the
   * `flowRun` store. Output ports come from `outPorts(type)` — one right-side
   * handle per port, labeled when there are two (request / if / loop).
   *
   * A `request` block renders Postman-Flows-style detail: the folder path it
   * lives under, a method chip, the status of its last run, and one left-side
   * input port per `{{variable}}` it references, so an upstream block's output
   * can be wired into a specific variable.
   *
   * The hover toolbar (colour, duplicate, mute, delete) calls back into
   * FlowView through `data.actions` — the canvas owns the node array.
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { outPorts, varPortId, type FlowBlockConfig } from '../domain/flow';
  import { collections, flowRun } from '../stores';
  import { findNode, idToRel } from '../domain/tree';
  import { requestVariableNames, type FlowNodeActions } from '../domain/flowNode';
  import type { RunResultRow } from '../domain/types';

  let { id, data, selected }: NodeProps = $props();

  const config = $derived(data.config as FlowBlockConfig);
  const color = $derived(data.color as string | undefined);
  const disabled = $derived(Boolean(data.disabled));
  const actions = $derived(data.actions as FlowNodeActions | undefined);
  const ports = $derived(outPorts(config.type));
  // Named runState: a plain `state` binding shadows the `$state` rune below.
  const runState = $derived($flowRun.blocks[id]?.state);
  /** A request block's detail is the runner row for its last run. */
  const row = $derived.by(() => {
    const detail = $flowRun.blocks[id]?.detail;
    return config.type === 'request' && detail && typeof detail === 'object'
      ? (detail as RunResultRow)
      : undefined;
  });

  let showVars = $state(true);
  let showColors = $state(false);

  const COLORS = ['#4c8dff', '#34a853', '#fbbc04', '#ea4335', '#a855f7', '#14b8a6'];

  const ICONS: Record<FlowBlockConfig['type'], string> = {
    start: 'play_arrow',
    request: 'send',
    if: 'alt_route',
    loop: 'repeat',
    script: 'code',
    delay: 'schedule',
    output: 'terminal',
  };

  /** The saved request behind a `request` block (undefined until one is picked). */
  const requestNode = $derived.by(() => {
    if (config.type !== 'request' || !config.requestId) return undefined;
    const node = findNode($collections, config.requestId);
    return node?.kind === 'request' ? node : undefined;
  });

  /** Folder path of the saved request, e.g. "Acme Business / Login". */
  const path = $derived.by(() => {
    if (config.type !== 'request' || !config.requestId) return '';
    const parts = idToRel(config.requestId).split('/');
    return parts.slice(0, -1).join(' / ');
  });

  const variables = $derived(requestNode ? requestVariableNames(requestNode.request) : []);

  const PORT_LABELS: Record<string, string> = {
    success: 'Success',
    fail: 'Fail',
    true: 'true',
    false: 'false',
    each: 'each',
    done: 'done',
  };
</script>

<div
  class="fn"
  class:wide={config.type === 'request'}
  class:selected
  class:muted={disabled}
  class:running={runState === 'running'}
  class:ok={runState === 'ok'}
  class:err={runState === 'error'}
  style={color ? `--fn-accent:${color}` : ''}
>
  {#if actions && config.type !== 'start'}
    <div class="tools">
      <button class="tool" title="Colour" onclick={() => (showColors = !showColors)}>
        <span class="material-symbols-outlined">palette</span>
      </button>
      <button class="tool" title="Duplicate" onclick={() => actions.duplicate(id)}>
        <span class="material-symbols-outlined">content_copy</span>
      </button>
      <button class="tool" title={disabled ? 'Enable' : 'Mute (skip at run time)'} onclick={() => actions.toggleDisabled(id)}>
        <span class="material-symbols-outlined">{disabled ? 'toggle_off' : 'toggle_on'}</span>
      </button>
      <button class="tool del" title="Delete" onclick={() => actions.remove(id)}>
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>
    {#if showColors}
      <div class="swatches">
        {#each COLORS as c (c)}
          <button
            class="sw"
            style="background:{c}"
            title={c}
            onclick={() => { actions.setColor(id, c); showColors = false; }}
          ></button>
        {/each}
        <button class="sw none" title="Reset" onclick={() => { actions.setColor(id, undefined); showColors = false; }}>
          <span class="material-symbols-outlined">format_color_reset</span>
        </button>
      </div>
    {/if}
  {/if}

  {#if config.type !== 'start'}
    <Handle type="target" position={Position.Left} />
  {/if}

  <div class="head">
    <span class="material-symbols-outlined icon">{ICONS[config.type]}</span>
    <div class="txt">
      {#if path}<div class="path">{path}</div>{/if}
      <div class="title">
        {#if config.type === 'start'}Start
        {:else if config.type === 'request'}{requestNode?.name ?? 'Pick a request…'}
        {:else if config.type === 'if'}If
        {:else if config.type === 'loop'}{config.kind === 'forEach' ? 'For each' : `Repeat ×${config.count ?? 0}`}
        {:else if config.type === 'script'}Script
        {:else if config.type === 'delay'}Delay {config.ms} ms
        {:else if config.type === 'output'}{config.label || 'Output'}
        {/if}
      </div>
      {#if config.type === 'if'}<div class="sub">{config.condition}</div>{/if}
      {#if config.type === 'script'}<div class="sub">{config.code.split('\n')[0]}</div>{/if}
    </div>
    {#if disabled}<span class="material-symbols-outlined mute-icon" title="Muted">toggle_off</span>{/if}
    {#if runState}<span class="dot"></span>{/if}
  </div>

  {#if config.type === 'request' && requestNode}
    <div class="meta">
      <span class="method">{requestNode.protocol === 'grpc' ? 'gRPC' : requestNode.request.method}</span>
      {#if row}
        <span class="status" class:bad={!row.ok}>{row.status} · {row.elapsedMs}ms</span>
      {/if}
      {#if variables.length > 0}
        <button class="vars" onclick={() => (showVars = !showVars)}>
          <span class="material-symbols-outlined" style="font-size:12px">{showVars ? 'expand_more' : 'chevron_right'}</span>
          Variables ({variables.length})
        </button>
      {/if}
    </div>

    {#if showVars && variables.length > 0}
      <div class="vlist">
        {#each variables as name (name)}
          <div class="vrow">
            <!-- Wire a block's output here to override this {{name}} for the run. -->
            <Handle id={varPortId(name)} type="target" position={Position.Left} class="vhandle" />
            <span class="vname mono">{name}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if ports.length === 1}
    <Handle id={ports[0]} type="source" position={Position.Right} />
  {:else if ports.length === 2}
    <Handle id={ports[0]} type="source" position={Position.Right} style="top:26px" />
    <Handle id={ports[1]} type="source" position={Position.Right} style="top:46px" />
    <span class="port-label a">{PORT_LABELS[ports[0]] ?? ports[0]}</span>
    <span class="port-label b">{PORT_LABELS[ports[1]] ?? ports[1]}</span>
  {/if}
</div>

<style>
  .fn {
    --fn-accent: var(--accent);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 150px;
    max-width: 230px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--sep);
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    font-size: 12px;
    color: var(--text);
    position: relative;
  }
  .fn.wide { min-width: 210px; max-width: 260px; }
  .fn.selected { border-color: var(--fn-accent); }
  .fn.running { border-color: var(--fn-accent); }
  .fn.ok { border-color: #34a853; }
  .fn.err { border-color: #ea4335; }
  .fn.muted { opacity: 0.55; border-style: dashed; }
  .head { display: flex; align-items: center; gap: 8px; }
  .icon { font-size: 16px; color: var(--fn-accent); flex: none; }
  .txt { min-width: 0; }
  .path {
    color: var(--t3);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 190px;
  }
  .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub {
    color: var(--t3);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 170px;
  }
  .mute-icon { font-size: 14px; color: var(--t3); flex: none; margin-left: auto; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; margin-left: auto; }
  .running .dot { background: var(--fn-accent); animation: fn-pulse 0.9s ease-in-out infinite; }
  .ok .dot { background: #34a853; }
  .err .dot { background: #ea4335; }
  @keyframes fn-pulse { 50% { opacity: 0.3; } }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    border-top: 0.5px solid var(--sep);
    padding-top: 5px;
  }
  .method {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: var(--fn-accent);
  }
  .status { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #34a853; }
  .status.bad { color: #ea4335; }
  .vars {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 9.5px;
    color: var(--t3);
    margin-left: auto;
  }
  .vars:hover { color: var(--text); }
  .vlist { display: flex; flex-direction: column; gap: 3px; }
  .vrow { position: relative; display: flex; align-items: center; gap: 5px; height: 16px; }
  .vname { font-size: 10px; color: var(--t2); }
  .vrow :global(.vhandle) {
    left: -12px;
    width: 7px;
    height: 7px;
    background: var(--surface);
    border: 1.5px solid var(--t3);
  }
  .vrow:hover :global(.vhandle) { border-color: var(--fn-accent); }
  .port-label {
    position: absolute;
    right: -6px;
    transform: translateX(100%);
    font-size: 9px;
    color: var(--t3);
    pointer-events: none;
  }
  .port-label.a { top: 20px; }
  .port-label.b { top: 40px; }
  .tools {
    position: absolute;
    top: -34px;
    left: 0;
    display: none;
    gap: 2px;
    padding: 3px;
    background: var(--surface);
    border: 1px solid var(--sep);
    border-radius: 8px;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
    z-index: 5;
  }
  .fn:hover .tools, .fn.selected .tools { display: flex; }
  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--t2);
  }
  .tool:hover { background: var(--hover); color: var(--text); }
  .tool.del:hover { color: #ea4335; }
  .tool .material-symbols-outlined { font-size: 14px; }
  .swatches {
    position: absolute;
    top: -34px;
    left: 100px;
    display: flex;
    gap: 3px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--sep);
    border-radius: 8px;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
    z-index: 6;
  }
  .sw { width: 14px; height: 14px; border-radius: 4px; }
  .sw.none {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--hover);
    color: var(--t2);
  }
  .sw.none .material-symbols-outlined { font-size: 11px; }
</style>
