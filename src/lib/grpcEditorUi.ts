import { writable } from 'svelte/store';
import type { GrpcService } from './domain/types';

export type GrpcEditorSection = 'message' | 'metadata' | 'auth' | 'proto' | 'scripts';

/** Per-request UI state so the response pane can navigate the sibling editor. */
export const grpcEditorSections = writable<Record<string, GrpcEditorSection>>({});

export function openGrpcEditorSection(tabId: string, section: GrpcEditorSection): void {
  grpcEditorSections.update((current) => ({ ...current, [tabId]: section }));
}

/** One-shot command from the response pane to the request's editor (S25 «Повторить» / TLS). */
export type GrpcEditorAction = { tabId: string; kind: 'reconnect' | 'tls' };
export const grpcEditorAction = writable<GrpcEditorAction | null>(null);

export function requestGrpcEditorAction(tabId: string, kind: GrpcEditorAction['kind']): void {
  grpcEditorAction.set({ tabId, kind });
}

export function clearGrpcEditorSection(tabId: string): void {
  grpcEditorSections.update((current) => {
    if (!(tabId in current)) return current;
    const { [tabId]: _removed, ...rest } = current;
    return rest;
  });
}

/**
 * Filter reflected/proto services for the method picker. A service-name match
 * keeps the full service visible; otherwise only matching RPCs are retained.
 * Full protobuf symbols are included so package-qualified searches work too.
 */
export function filterGrpcServices(services: GrpcService[], query: string): GrpcService[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return services;

  return services.flatMap((service) => {
    const serviceName = service.name.toLocaleLowerCase();
    if (terms.every((term) => serviceName.includes(term))) return [service];

    const methods = service.methods.filter((method) => {
      const haystack = `${service.name} ${method.name} ${method.symbol}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    return methods.length > 0 ? [{ ...service, methods }] : [];
  });
}
