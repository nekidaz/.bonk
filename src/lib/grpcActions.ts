import type { Tab } from './domain/types';

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
