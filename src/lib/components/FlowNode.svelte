<script lang="ts">
  /**
   * One block on the Flow canvas: icon + title + a live status dot fed by the
   * `flowRun` store. Output ports come from `outPorts(type)` — one right-side
   * handle per port, labeled when there are two (if / loop).
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { outPorts, type FlowBlockConfig } from '../domain/flow';
  import { collections, flowRun } from '../stores';
  import { findNode } from '../domain/tree';

  let { id, data, selected }: NodeProps = $props();

  const config = $derived(data.config as FlowBlockConfig);
  const ports = $derived(outPorts(config.type));
  const state = $derived($flowRun.blocks[id]?.state);

  const ICONS: Record<FlowBlockConfig['type'], string> = {
    start: 'play_arrow',
    request: 'send',
    if: 'alt_route',
    loop: 'repeat',
    script: 'code',
    delay: 'schedule',
    output: 'terminal',
  };

  const title = $derived.by(() => {
    switch (config.type) {
      case 'start': return 'Start';
      case 'request': {
        const node = config.requestId ? findNode($collections, config.requestId) : undefined;
        return node?.name ?? 'Pick a request…';
      }
      case 'if': return 'If';
      case 'loop': return config.kind === 'forEach' ? 'For each' : `Repeat ×${config.count ?? 0}`;
      case 'script': return 'Script';
      case 'delay': return `Delay ${config.ms} ms`;
      case 'output': return config.label || 'Output';
    }
  });

  const subtitle = $derived.by(() => {
    switch (config.type) {
      case 'if': return config.condition;
      case 'script': return config.code.split('\n')[0];
      default: return '';
    }
  });
</script>

<div class="fn" class:selected class:running={state === 'running'} class:ok={state === 'ok'} class:err={state === 'error'}>
  {#if config.type !== 'start'}
    <Handle type="target" position={Position.Left} />
  {/if}

  <span class="material-symbols-outlined icon">{ICONS[config.type]}</span>
  <div class="txt">
    <div class="title">{title}</div>
    {#if subtitle}<div class="sub">{subtitle}</div>{/if}
  </div>
  {#if state}<span class="dot"></span>{/if}

  {#if ports.length === 1}
    <Handle id={ports[0]} type="source" position={Position.Right} />
  {:else if ports.length === 2}
    <Handle id={ports[0]} type="source" position={Position.Right} style="top:32%" />
    <Handle id={ports[1]} type="source" position={Position.Right} style="top:72%" />
    <span class="port-label a">{ports[0]}</span>
    <span class="port-label b">{ports[1]}</span>
  {/if}
</div>

<style>
  .fn {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .fn.selected { border-color: var(--accent); }
  .fn.running { border-color: var(--accent); }
  .fn.ok { border-color: #34a853; }
  .fn.err { border-color: #ea4335; }
  .icon { font-size: 16px; color: var(--accent); flex: none; }
  .txt { min-width: 0; }
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
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; margin-left: auto; }
  .running .dot { background: var(--accent); animation: fn-pulse 0.9s ease-in-out infinite; }
  .ok .dot { background: #34a853; }
  .err .dot { background: #ea4335; }
  @keyframes fn-pulse { 50% { opacity: 0.3; } }
  .port-label {
    position: absolute;
    right: -6px;
    transform: translateX(100%);
    font-size: 9px;
    color: var(--t3);
    pointer-events: none;
  }
  .port-label.a { top: 22%; }
  .port-label.b { top: 62%; }
</style>
