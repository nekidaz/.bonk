/**
 * Pure helpers for what a Flow request block shows about its saved request.
 *
 * Leaf module: depends on `vars`/`types` only, so the import graph stays acyclic
 * (same layering as `flow.ts` / `tab.ts`).
 */
import type { HttpRequest } from './types';
import { findVariables } from './vars';

/**
 * Node hover-toolbar callbacks. FlowView owns the canvas node array, so it
 * implements these and hands them to each node through its `data`.
 */
export interface FlowNodeActions {
  setColor(id: string, color: string | undefined): void;
  duplicate(id: string): void;
  toggleDisabled(id: string): void;
  remove(id: string): void;
}

/**
 * Distinct `{{variable}}` names the request references, in first-seen order
 * across URL, headers, body params and body — what Postman Flows lists on the
 * node as "Variables (n)".
 */
export function requestVariableNames(request: HttpRequest): string[] {
  const texts = [
    request.url,
    ...Object.entries(request.headers ?? {}).flat(),
    ...(request.bodyParams ?? []).flatMap((p) => [p.key, p.value]),
    request.body ?? '',
  ];
  const names: string[] = [];
  for (const text of texts) {
    for (const match of findVariables(text ?? '')) {
      if (!names.includes(match.name)) names.push(match.name);
    }
  }
  return names;
}
