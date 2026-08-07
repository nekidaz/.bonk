/**
 * Pure types for Flows — node-graph orchestration of saved requests (a
 * Postman Flows-style feature). A Flow is a document: blocks positioned on a
 * canvas plus directed edges between named output ports and target blocks.
 *
 * Leaf module: types only, no imports from stores/api, so the import graph
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
}

/** Directed edge from a block's named output port to a target block. */
export interface FlowEdge {
  id: string;
  from: string;
  /** 'out' | 'true' | 'false' | 'each' | 'done' — see `outPorts`. */
  fromPort: string;
  to: string;
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
