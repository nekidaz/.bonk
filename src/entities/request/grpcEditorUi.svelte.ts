import { untrack } from 'svelte';
import type { GrpcService } from '$shared/model';

export type GrpcEditorSection = 'message' | 'metadata' | 'auth' | 'proto' | 'scripts';

/** One-shot command from the response pane to the request's editor (S25 «Повторить» / TLS). */
export type GrpcEditorAction = { tabId: string; kind: 'reconnect' | 'tls' };

/** gRPC editor UI state shared with the response pane, so it can drive the sibling editor. */
class GrpcEditorUi {
  /** Open section per tab id. */
  sections = $state.raw<Record<string, GrpcEditorSection>>({});
  /** Pending command for one tab's editor; the editor runs it and clears it. */
  action = $state.raw<GrpcEditorAction | null>(null);
}
export const grpcEditorUi = new GrpcEditorUi();

export function openGrpcEditorSection(tabId: string, section: GrpcEditorSection): void {
  grpcEditorUi.sections = { ...grpcEditorUi.sections, [tabId]: section };
}

export function requestGrpcEditorAction(tabId: string, kind: GrpcEditorAction['kind']): void {
  grpcEditorUi.action = { tabId, kind };
}

export function clearGrpcEditorSection(tabId: string): void {
  const current = untrack(() => grpcEditorUi.sections);
  if (!(tabId in current)) return;
  const { [tabId]: _removed, ...rest } = current;
  grpcEditorUi.sections = rest;
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
