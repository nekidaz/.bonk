/**
 * Environment ⇄ JSON (Flow · Environments from JSON). Pure.
 * The JSON is read by a small parser of our own, not `JSON.parse`: the Tauri webview (WebKit) does not
 * report where a syntax error is, and the editor has to point at the line. Numbers are kept as written.
 */
import { maskSecret } from './vars';
import type { VarRow } from './types';

type J = { k: 'v'; s: string } | { k: 'a'; items: J[]; raw: string } | { k: 'o'; entries: [string, J][] };

export type EnvJsonErrorCode = 'comma' | 'unexpected' | 'eof' | 'colon' | 'key' | 'shape' | 'empty';

export interface EnvJsonError {
  code: EnvJsonErrorCode;
  /** Offset of the offending character in the source. */
  pos: number;
  /** `comma`: the value after which `,` is missing; `unexpected`: the character. */
  detail: string;
  /** `comma`: where the missing `,` goes. */
  fixAt?: number;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
const ESCAPE = /["\\/bfnrt]|u[0-9a-fA-F]{4}/y;

function parseJson(src: string): J {
  let i = 0;
  let lastStart = 0;
  let lastEnd = -1;

  const ws = (): void => {
    while (i < src.length && ' \t\r\n'.includes(src[i])) i++;
  };
  const fail = (code: EnvJsonErrorCode, extra: Partial<EnvJsonError> = {}): never => {
    if (i >= src.length) code = 'eof';
    throw { code, pos: i, detail: src[i] ?? '', ...extra } satisfies EnvJsonError;
  };
  // After a value: `,` or the closing bracket is due. A value start here means the comma was forgotten.
  const separator = (close: string): never => {
    const next = src[i];
    if (lastEnd >= 0 && next !== undefined && /["{[\-\dtfn]/.test(next))
      return fail('comma', { detail: src.slice(lastStart, lastEnd).slice(0, 40), fixAt: lastEnd });
    return fail('unexpected', { detail: next ?? close });
  };

  function str(): string {
    const start = i++;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"') return JSON.parse(src.slice(start, ++i)) as string;
      if (c < ' ') fail('unexpected');
      if (c === '\\') {
        ESCAPE.lastIndex = i + 1;
        const m = ESCAPE.exec(src);
        if (!m) {
          i++;
          fail('unexpected');
        }
        i += m![0].length;
      }
    }
    return fail('eof');
  }

  function value(): J {
    ws();
    const start = i;
    let v: J;
    const c = src[i];
    if (c === '{') v = object();
    else if (c === '[') v = array();
    else if (c === '"') v = { k: 'v', s: str() };
    else {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      if (!m) return fail('unexpected');
      i += m[0].length;
      v = { k: 'v', s: m[0] === 'null' ? '' : m[0] };
    }
    lastStart = start;
    lastEnd = i;
    return v;
  }

  function object(): J {
    i++;
    const entries: [string, J][] = [];
    ws();
    if (src[i] === '}') {
      i++;
      return { k: 'o', entries };
    }
    for (;;) {
      ws();
      if (src[i] !== '"') fail('key');
      const key = str();
      ws();
      if (src[i] !== ':') fail('colon');
      i++;
      entries.push([key, value()]);
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        return { k: 'o', entries };
      }
      separator('}');
    }
  }

  function array(): J {
    const from = i++;
    const items: J[] = [];
    ws();
    if (src[i] === ']') {
      i++;
      return { k: 'a', items, raw: '[]' };
    }
    for (;;) {
      items.push(value());
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        return { k: 'a', items, raw: src.slice(from, i) };
      }
      separator(']');
    }
  }

  const root = value();
  ws();
  if (i < src.length) fail('unexpected');
  return root;
}

export type EnvJsonFormat = 'flat' | 'nested' | 'postman' | 'insomnia';

export interface ParsedEnv {
  format: EnvJsonFormat;
  /** The name the file itself carries (Postman / Insomnia). */
  name?: string;
  rows: VarRow[];
}

export type EnvJsonResult = { ok: true; env: ParsedEnv } | { ok: false; error: EnvJsonError };

/** Keys that look like credentials are hidden at once. */
const SECRET_KEY = /secret|token|passw(?:or)?d|api[_-]?key/i;

const row = (key: string, value: string, enabled = true, secret = false): VarRow => ({
  key,
  value,
  enabled,
  ...(secret || SECRET_KEY.test(key) ? { secret: true } : {}),
});

const scalar = (v: J | undefined): string => (v?.k === 'v' ? v.s : v?.k === 'a' ? v.raw : '');
const field = (o: [string, J][], name: string): J | undefined => o.find(([k]) => k === name)?.[1];

/** `{ "a": { "b": 1 } }` → `a.b = 1`. Arrays stay as their JSON text. Returns whether anything was nested. */
function flatten(entries: [string, J][], prefix: string, out: Map<string, VarRow>): boolean {
  let nested = false;
  for (const [k, v] of entries) {
    const key = prefix + k;
    if (v.k === 'o') {
      nested = true;
      flatten(v.entries, `${key}.`, out);
    } else if (key) out.set(key, row(key, scalar(v)));
  }
  return nested;
}

function postmanRows(items: J[]): VarRow[] {
  const out = new Map<string, VarRow>();
  for (const it of items) {
    if (it.k !== 'o') continue;
    const key = scalar(field(it.entries, 'key'));
    if (!key) continue;
    out.set(
      key,
      row(
        key,
        scalar(field(it.entries, 'value')),
        scalar(field(it.entries, 'enabled')) !== 'false',
        scalar(field(it.entries, 'type')) === 'secret',
      ),
    );
  }
  return [...out.values()];
}

/** Insomnia v4 export: `resources[]` with `_type: "environment"`; the first one that has data wins. */
function insomnia(items: J[]): { name?: string; rows: VarRow[] } | undefined {
  for (const it of items) {
    if (it.k !== 'o' || scalar(field(it.entries, '_type')) !== 'environment') continue;
    const data = field(it.entries, 'data');
    if (data?.k !== 'o' || !data.entries.length) continue;
    const out = new Map<string, VarRow>();
    flatten(data.entries, '', out);
    return { name: scalar(field(it.entries, 'name')) || undefined, rows: [...out.values()] };
  }
}

/** Read an environment from JSON text. `format` forces a reading; `undefined` detects it. */
export function envFromJson(src: string, format?: EnvJsonFormat): EnvJsonResult {
  if (!src.trim()) return { ok: false, error: { code: 'empty', pos: 0, detail: '' } };
  let root: J;
  try {
    root = parseJson(src);
  } catch (e) {
    const known = typeof e === 'object' && e !== null && 'code' in e;
    return { ok: false, error: known ? (e as EnvJsonError) : { code: 'unexpected', pos: 0, detail: '' } };
  }
  const shape: EnvJsonResult = { ok: false, error: { code: 'shape', pos: 0, detail: '' } };
  if (root.k !== 'o') return shape;
  const values = field(root.entries, 'values');
  const resources = field(root.entries, 'resources');
  const name = scalar(field(root.entries, 'name')) || undefined;

  if ((format === 'postman' || (!format && values?.k === 'a')) && values?.k === 'a')
    return { ok: true, env: { format: 'postman', name, rows: postmanRows(values.items) } };
  if ((format === 'insomnia' || !format) && resources?.k === 'a') {
    const found = insomnia(resources.items);
    if (found) return { ok: true, env: { format: 'insomnia', ...found } };
  }
  if (format === 'postman' || format === 'insomnia') return shape;
  const out = new Map<string, VarRow>();
  const nested = flatten(root.entries, '', out);
  return { ok: true, env: { format: nested ? 'nested' : 'flat', rows: [...out.values()] } };
}

/** 5000 → number, true/false → boolean (typed back on export); everything else is a string. */
function literal(value: string): string {
  const plain = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && String(Number(value)) === value;
  return plain || value === 'true' || value === 'false' ? value : JSON.stringify(value);
}

/**
 * The environment as a flat JSON object. Secrets: `mask` (editor: `sk_live_••••••••••••4f2a`),
 * `blank` (clipboard: an empty string, so nothing leaks into a chat).
 */
export function envToJson(rows: VarRow[], secrets: 'mask' | 'blank'): string {
  const lines = rows
    .filter((r) => r.key)
    .map((r) => {
      const v = r.secret ? (secrets === 'mask' ? maskSecret(r.value) : '') : r.value;
      return `  ${JSON.stringify(r.key)}: ${r.secret ? JSON.stringify(v) : literal(v)}`;
    });
  return lines.length ? `{\n${lines.join(',\n')}\n}` : '{}';
}

/**
 * Put `incoming` into `current`. A secret whose value is still its mask keeps the real value; flags of a
 * variable that already exists (enabled, secret) are kept. `replace`: result follows `incoming`
 * (variables missing there are dropped); `merge`: variables missing there stay.
 */
export function mergeEnvRows(current: VarRow[], incoming: VarRow[], mode: 'replace' | 'merge'): VarRow[] {
  const old = new Map(current.map((r) => [r.key, r]));
  const next = incoming.map((r): VarRow => {
    const was = old.get(r.key);
    if (!was) return r;
    const secret = was.secret || r.secret;
    const value = was.secret && r.value === maskSecret(was.value) ? was.value : r.value;
    return { key: r.key, value, enabled: was.enabled, ...(secret ? { secret: true } : {}) };
  });
  if (mode === 'replace') return next;
  const byKey = new Map(next.map((r) => [r.key, r]));
  const kept = current.map((r) => byKey.get(r.key) ?? r);
  const seen = new Set(current.map((r) => r.key));
  return [...kept, ...next.filter((r) => !seen.has(r.key))];
}

export interface RowsDiff {
  added: string[];
  changed: string[];
  removed: string[];
  same: number;
}

/** What `next` changes against `base`, by key. */
export function diffEnvRows(base: VarRow[], next: VarRow[]): RowsDiff {
  const old = new Map(base.map((r) => [r.key, r]));
  const out: RowsDiff = { added: [], changed: [], removed: [], same: 0 };
  for (const r of next) {
    const was = old.get(r.key);
    if (!was) out.added.push(r.key);
    else if (was.value !== r.value || !!was.secret !== !!r.secret) out.changed.push(r.key);
    else out.same++;
  }
  const kept = new Set(next.map((r) => r.key));
  out.removed = base.filter((r) => !kept.has(r.key)).map((r) => r.key);
  return out;
}

/** 1-based line and column of `pos`. */
export function lineCol(src: string, pos: number): { line: number; col: number } {
  const before = src.slice(0, pos).split('\n');
  return { line: before.length, col: before[before.length - 1].length + 1 };
}
