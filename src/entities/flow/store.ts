import { get, writable } from 'svelte/store';
import { t } from '$shared/i18n';
import type { Tab, ScriptContext } from '$shared/model';
import type { Flow, FlowBlockConfig } from './flow';
import { executeFlow, type FlowBlockState, type FlowEffects, type FlowRunStatus } from './flowRun';
import { runScript } from '$shared/ipc';
import { findNode, collections } from '$entities/workspace';
import { tabs, activeTabId } from '$entities/tab';
import { applyScriptVars, activeEnvMap, globalsMap, runHttpNode, runGrpcNode } from '$entities/request';

// Flows (node-graph orchestration documents). Live in app-state like
// environments — they reference saved requests by id, not by content.
export const flows = writable<Flow[]>([]);

/**
 * Flows: CRUD over the persisted `flows` store, the per-run live state the
 * canvas renders (block badges + output log), and `runFlow`, which wires the
 * pure interpreter (`flowRun.ts`) to the real app: saved requests run
 * through the Collection Runner's headless pipeline, scripts/conditions run in
 * the sandbox with the block payload exposed, and env/globals writes fold into
 * the real stores exactly like everywhere else.
 *
 * Layering: depends on `entities/request` (incl. `execute.ts`), `entities/tab`,
 * `entities/workspace`, `shared/ipc` and pure model code only — slices stay acyclic.
 */

// ---- Live run state ----

export interface FlowOutputRow {
  blockId: string;
  label: string;
  payload: unknown;
  at: number;
}

export interface FlowRunState {
  status: 'idle' | 'running' | FlowRunStatus;
  flowId: string | null;
  /**
   * Per-block badge state + detail (a RunResultRow, an error string, …) and
   * `input`, the payload the block received (the node panel's Input tab).
   */
  blocks: Record<string, { state: FlowBlockState; detail?: unknown; input?: unknown }>;
  outputs: FlowOutputRow[];
  logs: string[];
  error?: string;
}

const IDLE: FlowRunState = { status: 'idle', flowId: null, blocks: {}, outputs: [], logs: [] };

export const flowRun = writable<FlowRunState>({ ...IDLE });

let cancelRequested = false;

/** Request cancellation; the interpreter checks between blocks. */
export function cancelFlowRun(): void {
  cancelRequested = true;
}

// ---- CRUD ----

/** Create a flow (with its Start block), select it, and open its tab. */
export function createFlow(name = get(t)('flow.new')): Flow {
  const flow: Flow = {
    id: crypto.randomUUID(),
    name,
    blocks: [{ id: crypto.randomUUID(), x: 80, y: 160, config: { type: 'start' } }],
    edges: [],
  };
  flows.update((list) => [...list, flow]);
  openFlowTab(flow.id);
  return flow;
}

export function renameFlow(id: string, name: string): void {
  flows.update((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
  tabs.update((list) => list.map((t) => (t.flowId === id ? { ...t, title: name } : t)));
}

/** Delete a flow and close any tabs showing it. */
export function deleteFlow(id: string): void {
  flows.update((list) => list.filter((f) => f.id !== id));
  const remaining = get(tabs).filter((t) => t.flowId !== id);
  tabs.set(remaining);
  if (!remaining.some((t) => t.id === get(activeTabId))) {
    activeTabId.set(remaining[0]?.id ?? '');
  }
}

/** Apply a canvas mutation to one flow (blocks/edges/positions). */
export function updateFlow(id: string, fn: (flow: Flow) => Flow): void {
  flows.update((list) => list.map((f) => (f.id === id ? fn(f) : f)));
}

/** Open (or focus) the tab for a flow. */
export function openFlowTab(flowId: string): void {
  const existing = get(tabs).find((t) => t.protocol === 'flow' && t.flowId === flowId);
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const flow = get(flows).find((f) => f.id === flowId);
  if (!flow) return;
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'flow',
    title: flow.name,
    manualTitle: true,
    request: { method: 'FLOW', url: '', headers: {} },
    flowId,
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

// ---- Run wiring ----

/** Parse a response body as JSON when possible, else pass the raw string. */
function parseMaybeJson(body: string | undefined): unknown {
  if (body === undefined || body === '') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Script context for a Flow block: no request/response, payload exposed. */
function flowScriptContext(payload: unknown): ScriptContext {
  return {
    request: { method: 'FLOW', url: '', headers: {} },
    response: null,
    environment: activeEnvMap(),
    globals: globalsMap(),
    iterationData: {},
    payload,
  };
}

/** The real interpreter effects, streaming progress into `flowRun`. */
function realEffects(): FlowEffects {
  return {
    runRequest: async (requestId, _payload, variables) => {
      const node = findNode(get(collections), requestId);
      if (!node || node.kind !== 'request') {
        throw new Error(get(t)('flow.run.missingRequest', { id: requestId }));
      }
      // Wired-in variables ride the runner's iterationData slot: it already wins
      // over env/globals in {{var}} resolution and in `pm.variables.get`.
      const row =
        node.protocol === 'grpc' ? await runGrpcNode(node, 1, variables) : await runHttpNode(node, 1, variables);
      flowRun.update((r) => ({ ...r, logs: [...r.logs, ...row.logs] }));
      return {
        row,
        output: {
          status: row.status,
          ok: row.ok,
          body: parseMaybeJson(row.responseBody),
          elapsedMs: row.elapsedMs,
          error: row.error,
        },
      };
    },
    runScript: async (code, payload) => {
      const res = await runScript('flow', code, flowScriptContext(payload));
      applyScriptVars(res);
      if (res.logs.length > 0) flowRun.update((r) => ({ ...r, logs: [...r.logs, ...res.logs] }));
      return { value: res.returnValue, logs: res.logs, error: res.error ?? undefined };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onBlock: (blockId, state, detail) =>
      flowRun.update((r) => {
        const previous = r.blocks[blockId];
        // 'running' carries the incoming payload; later states carry the result,
        // so keep the input around for the panel's Input tab.
        const entry = state === 'running' ? { state, input: detail } : { state, detail, input: previous?.input };
        return { ...r, blocks: { ...r.blocks, [blockId]: entry } };
      }),
    onOutput: (blockId, label, payload) =>
      flowRun.update((r) => ({
        ...r,
        outputs: [...r.outputs, { blockId, label, payload, at: Date.now() }],
      })),
    isCancelled: () => cancelRequested,
  };
}

/** Run a flow, streaming block states + outputs into `flowRun`. Never throws. */
export async function runFlow(flowId: string): Promise<void> {
  if (get(flowRun).status === 'running') return;
  const flow = get(flows).find((f) => f.id === flowId);
  if (!flow) return;
  cancelRequested = false;
  flowRun.set({ status: 'running', flowId, blocks: {}, outputs: [], logs: [] });
  const summary = await executeFlow(flow, realEffects());
  flowRun.update((r) => ({ ...r, status: summary.status, error: summary.error }));
}

/** Default config for a block added from the canvas palette. */
export function defaultBlockConfig(type: FlowBlockConfig['type']): FlowBlockConfig {
  switch (type) {
    case 'start':
      return { type: 'start' };
    case 'request':
      return { type: 'request', requestId: '' };
    case 'if':
      return { type: 'if', condition: 'payload.ok' };
    case 'loop':
      return { type: 'loop', kind: 'count', count: 3 };
    case 'script':
      return { type: 'script', code: 'return payload;' };
    case 'delay':
      return { type: 'delay', ms: 1000 };
    case 'output':
      return { type: 'output', label: get(t)('flow.block.output') };
  }
}

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
