import { get } from 'svelte/store';
import { t, type Translate } from '../i18n';
import type { HistoryEntry, RequestNode, TreeNode } from './types';

export interface PaletteRequest {
  node: RequestNode;
  /** Name of the folder the request lives in ('' at the root). */
  folder: string;
}

/** Saved requests whose name, URL, endpoint or folder contain `query` (case-insensitive), in tree order. */
export function searchRequests(nodes: TreeNode[], query: string, limit = 8): PaletteRequest[] {
  const q = query.trim().toLowerCase();
  const out: PaletteRequest[] = [];
  const walk = (list: TreeNode[], folder: string): void => {
    for (const n of list) {
      if (out.length >= limit) return;
      if (n.kind === 'folder') walk(n.children, n.name);
      else if (`${n.name}\n${n.request.url}\n${n.grpc?.endpoint ?? ''}\n${folder}`.toLowerCase().includes(q))
        out.push({ node: n, folder });
    }
  };
  walk(nodes, '');
  return out;
}

/** Environments whose name contains `query`; none for a blank query (the group would only add noise). */
export function searchEnvironments<T extends { name: string }>(envs: T[], query: string, limit = 5): T[] {
  const q = query.trim().toLowerCase();
  return q ? envs.filter((e) => e.name.toLowerCase().includes(q)).slice(0, limit) : [];
}

/** Environments the open picker numbers ⌘1…⌘9: the recents first, then the rest of the list without repeats. */
export function envShortcutTargets<T extends { id: string }>(recent: T[], all: T[], max = 9): T[] {
  return [...recent, ...all.filter((e) => !recent.some((r) => r.id === e.id))].slice(0, max);
}

export type PaletteSlot = { group: 'request' | 'env' | 'command'; index: number };

/** Which group (and position inside it) the flat row `i` of the palette list is: requests, then environments, then commands. */
export function paletteSlot(
  i: number,
  n: { requests: number; envs: number; commands: number },
): PaletteSlot | undefined {
  if (i < 0) return undefined;
  if (i < n.requests) return { group: 'request', index: i };
  if (i < n.requests + n.envs) return { group: 'env', index: i - n.requests };
  return i < n.requests + n.envs + n.commands ? { group: 'command', index: i - n.requests - n.envs } : undefined;
}

// Name heuristic: the fallback when an environment has no explicit `protected` flag.
export function isProductionEnv(name: string | undefined): boolean {
  return /prod/i.test(name ?? '');
}

export type EnvTone = 'production' | 'staging' | 'local' | 'other';

/** Colour role of an environment, read from its name (lock for production, amber staging, green local/dev). */
export function envTone(name: string | undefined): EnvTone {
  const n = name ?? '';
  if (isProductionEnv(n)) return 'production';
  if (/stag|uat/i.test(n)) return 'staging';
  if (/local|^dev\b|\bdev$/i.test(n)) return 'local';
  return 'other';
}

export const ENV_COLORS = ['red', 'amber', 'green', 'blue', 'violet', 'gray'] as const;
export type EnvColor = (typeof ENV_COLORS)[number];

/** CSS colour of each swatch (semantic tokens, no raw hex). */
export const ENV_COLOR_VAR: Record<EnvColor, string> = {
  red: 'var(--color-danger)',
  amber: 'var(--color-warning)',
  green: 'var(--color-success)',
  blue: 'var(--method-get)',
  violet: 'var(--purple)',
  gray: 'var(--color-text-muted)',
};

interface EnvLike {
  name: string;
  color?: string;
  protected?: boolean;
}

/** Explicit flag wins; otherwise production is recognised by name. */
export function isProtected(env: EnvLike | undefined): boolean {
  return env ? (env.protected ?? isProductionEnv(env.name)) : false;
}

/** Tone for chrome styling: protected reads as production, regardless of the name. */
export function envToneOf(env: EnvLike | undefined): EnvTone {
  if (isProtected(env)) return 'production';
  const t = envTone(env?.name);
  return t === 'production' ? 'other' : t;
}

const TONE_COLOR: Record<EnvTone, EnvColor> = { production: 'red', staging: 'amber', local: 'green', other: 'gray' };

/** Label colour: the chosen swatch, else the one implied by the name. */
export function envColor(env: EnvLike | undefined): EnvColor {
  const c = ENV_COLORS.find((k) => k === env?.color);
  return c ?? TONE_COLOR[envTone(env?.name)];
}

/** Most-recent-first id list: `id` moves to the front, capped at `limit`. */
export function pushRecent(list: string[], id: string, limit = 3): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, limit);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Requests that can change data must be confirmed before they reach production. */
export function needsProductionGuard(method: string, env: EnvLike | undefined): boolean {
  return isProtected(env) && !SAFE_METHODS.has(method.toUpperCase());
}

/** Short localized "time ago" label (ru: сейчас · 5 мин · 2 ч · вчера · 3 дн). Pass `$t` as `tr` from a component so it follows the language. */
export function timeAgo(at: number, now = Date.now(), tr: Translate = get(t)): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return tr('app.time.now');
  if (min < 60) return tr('app.time.min', { n: min });
  const h = Math.floor(min / 60);
  // Calendar days, not 24h windows: last night's call is «вчера» (S02).
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return tr('app.time.h', { n: h });
  return days === 1 ? tr('app.time.yesterday') : tr('app.time.d', { n: days });
}

export interface RecentRequest {
  entry: HistoryEntry;
  method: string;
  name: string;
  folder: string;
  status: string;
  ok: boolean;
}

/** The saved request a history entry was sent from (same method + URL, or same gRPC endpoint + method). */
export function matchSaved(entry: HistoryEntry, saved: PaletteRequest[]): PaletteRequest | undefined {
  if (entry.savedPath) {
    const hit = saved.find(({ node }) => node.id === entry.savedPath);
    if (hit) return hit;
  }
  return saved.find(({ node }) =>
    entry.protocol === 'grpc'
      ? node.grpc?.endpoint === entry.grpc?.endpoint && node.grpc?.method === entry.grpc?.method
      : node.request.method === entry.request.method && node.request.url === entry.request.url,
  );
}

/** History day group: Сегодня / Вчера / «12 сент.». */
export function historyDay(at: number, now = Date.now(), tr: Translate = get(t)): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return tr('app.day.today');
  if (diff === 1) return tr('app.day.yesterday');
  return new Date(at).toLocaleDateString(tr('app.dateLocale'), { day: 'numeric', month: 'short' });
}

/** HH:MM of a timestamp. */
export function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** What a history row shows as its target: the path after `{{baseUrl}}`/host, or `Service/Method` for gRPC. */
export function historyPath(entry: HistoryEntry): string {
  if (entry.protocol === 'grpc') {
    const symbol = entry.grpc?.method ?? '';
    const parts = symbol.split(/[./]/);
    return parts.length >= 2 ? `${parts.at(-2)}/${parts.at(-1)}` : symbol || 'gRPC';
  }
  const url = entry.request.url.replace(/[?#].*$/, '');
  return url.replace(/^\{\{[^{}]+\}\}/, '').replace(/^\w+:\/\/[^/]+/, '') || url || '/';
}

/** Latest distinct requests from history, named after the saved request they came from when there is one. */
export function recentRequests(history: HistoryEntry[], nodes: TreeNode[], limit = 4): RecentRequest[] {
  const saved = searchRequests(nodes, '', Infinity);
  const seen = new Set<string>();
  const out: RecentRequest[] = [];
  for (const entry of [...history].sort((a, b) => b.at - a.at)) {
    const grpc = entry.protocol === 'grpc';
    const target = grpc
      ? `${entry.grpc?.endpoint ?? ''} ${entry.grpc?.method ?? ''}`
      : `${entry.request.method} ${entry.request.url}`;
    if (seen.has(target)) continue;
    seen.add(target);
    const match = matchSaved(entry, saved);
    const ok = entry.ok ?? (entry.status >= 200 && entry.status < 300);
    const fallback = grpc
      ? (entry.grpc?.method ?? '').split(/[./]/).pop() || 'gRPC'
      : entry.request.url.replace(/^\w+:\/\/[^/]+/, '') || entry.request.url;
    out.push({
      entry,
      method: grpc ? 'gRPC' : entry.request.method.toUpperCase(),
      name: match?.node.name ?? fallback,
      folder: match?.folder ?? '',
      status: grpc ? (ok ? '0 OK' : 'ERR') : String(entry.status || 'ERR'),
      ok,
    });
    if (out.length >= limit) break;
  }
  return out;
}
