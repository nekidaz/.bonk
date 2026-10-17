/**
 * Flow · gRPC Stream (and Flow · SSE): pure helpers for the stream feed (filter, intervals, counters, clocks).
 */
import type { GrpcStreamMessage, SseEvent, StreamEnd } from '$shared/model';

/** A feed row; SSE rows carry a label (event name, `#id`) in place of the direction arrow. */
export type FeedMessage = GrpcStreamMessage & { label?: string };

const utf8 = new TextEncoder();

/** Row per event object: the live feed re-maps the whole array on every event, keep old rows (and their keyed
 *  {#each} templates) untouched so only the new event costs anything. */
const sseRows = new WeakMap<SseEvent, FeedMessage>();

/** SSE events as feed rows: body = data; label = event name (if not 'message') and `#id`. */
export function sseMessages(events: SseEvent[]): FeedMessage[] {
  return events.map((e) => {
    let row = sseRows.get(e);
    if (!row) {
      const label = [e.event !== 'message' ? e.event : '', e.id ? `#${e.id}` : ''].filter(Boolean).join(' ');
      row = {
        index: e.index,
        atMs: e.at_ms,
        body: e.data,
        sizeBytes: utf8.encode(e.data).length,
        label: label || undefined,
      };
      sseRows.set(e, row);
    }
    return row;
  });
}

/** i18n key of the closing line. */
export const sseEndKey = (end: StreamEnd): string => `response.stream.sse_${end.reason}`;

export type StreamDirection = 'all' | 'sent' | 'recv';
export type StreamKind = 'server' | 'client' | 'bidi';

/** HH:MM:SS.mmm, or MM:SS.mmm when `short` (the feed beside the message pane). */
export function streamClock(ms: number, short = false): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const tail = `${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return short ? tail : `${p(d.getHours())}:${tail}`;
}

/** `+1.00 s` in a row, `+1.002 s` in the message pane. */
export const intervalLabel = (ms: number, digits = 2): string => `+${(ms / 1000).toFixed(digits)} s`;

/** Time since the message before it (either direction) or the half-close, or since the stream started. */
export function intervalMs(messages: GrpcStreamMessage[], i: number, startedAt: number, halfClosedAt = 0): number {
  const at = messages[i].atMs;
  const prev = Math.max(i > 0 ? messages[i - 1].atMs : startedAt, halfClosedAt <= at ? halfClosedAt : 0);
  return Math.max(0, at - prev);
}

/** Pill counter: `12` for a server stream, `↑3` / `↑2 ↓4` once our side streams too. */
export function streamCount(
  kind: StreamKind,
  messages: GrpcStreamMessage[],
  fmt: (n: number) => string = String,
): string {
  const sent = messages.filter((m) => m.sent).length;
  const recv = messages.length - sent;
  if (kind === 'server') return fmt(recv);
  return kind === 'client' && !recv ? `↑${fmt(sent)}` : `↑${fmt(sent)} ↓${fmt(recv)}`;
}

const PATH_QUERY = /^\$((?:\.[\w-]+|\[\d+\])*)\s*(==|!=|>=|<=|>|<)?\s*(.*)$/;

function atPath(value: unknown, path: string): unknown {
  for (const [, key, idx] of path.matchAll(/\.([\w-]+)|\[(\d+)\]/g)) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key ?? idx];
  }
  return value;
}

/**
 * Feed filter: plain text matches anywhere (case-insensitive); `$.a.b` keeps messages that have the
 * field, `$.rate > 486` / `$.symbol == "USD"` compare it (numbers numerically, the rest as strings).
 */
export function matchesFilter(body: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const m = q.startsWith('$') ? PATH_QUERY.exec(q) : null;
  if (!m) return body.toLowerCase().includes(q.toLowerCase());
  let v: unknown;
  try {
    v = atPath(JSON.parse(body), m[1]);
  } catch {
    return false;
  }
  if (!m[2]) return v !== undefined;
  const rhs = m[3].trim().replace(/^"(.*)"$/, '$1');
  const num = Number(rhs);
  if (typeof v === 'number' && rhs !== '' && Number.isFinite(num)) {
    switch (m[2]) {
      case '==':
        return v === num;
      case '!=':
        return v !== num;
      case '>':
        return v > num;
      case '<':
        return v < num;
      case '>=':
        return v >= num;
      default:
        return v <= num;
    }
  }
  if (m[2] === '==') return String(v) === rhs;
  if (m[2] === '!=') return String(v) !== rhs;
  return false;
}

export function visibleMessages<M extends GrpcStreamMessage>(messages: M[], dir: StreamDirection, query: string): M[] {
  if (dir === 'all' && !query.trim()) return messages;
  return messages.filter((m) => (dir === 'all' || (dir === 'sent') === !!m.sent) && matchesFilter(m.body, query));
}

/** A spaced single line (`{ "k": v }`) for a feed row. */
export function inlineJson(body: string): string {
  try {
    const v: unknown = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v)
      ? `{ ${Object.entries(v)
          .map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`)
          .join(', ')} }`
      : JSON.stringify(v);
  } catch {
    return body;
  }
}

/** Pretty JSON for the message pane; non-JSON as is. */
export function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** JSON text split into syntax tokens: k(ey), s(tring), n(umber/literal), p(unctuation). */
export function jsonTokens(text: string): { text: string; kind: string }[] {
  const out: { text: string; kind: string }[] = [];
  for (const m of text.matchAll(
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([^"\d\-tfn]+|.)/g,
  )) {
    if (m[1]) {
      out.push({ text: m[1], kind: m[2] ? 'k' : 's' });
      if (m[2]) out.push({ text: m[2], kind: 'p' });
    } else if (m[3]) out.push({ text: m[3], kind: 'n' });
    else out.push({ text: m[0], kind: 'p' });
  }
  return out;
}

/** `1 312` / `1,312`. */
export const formatCount = (n: number): string => n.toLocaleString('en-US');
