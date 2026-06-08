import type { RequestProtocol } from './types';

export type { RequestProtocol };

export type AppMenuKind = 'create' | 'switch' | 'coll' | 'req' | 'history' | null;

export type AppMenuState = {
  kind: AppMenuKind;
  x: number;
  y: number;
  nodeId?: string;
  isFolder?: boolean;
};

export function appMenuWidth(kind: Exclude<AppMenuKind, null>): number {
  if (kind === 'create') return 274;
  if (kind === 'switch') return 242;
  return 194;
}
