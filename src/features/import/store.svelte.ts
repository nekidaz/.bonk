// Import-window state that outlives the window: the recent sources list (IM2).
import { persisted } from '$shared/persist';

/** A file or link imported before; reopening it fetches it again. */
export interface RecentSource {
  kind: 'url' | 'file';
  location: string;
  /** `Petstore · OpenAPI 3.0`. */
  label: string;
  at: number;
}

const isRecent = (v: unknown): v is RecentSource[] =>
  Array.isArray(v) && v.every((r) => r && typeof r.location === 'string' && (r.kind === 'url' || r.kind === 'file'));

export const recentSources = persisted<RecentSource[]>('importRecent', [], isRecent);

export function rememberSource(r: Omit<RecentSource, 'at'>): void {
  recentSources.current = [
    { ...r, at: Date.now() },
    ...recentSources.current.filter((x) => x.location !== r.location),
  ].slice(0, 5);
}

export function forgetSource(location: string): void {
  recentSources.current = recentSources.current.filter((x) => x.location !== location);
}
