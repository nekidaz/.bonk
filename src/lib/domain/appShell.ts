import type { RequestProtocol } from './types';

export type { RequestProtocol };

export type AppMenuKind = 'create' | 'switch' | 'coll' | 'req' | 'history' | null;
export type UtilityMode = 'terminal' | 'console' | 'issues';

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

export type PanelSnap = {
  collapsed: boolean;
  size: number;
};

/** Clamp a panel size, or collapse it completely once it crosses the snap edge. */
export function snapPanelSize(rawSize: number, min: number, max: number, collapseAt: number): PanelSnap {
  if (rawSize <= collapseAt) return { collapsed: true, size: min };
  return { collapsed: false, size: Math.min(max, Math.max(min, rawSize)) };
}
