<script lang="ts">
  /**
   * The Flow canvas, shown as a full-pane 'flow' tab (see openFlowTab). App
   * renders it inside {#key tab.flowId}, so component init IS flow load: the
   * canvas state seeds once from the store here, then the sync $effect below
   * mirrors every canvas mutation (drag, connect, delete, config edits) back
   * into the `flows` store, which persistence saves debounced.
   */
  import { SvelteFlow, Background, Controls, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { get } from 'svelte/store';
  import type { Tab, RequestNode, TreeNode, RunResultRow } from '../domain/types';
  import type { FlowBlock, FlowBlockType, FlowEdge } from '../domain/flow';
  import { isControlEdge, varPortName } from '../domain/flow';
  import { findNode } from '../domain/tree';
  import { requestVariableNames, type FlowNodeActions } from '../domain/flowNode';
  import {
    flows,
    collections,
    updateFlow,
    renameFlow,
    runFlow,
    cancelFlowRun,
    flowRun,
    defaultBlockConfig,
  } from '../stores';
  import FlowNode from './FlowNode.svelte';

  let { tab }: { tab: Tab } = $props();
  // Initial capture is intentional: App keys this component by tab.flowId, so a
  // different flow remounts it (that remount is what re-seeds the canvas).
  // svelte-ignore state_referenced_locally
  const flowId = tab.flowId ?? '';

  const nodeTypes = { bonk: FlowNode };

  // ---- Flow doc ⇄ canvas mapping ----

  function toNode(b: FlowBlock): Node {
    return {
      id: b.id,
      type: 'bonk',
      position: { x: b.x, y: b.y },
      data: { config: b.config, color: b.color, disabled: b.disabled, actions },
      deletable: b.config.type !== 'start',
    };
  }
  function toBlock(n: Node): FlowBlock {
    return {
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      config: n.data.config as FlowBlock['config'],
      color: n.data.color as string | undefined,
      disabled: n.data.disabled as boolean | undefined,
    };
  }
  function toCanvasEdge(e: FlowEdge): Edge {
    return {
      id: e.id,
      source: e.from,
      sourceHandle: e.fromPort,
      target: e.to,
      targetHandle: e.toPort,
      // A variable wire binds data instead of moving execution — draw it dashed.
      class: isControlEdge(e) ? undefined : 'fv-var-edge',
      animated: !isControlEdge(e),
    };
  }
  function toModelEdge(e: Edge): FlowEdge {
    const toPort = e.targetHandle ?? undefined;
    return {
      id: e.id,
      from: e.source,
      fromPort: e.sourceHandle ?? 'out',
      to: e.target,
      ...(varPortName(toPort) ? { toPort } : {}),
    };
  }

  /** Node hover-toolbar actions, handed to every node through its `data`. */
  const actions: FlowNodeActions = {
    setColor: (id, color) => {
      nodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, color } } : n));
    },
    toggleDisabled: (id) => {
      nodes = nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n,
      );
    },
    duplicate: (id) => {
      const source = nodes.find((n) => n.id === id);
      if (!source) return;
      const copy: Node = {
        ...source,
        id: crypto.randomUUID(),
        position: { x: source.position.x + 40, y: source.position.y + 40 },
        selected: false,
      };
      nodes = [...nodes, copy];
    },
    remove: (id) => {
      if (selectedId === id) selectedId = null;
      nodes = nodes.filter((n) => n.id !== id);
      edges = edges.filter((e) => e.source !== id && e.target !== id);
    },
  };

  const initial = get(flows).find((f) => f.id === flowId);
  let nodes = $state.raw<Node[]>((initial?.blocks ?? []).map(toNode));
  let edges = $state.raw<Edge[]>((initial?.edges ?? []).map(toCanvasEdge));

  // Mirror canvas → store (persistence handles disk, debounced).
  $effect(() => {
    const blocks = nodes.map(toBlock);
    const modelEdges = edges.map(toModelEdge);
    updateFlow(flowId, (f) => ({ ...f, blocks, edges: modelEdges }));
  });

  // ---- Selection + config panel ----

  let selectedId = $state<string | null>(null);
  const selectedBlock = $derived(nodes.find((n) => n.id === selectedId));
  const selectedConfig = $derived(selectedBlock?.data.config as FlowBlock['config'] | undefined);

  /** Panel tab. 'input'/'output'/'tests' read the selected block's last run. */
  let panelTab = $state<'config' | 'input' | 'output' | 'tests'>('config');

  /** The runner row for the selected request block's last run, if it ran. */
  const selectedRow = $derived.by(() => {
    if (!selectedId || selectedConfig?.type !== 'request') return undefined;
    const detail = $flowRun.blocks[selectedId]?.detail;
    return detail && typeof detail === 'object' ? (detail as RunResultRow) : undefined;
  });

  /** The payload that arrived at the selected block on its last run. */
  const selectedInput = $derived(selectedId ? $flowRun.blocks[selectedId]?.input : undefined);
  const ranSelected = $derived(Boolean(selectedId && $flowRun.blocks[selectedId]));

  /** `{{vars}}` the selected request references (Postman's per-node Variables). */
  const selectedVars = $derived.by(() => {
    if (selectedConfig?.type !== 'request' || !selectedConfig.requestId) return [];
    const node = findNode($collections, selectedConfig.requestId);
    return node?.kind === 'request' ? requestVariableNames(node.request) : [];
  });

  /** Which of those a variable edge already feeds. */
  const wiredVars = $derived(
    new Set(
      edges
        .filter((e) => e.target === selectedId)
        .map((e) => varPortName(e.targetHandle))
        .filter((name): name is string => name !== null),
    ),
  );

  /** Replace the selected block's config (panel edits). */
  function setConfig(config: FlowBlock['config']): void {
    nodes = nodes.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, config } } : n));
  }

  /** Delete the selected block and every edge touching it (panel button). */
  function deleteSelected(): void {
    const id = selectedId;
    if (!id) return;
    selectedId = null;
    nodes = nodes.filter((n) => n.id !== id);
    edges = edges.filter((e) => e.source !== id && e.target !== id);
  }

  function addBlock(type: FlowBlockType): void {
    const id = crypto.randomUUID();
    // Built through toNode so a palette block carries the same data as a loaded
    // one (notably `actions`, which the node's hover toolbar calls).
    nodes = [
      ...nodes,
      toNode({
        id,
        x: 140 + (nodes.length % 6) * 60,
        y: 140 + (nodes.length % 8) * 48,
        config: defaultBlockConfig(type),
      }),
    ];
    selectedId = id;
  }

  const PALETTE: { type: FlowBlockType; icon: string; label: string }[] = [
    { type: 'request', icon: 'send', label: 'Request' },
    { type: 'if', icon: 'alt_route', label: 'If' },
    { type: 'loop', icon: 'repeat', label: 'Loop' },
    { type: 'script', icon: 'code', label: 'Script' },
    { type: 'delay', icon: 'schedule', label: 'Delay' },
    { type: 'output', icon: 'terminal', label: 'Output' },
  ];

  // ---- Saved requests for the Request block picker ----

  function flattenRequests(ns: TreeNode[]): RequestNode[] {
    const out: RequestNode[] = [];
    for (const n of ns) {
      if (n.kind === 'request') out.push(n);
      else out.push(...flattenRequests(n.children));
    }
    return out;
  }
  const requestOptions = $derived(flattenRequests($collections));

  // ---- Run state ----

  const run = $derived($flowRun);
  const isThisFlow = $derived(run.flowId === flowId);
  const running = $derived(isThisFlow && run.status === 'running');

  const flowName = $derived($flows.find((f) => f.id === flowId)?.name ?? '');

  function fmt(payload: unknown): string {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return s === undefined ? 'undefined' : s.length > 400 ? `${s.slice(0, 400)}…` : s;
  }
</script>

<div class="bs-flowview">
  <div class="fv-toolbar">
    <input
      class="fv-name"
      value={flowName}
      onchange={(e) => renameFlow(flowId, (e.currentTarget as HTMLInputElement).value.trim() || 'Untitled Flow')}
    />
    <div class="fv-palette">
      {#each PALETTE as p (p.type)}
        <button class="fv-pbtn" title="Add {p.label}" onclick={() => addBlock(p.type)}>
          <span class="material-symbols-outlined" style="font-size:14px">{p.icon}</span>
          {p.label}
        </button>
      {/each}
    </div>
    <div class="fv-spacer"></div>
    {#if isThisFlow && run.status !== 'idle' && run.status !== 'running'}
      <span class="fv-status {run.status}">{run.status}{run.error ? ` — ${run.error}` : ''}</span>
    {/if}
    {#if running}
      <button class="fv-run stop" onclick={cancelFlowRun}>
        <span class="material-symbols-outlined" style="font-size:15px">stop</span>Stop
      </button>
    {:else}
      <button class="fv-run" onclick={() => void runFlow(flowId)}>
        <span class="material-symbols-outlined" style="font-size:15px">play_arrow</span>Run
      </button>
    {/if}
  </div>

  <div class="fv-body">
    <div class="fv-canvas">
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        deleteKey={['Backspace', 'Delete']}
        onnodeclick={({ node }) => (selectedId = node.id)}
        onpaneclick={() => (selectedId = null)}
      >
        <Background />
        <Controls showLock={false} />
      </SvelteFlow>
    </div>

    {#if selectedConfig}
      <aside class="fv-panel">
        {#if selectedConfig.type === 'request'}
          <div class="fv-tabs">
            {#each [{ id: 'config', label: 'Config' }, { id: 'input', label: 'Input' }, { id: 'output', label: 'Output' }, { id: 'tests', label: 'Tests' }] as t (t.id)}
              <button
                class="fv-tab"
                class:on={panelTab === t.id}
                onclick={() => (panelTab = t.id as typeof panelTab)}
              >
                {t.label}
                {#if t.id === 'tests' && selectedRow && selectedRow.tests.length > 0}
                  <span class="fv-tab-n" class:bad={selectedRow.tests.some((x) => !x.passed)}>{selectedRow.tests.length}</span>
                {/if}
              </button>
            {/each}
          </div>
        {:else}
          <div class="fv-panel-h">{selectedConfig.type}</div>
        {/if}

        {#if selectedConfig.type === 'request' && panelTab === 'input'}
          {#if !ranSelected}
            <p class="fv-hint">Run the flow to see what arrives at this block.</p>
          {:else}
            <p class="fv-hint">Payload from the upstream block:</p>
            <textarea class="fv-in mono" rows="14" readonly value={JSON.stringify(selectedInput ?? null, null, 2)}></textarea>
          {/if}
        {:else if selectedConfig.type === 'request' && panelTab !== 'config'}
          {#if !selectedRow}
            <p class="fv-hint">Run the flow to see this block's {panelTab}.</p>
          {:else if panelTab === 'output'}
            <div class="fv-kv"><span>Status</span><b class:bad={!selectedRow.ok}>{selectedRow.status}</b></div>
            <div class="fv-kv"><span>Time</span><b>{selectedRow.elapsedMs} ms</b></div>
            <div class="fv-kv"><span>Target</span><b class="wrap">{selectedRow.target}</b></div>
            {#if selectedRow.error}<div class="fv-err">{selectedRow.error}</div>{/if}
            <label class="fv-l" for="fv-body">Response body</label>
            <textarea id="fv-body" class="fv-in mono" rows="14" readonly value={selectedRow.responseBody ?? ''}></textarea>
          {:else if selectedRow.tests.length === 0}
            <p class="fv-hint">No tests ran for this request.</p>
          {:else}
            {#each selectedRow.tests as t, i (i)}
              <div class="fv-test" class:bad={!t.passed}>
                <span class="material-symbols-outlined" style="font-size:14px">{t.passed ? 'check_circle' : 'cancel'}</span>
                <span class="fv-test-n">{t.name}</span>
                {#if t.error}<span class="fv-test-e mono">{t.error}</span>{/if}
              </div>
            {/each}
          {/if}
        {:else if selectedConfig.type === 'start'}
          <p class="fv-hint">Entry point. Wire its output to the first block.</p>
        {:else if selectedConfig.type === 'request'}
          <label class="fv-l" for="fv-req">Saved request</label>
          <select
            id="fv-req"
            class="fv-in"
            value={selectedConfig.requestId}
            onchange={(e) => setConfig({ type: 'request', requestId: (e.currentTarget as HTMLSelectElement).value })}
          >
            <option value="" disabled>Pick a request…</option>
            {#each requestOptions as r (r.id)}
              <option value={r.id}>{r.name}</option>
            {/each}
          </select>
          {#if selectedVars.length > 0}
            <div class="fv-l">Variables ({selectedVars.length})</div>
            <div class="fv-vars">
              {#each selectedVars as name (name)}
                <span class="fv-var mono" class:wired={wiredVars.has(name)}>{name}</span>
              {/each}
            </div>
            <p class="fv-hint">
              Each has a port on the node's left edge: wire a block's output into it to
              override that value for this run. Unwired ones come from the environment.
            </p>
          {/if}
          <p class="fv-hint">
            Leaves through <b>Success</b> or <b>Fail</b>; payload is
            {'{ status, ok, body, elapsedMs, error }'}. An unwired Fail port ends that branch.
          </p>
        {:else if selectedConfig.type === 'if'}
          <label class="fv-l" for="fv-cond">Condition (JS, `payload` in scope)</label>
          <textarea
            id="fv-cond"
            class="fv-in mono"
            rows="3"
            value={selectedConfig.condition}
            onchange={(e) => setConfig({ type: 'if', condition: (e.currentTarget as HTMLTextAreaElement).value })}
          ></textarea>
        {:else if selectedConfig.type === 'loop'}
          <label class="fv-l" for="fv-kind">Kind</label>
          <select
            id="fv-kind"
            class="fv-in"
            value={selectedConfig.kind}
            onchange={(e) =>
              setConfig({
                type: 'loop',
                kind: (e.currentTarget as HTMLSelectElement).value as 'forEach' | 'count',
                count: selectedConfig.type === 'loop' ? selectedConfig.count : 3,
              })}
          >
            <option value="count">Repeat N times</option>
            <option value="forEach">For each item (array payload)</option>
          </select>
          {#if selectedConfig.kind === 'count'}
            <label class="fv-l" for="fv-count">Count</label>
            <input
              id="fv-count"
              class="fv-in"
              type="number"
              min="0"
              value={selectedConfig.count ?? 0}
              onchange={(e) => setConfig({ type: 'loop', kind: 'count', count: Number((e.currentTarget as HTMLInputElement).value) })}
            />
          {/if}
        {:else if selectedConfig.type === 'script'}
          <label class="fv-l" for="fv-code">Script (JS sandbox; `payload`, `pm.*`; `return` passes data on)</label>
          <!-- ponytail: plain textarea; swap in the CodeMirror wrapper if flows get heavy script use -->
          <textarea
            id="fv-code"
            class="fv-in mono"
            rows="10"
            value={selectedConfig.code}
            onchange={(e) => setConfig({ type: 'script', code: (e.currentTarget as HTMLTextAreaElement).value })}
          ></textarea>
        {:else if selectedConfig.type === 'delay'}
          <label class="fv-l" for="fv-ms">Delay (ms)</label>
          <input
            id="fv-ms"
            class="fv-in"
            type="number"
            min="0"
            value={selectedConfig.ms}
            onchange={(e) => setConfig({ type: 'delay', ms: Number((e.currentTarget as HTMLInputElement).value) })}
          />
        {:else if selectedConfig.type === 'output'}
          <label class="fv-l" for="fv-label">Label</label>
          <input
            id="fv-label"
            class="fv-in"
            value={selectedConfig.label}
            onchange={(e) => setConfig({ type: 'output', label: (e.currentTarget as HTMLInputElement).value })}
          />
        {/if}
        {#if selectedConfig.type !== 'start'}
          <button class="fv-del" onclick={deleteSelected}>
            <span class="material-symbols-outlined" style="font-size:14px">delete</span>
            Delete block
          </button>
        {/if}
        <p class="fv-hint">Backspace deletes the selected block / edge.</p>
      </aside>
    {/if}
  </div>

  {#if isThisFlow && (run.outputs.length > 0 || run.logs.length > 0 || run.error)}
    <div class="fv-out">
      {#each run.outputs as o (o.at + o.blockId)}
        <div class="fv-out-row"><span class="k">{o.label}</span><span class="v mono">{fmt(o.payload)}</span></div>
      {/each}
      {#each run.logs as l, i (i)}
        <div class="fv-out-row log"><span class="k">log</span><span class="v mono">{l}</span></div>
      {/each}
      {#if run.error}
        <div class="fv-out-row err"><span class="k">error</span><span class="v mono">{run.error}</span></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .bs-flowview {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--surface);
  }
  .fv-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 0.5px solid var(--sep);
  }
  .fv-name { flex: none; }
  .fv-name {
    width: 180px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .fv-name:hover { background: var(--hover); }
  .fv-name:focus { border-color: var(--accent); background: var(--surface); outline: none; }
  .fv-palette { display: flex; gap: 4px; }
  .fv-pbtn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--t2);
  }
  .fv-pbtn:hover { background: var(--hover); color: var(--text); }
  .fv-pbtn .material-symbols-outlined { color: var(--accent); }
  .fv-spacer { flex: 1; }
  .fv-status { font-size: 11px; color: var(--t2); max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fv-status.error { color: #ea4335; }
  .fv-status.done { color: #34a853; }
  .fv-run {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 10px;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }
  .fv-run.stop { background: #ea4335; }
  .fv-body { display: flex; flex: 1; min-height: 0; }
  .fv-canvas { flex: 1; min-width: 0; }
  .fv-canvas :global(.svelte-flow) {
    --xy-background-color: var(--surface);
    --xy-background-pattern-color: var(--sep);
    --xy-edge-stroke: var(--t3);
    --xy-edge-stroke-selected: var(--accent);
    --xy-connectionline-stroke: var(--accent);
    --xy-handle-background-color: var(--accent);
    --xy-handle-border-color: var(--surface);
    --xy-controls-button-background-color: var(--surface);
    --xy-controls-button-background-color-hover: var(--hover);
    --xy-controls-button-color: var(--t2);
    --xy-controls-button-border-color: var(--sep);
  }
  .fv-panel {
    width: 280px;
    flex: none;
    border-left: 0.5px solid var(--sep);
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fv-panel-h { font-size: 12px; font-weight: 700; color: var(--text); text-transform: capitalize; }
  .fv-tabs { display: flex; gap: 2px; border-bottom: 0.5px solid var(--sep); margin: -2px -12px 4px; padding: 0 10px; }
  .fv-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--t3);
    border-bottom: 2px solid transparent;
  }
  .fv-tab:hover { color: var(--text); }
  .fv-tab.on { color: var(--text); border-bottom-color: var(--accent); }
  .fv-tab-n { font-size: 9.5px; color: #34a853; }
  .fv-tab-n.bad { color: #ea4335; }
  .fv-kv { display: flex; gap: 8px; font-size: 11px; align-items: baseline; }
  .fv-kv span { color: var(--t3); min-width: 48px; flex: none; }
  .fv-kv b { color: var(--text); font-family: 'JetBrains Mono', monospace; font-weight: 600; }
  .fv-kv b.bad { color: #ea4335; }
  .fv-kv b.wrap { word-break: break-all; }
  .fv-err { font-size: 11px; color: #ea4335; word-break: break-word; }
  .fv-vars { display: flex; flex-wrap: wrap; gap: 4px; }
  .fv-var {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--hover);
    color: var(--t2);
  }
  .fv-var.wired { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .fv-canvas :global(.fv-var-edge path) { stroke-dasharray: 4 3; }
  .fv-test { display: flex; align-items: baseline; gap: 5px; font-size: 11px; color: #34a853; }
  .fv-test.bad { color: #ea4335; }
  .fv-test-n { color: var(--text); word-break: break-word; }
  .fv-test-e { color: #ea4335; font-size: 10px; word-break: break-word; }
  .fv-l { font-size: 11px; color: var(--t2); }
  .fv-in {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--sep);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
  }
  .fv-in:focus { border-color: var(--accent); outline: none; }
  .fv-in.mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; resize: vertical; }
  .fv-hint { font-size: 11px; color: var(--t3); }
  .fv-del {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid var(--sep);
    color: #ea4335;
    font-size: 12px;
    font-weight: 600;
    margin-top: 4px;
  }
  .fv-del:hover { background: rgba(234, 67, 53, 0.1); border-color: #ea4335; }
  .fv-out {
    max-height: 160px;
    overflow-y: auto;
    border-top: 0.5px solid var(--sep);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .fv-out-row { display: flex; gap: 8px; font-size: 11px; align-items: baseline; }
  .fv-out-row .k { color: var(--accent); font-weight: 700; flex: none; min-width: 60px; }
  .fv-out-row.log .k { color: var(--t3); }
  .fv-out-row.err .k { color: #ea4335; }
  .fv-out-row .v { color: var(--text); word-break: break-all; }
  .mono { font-family: 'JetBrains Mono', monospace; }
</style>
