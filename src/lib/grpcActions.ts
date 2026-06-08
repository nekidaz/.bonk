import { grpcTemplate } from './api';
import { updateActiveTab } from './stores';
import type { Tab } from './domain/types';

/** Serialize a gRPC metadata record as newline-separated `key: value` text. */
export function metaText(md: Record<string, string> | undefined): string {
  return Object.entries(md ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/** Human-readable label for the selected gRPC method, falling back to a connecting/placeholder state. */
export function grpcMethodLabel(t: Tab | undefined, connecting: boolean): string {
  const symbol = t?.grpc?.method;
  if (!symbol) return connecting ? 'Connecting...' : 'Select a method';
  for (const service of t?.grpc?.tree?.services ?? []) {
    const method = service.methods.find((m) => m.symbol === symbol);
    if (method) return method.name;
  }
  return symbol.split('.').pop() ?? symbol;
}

/**
 * Select a gRPC method and load its request template into the active tab's
 * message buffer. Used by GrpcEditor's method picker. On template failure the
 * method is still set so the user can hand-write a body.
 */
export async function selectMethod(connectionId: string, symbol: string): Promise<void> {
  updateActiveTab((t) => ({ ...t, grpc: { ...t.grpc!, method: symbol } }));
  try {
    const tpl = await grpcTemplate(connectionId, symbol);
    // Guard against a stale template response overwriting a newer method selection.
    updateActiveTab((t) =>
      t.grpc?.method === symbol
        ? { ...t, grpc: { ...t.grpc!, message: tpl } }
        : t,
    );
  } catch {
    // Keep the selected method; leave the existing message untouched.
  }
}
