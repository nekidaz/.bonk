import type { AppConsoleEntry } from '../stores/console';

/** Pure helpers for the bottom Console / Terminal panel (UtilityPanel). */

export type StatusTone = 'ok' | 'info' | 'warn' | 'err' | 'muted';

const GRPC_CODES: Record<string, number> = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
};

/** Label + colour of a console row's status: `200`, `404`, `0 OK`, `14 UNAVAILABLE`, or the raw text. */
export function consoleStatus(e: Pick<AppConsoleEntry, 'protocol' | 'status' | 'ok'>): {
  label: string;
  tone: StatusTone;
} {
  const raw = e.status.trim();
  if (e.protocol === 'grpc') {
    const name = raw.toUpperCase().replace(/[ -]/g, '_');
    const code = GRPC_CODES[name];
    return { label: code === undefined ? raw : `${code} ${name}`, tone: code === 0 ? 'ok' : 'err' };
  }
  const n = Number(raw);
  if (!/^\d{3}$/.test(raw)) return { label: raw, tone: 'err' };
  return { label: raw, tone: n >= 500 ? 'err' : n >= 400 ? 'warn' : n >= 300 ? 'info' : n >= 200 ? 'ok' : 'muted' };
}

/** Console filter: every whitespace-separated term must appear in the url, method or status (case-insensitive). */
export function matchesConsoleFilter(
  e: Pick<AppConsoleEntry, 'protocol' | 'method' | 'url' | 'status' | 'ok'>,
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay =
    `${e.url} ${e.method} ${e.status} ${consoleStatus(e).label} ${e.protocol === 'grpc' ? 'grpc' : 'http'}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** `128 ms`, `2.0 s`. */
export const formatElapsed = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

/** Prompt directory: `~` for home, `~/…/last` for deeper paths under home, else the last two segments. */
export function shortCwd(cwd: string, home: string): string {
  if (!cwd) return '~';
  const under = home && (cwd === home || cwd.startsWith(`${home}/`) || cwd.startsWith(`${home}\\`));
  const rel = under ? cwd.slice(home.length) : cwd;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (under) return parts.length === 0 ? '~' : parts.length === 1 ? `~/${parts[0]}` : `~/…/${parts.at(-1)}`;
  return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join('/')}`;
}
