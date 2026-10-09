/**
 * Minimal JSONPath for the response filter row (no dependency): `$`, `.key`, `['key']`, `[n]` / `[-1]`,
 * `[*]` / `.*`, recursive descent `..key` / `..*`, and filters `[?(@.a.b == 'x' && @.n > 3)]` with
 * `== != < <= > >=`, `&&`, `||`, `!` and bare existence tests `[?(@.a)]`.
 * Not supported: slices, unions, script expressions. Errors are returned, never thrown.
 */
export type JsonPathResult = { ok: true; values: unknown[] } | { ok: false; error: string };

type Step =
  | { t: 'key'; key: string }
  | { t: 'index'; i: number }
  | { t: 'wild' }
  | { t: 'filter'; expr: Expr }
  | { t: 'desc' };

type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; keys: (string | number)[] }
  | { k: 'not'; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr };

class PathError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const children = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []);

function parseSteps(src: string): Step[] {
  let i = 0;
  const steps: Step[] = [];
  const s = src.trim();
  if (s[i] !== '$') throw new PathError('Path must start with $');
  i += 1;
  const ident = (): string => {
    const m = /^[A-Za-z0-9_$\-]+/.exec(s.slice(i));
    if (!m) throw new PathError(`Unexpected "${s[i] ?? 'end'}" at ${i}`);
    i += m[0].length;
    return m[0];
  };
  while (i < s.length) {
    if (s.startsWith('..', i)) {
      i += 2;
      steps.push({ t: 'desc' });
      if (s[i] === '*') { i += 1; steps.push({ t: 'wild' }); }
      else if (s[i] === '[') continue;
      else steps.push({ t: 'key', key: ident() });
    } else if (s[i] === '.') {
      i += 1;
      if (s[i] === '*') { i += 1; steps.push({ t: 'wild' }); }
      else steps.push({ t: 'key', key: ident() });
    } else if (s[i] === '[') {
      const end = findBracketEnd(s, i);
      const inner = s.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === '*') steps.push({ t: 'wild' });
      else if (/^-?\d+$/.test(inner)) steps.push({ t: 'index', i: Number(inner) });
      else if (/^(['"])(.*)\1$/s.test(inner)) steps.push({ t: 'key', key: inner.slice(1, -1) });
      else if (inner.startsWith('?')) {
        const body = inner.slice(1).trim();
        steps.push({ t: 'filter', expr: parseExpr(body.startsWith('(') && body.endsWith(')') ? body.slice(1, -1) : body) });
      } else throw new PathError(`Unsupported selector [${inner}]`);
    } else throw new PathError(`Unexpected "${s[i]}" at ${i}`);
  }
  return steps;
}

function findBracketEnd(s: string, start: number): number {
  let depth = 0;
  let q = '';
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '[') depth += 1;
    else if (c === ']' && --depth === 0) return i;
  }
  throw new PathError('Unclosed [');
}

// ---- filter expressions ----
function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(&&|\|\||==|!=|<=|>=|<|>|!|\(|\)|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|@(?:\.[A-Za-z0-9_$\-]+|\[(?:\d+|'[^']*'|"[^"]*")\])*|-?\d+(?:\.\d+)?|true|false|null)/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (src.slice(pos).trim() === '') break;
      throw new PathError(`Bad filter near "${src.slice(pos, pos + 12).trim()}"`);
    }
    out.push(m[1]);
    pos = re.lastIndex;
  }
  return out;
}

function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const or = (): Expr => {
    let l = and();
    while (peek() === '||') { p += 1; l = { k: 'bin', op: '||', l, r: and() }; }
    return l;
  };
  const and = (): Expr => {
    let l = cmp();
    while (peek() === '&&') { p += 1; l = { k: 'bin', op: '&&', l, r: cmp() }; }
    return l;
  };
  const cmp = (): Expr => {
    const l = unary();
    const op = peek();
    if (op && ['==', '!=', '<', '<=', '>', '>='].includes(op)) { p += 1; return { k: 'bin', op, l, r: unary() }; }
    return l;
  };
  const unary = (): Expr => {
    const t = toks[p++];
    if (t === undefined) throw new PathError('Incomplete filter');
    if (t === '!') return { k: 'not', e: unary() };
    if (t === '(') {
      const e = or();
      if (toks[p++] !== ')') throw new PathError('Missing )');
      return e;
    }
    if (t[0] === '@') {
      const keys: (string | number)[] = [];
      for (const m of t.slice(1).matchAll(/\.([A-Za-z0-9_$\-]+)|\[(?:(\d+)|'([^']*)'|"([^"]*)")\]/g)) {
        keys.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : (m[3] ?? m[4])));
      }
      return { k: 'path', keys };
    }
    if (t[0] === "'" || t[0] === '"') return { k: 'lit', v: t.slice(1, -1).replace(/\\(.)/g, '$1') };
    if (t === 'true') return { k: 'lit', v: true };
    if (t === 'false') return { k: 'lit', v: false };
    if (t === 'null') return { k: 'lit', v: null };
    if (!Number.isNaN(Number(t))) return { k: 'lit', v: Number(t) };
    throw new PathError(`Unexpected "${t}" in filter`);
  };
  const e = or();
  if (p < toks.length) throw new PathError(`Unexpected "${toks[p]}" in filter`);
  return e;
}

function evalExpr(e: Expr, cur: unknown): unknown {
  if (e.k === 'lit') return e.v;
  if (e.k === 'path') {
    let v: unknown = cur;
    for (const k of e.keys) v = isObj(v) ? (v as Record<string | number, unknown>)[k] : undefined;
    return v;
  }
  if (e.k === 'not') return !evalExpr(e.e, cur);
  if (e.op === '&&') return !!evalExpr(e.l, cur) && !!evalExpr(e.r, cur);
  if (e.op === '||') return !!evalExpr(e.l, cur) || !!evalExpr(e.r, cur);
  const a = evalExpr(e.l, cur);
  const b = evalExpr(e.r, cur);
  switch (e.op) {
    case '==': return a === b;
    case '!=': return a !== b;
    default: {
      if (typeof a !== typeof b || (typeof a !== 'number' && typeof a !== 'string')) return false;
      const x = a as number, y = b as number;
      return e.op === '<' ? x < y : e.op === '<=' ? x <= y : e.op === '>' ? x > y : x >= y;
    }
  }
}

function descendants(v: unknown, out: unknown[]): void {
  out.push(v);
  for (const c of children(v)) descendants(c, out);
}

/** Cap on the nodes a single query may produce — keeps `$..*` on a huge body from freezing the UI. */
export const MAX_RESULTS = 200_000;

export function queryJsonPath(root: unknown, path: string): JsonPathResult {
  try {
    let nodes: unknown[] = [root];
    for (const step of parseSteps(path)) {
      const next: unknown[] = [];
      for (const n of nodes) {
        if (step.t === 'key') {
          if (isObj(n) && !Array.isArray(n) && step.key in n) next.push(n[step.key]);
        } else if (step.t === 'index') {
          if (Array.isArray(n)) {
            const v = n[step.i < 0 ? n.length + step.i : step.i];
            if (v !== undefined) next.push(v);
          }
        } else if (step.t === 'wild') next.push(...children(n));
        else if (step.t === 'desc') descendants(n, next);
        else for (const c of children(n)) if (evalExpr(step.expr, c)) next.push(c);
        if (next.length > MAX_RESULTS) throw new PathError('Too many matches');
      }
      nodes = next;
    }
    return { ok: true, values: nodes };
  } catch (e) {
    return { ok: false, error: e instanceof PathError ? e.message : 'Invalid path' };
  }
}
