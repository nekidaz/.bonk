import { get } from 'svelte/store';
import type { Tab } from './domain/types';
import { t, type Translate } from './i18n';

/** Human-readable label for the selected gRPC method, falling back to a connecting/placeholder state. */
export function grpcMethodLabel(tab: Tab | undefined, connecting: boolean, tr: Translate = get(t)): string {
  const symbol = tab?.grpc?.method;
  if (!symbol) return connecting ? tr('grpc.connecting') : tr('grpc.selectMethod');
  for (const service of tab?.grpc?.tree?.services ?? []) {
    const method = service.methods.find((m) => m.symbol === symbol);
    if (method) return method.name;
  }
  return symbol.split('.').pop() ?? symbol;
}
