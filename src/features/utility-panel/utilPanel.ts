import type { AppConsoleEntry } from '$entities/request';

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

/** CT3 quick filters. */
export type ConsoleQuick = 'all' | 'http' | 'grpc' | 'errors' | 'scripts';
export const CONSOLE_QUICK: ConsoleQuick[] = ['all', 'http', 'grpc', 'errors', 'scripts'];

export function matchesQuick(e: Pick<AppConsoleEntry, 'protocol' | 'ok' | 'scripted'>, q: ConsoleQuick): boolean {
  if (q === 'http') return e.protocol !== 'grpc';
  if (q === 'grpc') return e.protocol === 'grpc';
  if (q === 'errors') return !e.ok;
  if (q === 'scripts') return !!e.scripted;
  return true;
}

/** Headers whose values are credentials: shown masked, handed to the shell as `$BONK_*`. */
export const isSecretHeader = (name: string): boolean =>
  /^(authorization|proxy-authorization|cookie)$|token|secret|api-?key|password/i.test(name);

/** `Bearer abcdef4f2a` → `Bearer ••••4f2a`. */
export function maskSecret(value: string): string {
  const [, scheme = '', secret = value] = /^((?:Bearer|Basic|Token|Digest)\s+)?(.*)$/i.exec(value) ?? [];
  return `${scheme}••••${secret.length > 8 ? secret.slice(-4) : ''}`;
}

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * CT6: the sent request as a `curl` command for the panel's shell. Secret header values never
 * appear in the text: each becomes a `BONK_*` variable passed in `env` (`Bearer $BONK_TOKEN`).
 */
export function curlForShell(e: Pick<AppConsoleEntry, 'method' | 'url' | 'request'>): {
  command: string;
  env: Record<string, string>;
} {
  const env: Record<string, string> = {};
  const lines = [`curl -X ${e.method} ${sq(e.url)}`];
  for (const [name, value] of Object.entries(e.request?.headers ?? {})) {
    if (!isSecretHeader(name)) {
      lines.push(`-H ${sq(`${name}: ${value}`)}`);
      continue;
    }
    const bearer = /^(Bearer|Token)\s+(.+)$/i.exec(value);
    const key =
      bearer && /^authorization$/i.test(name) ? 'BONK_TOKEN' : `BONK_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
    env[key] = bearer ? bearer[2] : value;
    lines.push(`-H "${name.replace(/[^\w-]/g, '')}: ${bearer ? `${bearer[1]} ` : ''}$${key}"`);
  }
  if (e.request?.body) lines.push(`--data ${sq(e.request.body)}`);
  return { command: lines.join(' \\\n  '), env };
}
