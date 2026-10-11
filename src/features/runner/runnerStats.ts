import type { RequestNode, RunResultRow, ScriptTestResult } from '$shared/model';
import { t, type Translate } from '$shared/i18n';

/**
 * Pure Collection Runner math: run summaries + history deltas, the
 * requests × iterations matrix, waterfall geometry and the "likely cause"
 * heuristic. No stores, no I/O — RunnerView and store.ts call in.
 */

/** One finished run, persisted (last 10) for the summary deltas + bar chart. */
export interface RunSummary {
  n: number;
  startedAt: number;
  passed: number;
  total: number;
  durationMs: number;
  p95Ms: number;
  /** Run scope + settings, for the R1 "last run" status and "repeat a recent run" cards. */
  title?: string;
  folderIds?: string[];
  envId?: string | null;
  envName?: string;
  iterations?: number;
}

export type Tone = 'success' | 'warning' | 'danger';
export interface Delta {
  text: string;
  tone: Tone;
}

/** Calls slower than this are amber in the waterfall / time column. */
export const SLOW_MS = 200;
export const HISTORY_LIMIT = 10;

/** Russian plural: plural(2, ['запрос', 'запроса', 'запросов']) → 'запроса'. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Nearest-rank 95th percentile; 0 for no values. */
export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

/** Duration is the runner's own monotonic clock (the last row's `endMs`, like the waterfall); wall time only for rows without it. */
export function summarizeRun(n: number, startedAt: number, finishedAt: number, rows: RunResultRow[]): RunSummary {
  const ends = rows.flatMap((r) => (r.endMs === undefined ? [] : [r.endMs]));
  return {
    n,
    startedAt,
    passed: rows.filter((r) => r.ok).length,
    total: rows.length,
    durationMs: ends.length > 0 ? Math.max(...ends) : Math.max(0, finishedAt - startedAt),
    p95Ms: p95(rows.map((r) => r.elapsedMs)),
  };
}

/** Append `s`, keeping the newest `limit` runs. */
export function pushHistory(list: RunSummary[], s: RunSummary, limit = HISTORY_LIMIT): RunSummary[] {
  return [...list, s].slice(-limit);
}

const sign = (d: number) => (d < 0 ? '−' : '+');

export function passedDelta(cur: RunSummary, prev: RunSummary | undefined, tr: Translate = t): Delta | null {
  if (!prev) return null;
  const d = cur.passed - prev.passed;
  if (d === 0) return null;
  return {
    text: tr('runner.delta.vs', { delta: `${sign(d)}${Math.abs(d)}`, n: prev.n }),
    tone: d < 0 ? 'danger' : 'success',
  };
}

export function durationDelta(cur: RunSummary, prev: RunSummary | undefined): Delta | null {
  if (!prev) return null;
  const d = Math.round((cur.durationMs - prev.durationMs) / 100) / 10;
  if (d === 0) return null;
  return { text: `${sign(d)}${Math.abs(d).toFixed(1)} s`, tone: d < 0 ? 'success' : 'warning' };
}

export function p95Delta(cur: RunSummary, prev: RunSummary | undefined): Delta | null {
  if (!prev) return null;
  const d = cur.p95Ms - prev.p95Ms;
  if (d === 0) return null;
  return { text: `${sign(d)}${Math.abs(d)} ms`, tone: d < 0 ? 'success' : 'warning' };
}

/** Bar chart of recent runs: height grows with duration (half..full of `maxH` across the range), red when any call failed. */
export function runBars(history: RunSummary[], maxH = 28): { n: number; h: number; failed: boolean }[] {
  const ds = history.map((s) => s.durationMs);
  const min = Math.min(...ds);
  const span = Math.max(...ds) - min || 1;
  return history.map((s) => ({
    n: s.n,
    h: Math.round(maxH * (0.5 + (0.5 * (s.durationMs - min)) / span)),
    failed: s.passed < s.total,
  }));
}

/** "СЕГОДНЯ 14:20", or "07.10 14:20" for another day. */
export function runTimeLabel(ts: number, now = Date.now(), tr: Translate = t): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString()
    ? tr('runner.today', { time: hm })
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
}

/** "сегодня" / "вчера" / "3 дня назад" (calendar days, current UI language). */
export function relDay(ts: number, lang: string, now = Date.now()): string {
  const day = (x: number) => Math.floor((x - new Date(x).getTimezoneOffset() * 60_000) / 86_400_000);
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(day(ts) - day(now), 'day');
}

// ---- Setup (R2) ----

/** Number of `pm.test(` calls in the request's test script. */
export function testCount(n: RequestNode): number {
  const src = (n.protocol === 'grpc' ? n.grpc?.testScript : n.request.testScript) ?? '';
  return src.match(/\bpm\.test\s*\(/g)?.length ?? 0;
}

/** Variables the request's scripts set (`pm.environment.set('x', …)` and friends). */
export function varsSet(n: RequestNode): string[] {
  const g = n.grpc;
  const src = [n.request.preRequestScript, n.request.testScript, g?.preRequestScript, g?.testScript].join('\n');
  return [
    ...new Set(
      [...src.matchAll(/\bpm\.(?:environment|globals|collectionVariables|variables)\.set\(\s*['"`]([\w.-]+)/g)].map(
        (m) => m[1],
      ),
    ),
  ];
}

/** `{{vars}}` the request reads (url, params, headers, body, gRPC message/metadata). */
export function varsUsed(n: RequestNode): string[] {
  const src = JSON.stringify([
    n.request.url,
    n.request.headers,
    n.request.body,
    n.params,
    n.grpc?.endpoint,
    n.grpc?.message,
    n.grpc?.metadata,
  ]);
  return [...new Set([...src.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]))];
}

/**
 * Hand-offs between the planned requests: the vars each request sets that a
 * later one reads (`sets`), and the vars it reads that an earlier one set (`uses`).
 */
export function varLinks(list: RequestNode[]): { sets: string[]; uses: string[] }[] {
  const set = list.map(varsSet);
  const used = list.map(varsUsed);
  return list.map((_, i) => ({
    sets: set[i].filter((v) => used.slice(i + 1).some((u) => u.includes(v))),
    uses: used[i].filter((v) => set.slice(0, i).some((s) => s.includes(v))),
  }));
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};
/** "404 Not Found"; gRPC/text statuses pass through. */
export function statusLabel(status: number | string): string {
  return typeof status === 'number' && STATUS_TEXT[status] ? `${status} ${STATUS_TEXT[status]}` : String(status);
}

// ---- Matrix ----

export interface MatrixRow {
  key: string;
  name: string;
  method: string;
  protocol: RunResultRow['protocol'];
  nodeId?: string;
  /** Index = iteration - 1. */
  cells: (RunResultRow | undefined)[];
}

const rowKey = (r: RunResultRow) => r.nodeId ?? `${r.method} ${r.requestName}`;

/** Requests (first-seen order) × iterations. */
export function buildMatrix(rows: RunResultRow[], iterations: number): MatrixRow[] {
  const byKey = new Map<string, MatrixRow>();
  for (const r of rows) {
    const key = rowKey(r);
    let m = byKey.get(key);
    if (!m) {
      m = {
        key,
        name: r.requestName,
        method: r.method,
        protocol: r.protocol,
        nodeId: r.nodeId,
        cells: Array(iterations).fill(undefined),
      };
      byKey.set(key, m);
    }
    m.cells[r.iteration - 1] = r;
  }
  return [...byKey.values()];
}

export type CallTone = 'normal' | 'slow' | 'error';
export function callTone(r: RunResultRow): CallTone {
  if (!r.ok) return 'error';
  return r.elapsedMs > SLOW_MS ? 'slow' : 'normal';
}

export interface WaterfallBar {
  left: number;
  width: number;
  tone: CallTone;
}

/** Bar geometry (percent of the iteration's span) for one iteration's calls. */
export function waterfall(cells: (RunResultRow | undefined)[]): (WaterfallBar | null)[] {
  const end = Math.max(1, ...cells.map((c) => (c ? (c.startOffsetMs ?? 0) + c.elapsedMs : 0)));
  return cells.map((c) =>
    c ? { left: ((c.startOffsetMs ?? 0) / end) * 100, width: (c.elapsedMs / end) * 100, tone: callTone(c) } : null,
  );
}

// ---- Detail panel ----

/** Right-hand note on a test line: the failure, or the measured time for a timing test. */
export function testDetail(t: ScriptTestResult, row: RunResultRow): string {
  if (!t.passed) return t.error ?? '';
  return /time|время/i.test(t.name) ? `${row.elapsedMs} ms` : '';
}

/** One-line JSON preview: `{ "error": "payment not found" }`. */
export function compactJson(body: string | undefined, max = 400): string {
  const raw = (body ?? '').trim();
  let out: string;
  try {
    out = JSON.stringify(JSON.parse(raw), null, 1).replace(/\n\s*/g, ' ');
  } catch {
    out = raw;
  }
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Suggested fix: take `literal` in the failing URL from `source`'s response `id`. */
export interface IdBinding {
  sourceNodeId?: string;
  sourceName: string;
  literal: string;
  varName: string;
}
export interface Insight {
  text: string;
  bind?: IdBinding;
}

function pathSegments(target: string): string[] {
  try {
    return new URL(target).pathname.split('/').filter(Boolean);
  } catch {
    return target.split('?')[0].split('/').filter(Boolean);
  }
}
const idPrefix = (s: string) => /^([A-Za-z]+)[_-][A-Za-z0-9]+$/.exec(s)?.[1];
function jsonId(body: string | undefined): string | undefined {
  try {
    const v = JSON.parse(body ?? '');
    return typeof v?.id === 'string' ? v.id : undefined;
  } catch {
    return undefined;
  }
}
/** "payments" → "paymentId", "categories" → "categoryId". */
function varNameFor(segment: string | undefined): string {
  if (!segment || !/^[A-Za-z]+$/.test(segment)) return 'id';
  const one = segment.replace(/ies$/, 'y').replace(/s$/, '');
  return `${one}Id`;
}

/**
 * ponytail: naive heuristic. A literal id segment in the failing URL whose
 * prefix (`pay_`) matches an `id` an earlier call of the same iteration
 * returned → suggest binding it. Upgrade path: real response→request lineage.
 */
function findBinding(row: RunResultRow, rows: RunResultRow[]): IdBinding | undefined {
  const segs = pathSegments(row.target);
  for (let i = rows.indexOf(row) - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.iteration !== row.iteration || !r.ok) continue;
    const id = jsonId(r.responseBody);
    const prefix = id && idPrefix(id);
    if (!prefix) continue;
    const k = segs.findIndex((s) => s !== id && idPrefix(s) === prefix);
    if (k >= 0)
      return { sourceNodeId: r.nodeId, sourceName: r.requestName, literal: segs[k], varName: varNameFor(segs[k - 1]) };
  }
  return undefined;
}

/** "Похоже на причину" for a failed call, or null when nothing honest to say. */
export function insightFor(row: RunResultRow, rows: RunResultRow[], tr: Translate = t): Insight | null {
  if (row.ok || typeof row.status !== 'number') return null;
  const prev = rows.find(
    (r) => r.iteration < row.iteration && r.ok && rowKey(r) === rowKey(row) && r.target === row.target,
  );
  const next =
    row.iteration >= 1 && row.iteration <= 10
      ? tr(`runner.insight.ord.${row.iteration}`)
      : tr('runner.insight.inIter', { n: row.iteration });
  if (row.status === 404 || row.status === 410) {
    const bind = findBinding(row, rows);
    if (prev) {
      const gone = tr(row.method === 'DELETE' ? 'runner.insight.gone.deleted' : 'runner.insight.gone.changed');
      return {
        text: tr('runner.insight.resourceGone', { iter: prev.iteration, status: prev.status, gone, next }),
        bind,
      };
    }
    if (bind) return { text: tr('runner.insight.newId', { literal: bind.literal, source: bind.sourceName }), bind };
    return null;
  }
  if ((row.status === 401 || row.status === 403) && prev) {
    return { text: tr('runner.insight.token', { n: prev.iteration, status: prev.status }) };
  }
  return null;
}

// ---- Persisted per-call results of recent runs (R4 bars → open a past run) ----

/** A finished run with its calls, kept (last HISTORY_LIMIT) so a past run can be reopened read-only. */
export interface RunRecord {
  n: number;
  startedAt: number;
  finishedAt: number;
  iterations: number;
  results: RunResultRow[];
}

/** Bounds keep app state small: 10 runs × RECORD_ROWS × RECORD_BODY chars. */
export const RECORD_ROWS = 200;
export const RECORD_BODY = 2000;

/** Snapshot of a run for persistence; response bodies are kept (truncated) only when `keepBodies`. */
export function toRecord(
  run: { n: number; startedAt: number; finishedAt: number; iterations: number; results: RunResultRow[] },
  keepBodies: boolean,
): RunRecord {
  const results = run.results
    .slice(0, RECORD_ROWS)
    .map(({ responseBody, ...row }) =>
      keepBodies && responseBody !== undefined ? { ...row, responseBody: responseBody.slice(0, RECORD_BODY) } : row,
    );
  return { n: run.n, startedAt: run.startedAt, finishedAt: run.finishedAt, iterations: run.iterations, results };
}

/** Add or replace the record for `rec.n`, keeping the newest `limit`. */
export function pushRecord(list: RunRecord[], rec: RunRecord, limit = HISTORY_LIMIT): RunRecord[] {
  return [...list.filter((r) => r.n !== rec.n), rec].sort((a, b) => a.n - b.n).slice(-limit);
}
