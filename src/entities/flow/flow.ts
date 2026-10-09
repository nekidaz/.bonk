/**
 * Pure types for Flows — node-graph orchestration of saved requests (a
 * Postman Flows-style feature). A Flow is a document: blocks positioned on a
 * canvas plus directed edges between named output ports and target blocks.
 *
 * Leaf module: types only, no imports from stores or ipc, so the import graph
 * stays acyclic (matches `scripts.ts` / `tab.ts` layering).
 */

/** Discriminated per-block configuration. `config.type` is THE block type. */
export type FlowBlockConfig =
  | { type: 'start' }
  /** Runs a saved request from the collections tree (by node id). */
  | { type: 'request'; requestId: string }
  /** JS expression evaluated in the script sandbox against `payload`. */
  | { type: 'if'; condition: string }
  /** forEach: iterate an array payload; count: run the body `count` times. */
  | { type: 'loop'; kind: 'forEach' | 'count'; count?: number }
  /** JS block in the sandbox; its `return` value becomes the outgoing payload. */
  | { type: 'script'; code: string }
  | { type: 'delay'; ms: number }
  /** Terminal display block; logs the payload under `label`. */
  | { type: 'output'; label: string };

export type FlowBlockType = FlowBlockConfig['type'];

export interface FlowBlock {
  id: string;
  /** Canvas position. */
  x: number;
  y: number;
  config: FlowBlockConfig;
  /** Canvas accent picked from the node toolbar; the theme accent when unset. */
  color?: string;
  /** Skipped at run time — the payload passes straight through to its output. */
  disabled?: boolean;
}

/**
 * Directed edge. Two kinds, told apart by `toPort`:
 *  - control edge (`toPort` unset): the target block runs next, with the
 *    payload leaving `fromPort`.
 *  - variable edge (`toPort` = `var:<name>`): no control flow. It binds the
 *    source block's last output to the target request's `{{name}}` for that
 *    run, the way Postman Flows wires a value into a request variable.
 */
export interface FlowEdge {
  id: string;
  from: string;
  /** 'out' | 'success' | 'fail' | 'true' | 'false' | 'each' | 'done' — see `outPorts`. */
  fromPort: string;
  to: string;
  /** Target input port. Unset = control flow; `var:<name>` = variable binding. */
  toPort?: string;
}

/** Canvas handle id for a request block's `{{name}}` input port. */
export function varPortId(name: string): string {
  return `var:${name}`;
}

/** The variable name behind a `var:<name>` port id, or null for control ports. */
export function varPortName(port: string | undefined | null): string | null {
  return port && port.startsWith('var:') ? port.slice(4) : null;
}

/** True when `edge` moves execution (rather than binding a variable). */
export function isControlEdge(edge: FlowEdge): boolean {
  return varPortName(edge.toPort) === null;
}

export interface Flow {
  id: string;
  name: string;
  blocks: FlowBlock[];
  edges: FlowEdge[];
}

/** The named output ports a block type exposes (canvas handles + interpreter). */
export function outPorts(type: FlowBlockType): string[] {
  switch (type) {
    case 'request':
      return ['success', 'fail'];
    case 'if':
      return ['true', 'false'];
    case 'loop':
      return ['each', 'done'];
    case 'output':
      return [];
    default:
      return ['out'];
  }
}
