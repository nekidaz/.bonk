/**
 * G8 «Поля»: the three-way merge of a request file by JSON field instead of by line. Each side is
 * flattened to leaf fields (`headers.Accept`, `body.mode`, `params[limit].value`); a field changed
 * by one side merges by itself, a field both sides changed differently is a conflict. Two sides
 * adding different headers next to each other — a line conflict in JSON mode — is no conflict here.
 *
 * Arrays merge by element. An element is matched across the sides by who it is, not where it sits:
 * an object by its `key` (or `name` / `id`), a plain value by itself, a repeat by its occurrence
 * (`tag`, `tag #2`). An element all sides have merges field by field; one that a side added or
 * removed is a single field. The merged array keeps mine's order and puts what another side added
 * after the element it follows there.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };
type Node = Json | undefined;

/** One field across the three versions; `undefined` = the field isn't there. */
export interface Field {
  /** Stable identity of the field (object keys and array element identities). */
  id: string;
  /** What the editor shows: `headers.Accept`, `params[limit].value`. */
  label: string;
  base: Node;
  mine: Node;
  theirs: Node;
  /** Who changed it against the base: nobody, one side, both the same way, or both differently. */
  kind: 'same' | 'mine' | 'theirs' | 'both' | 'conflict';
}

/** A side, a value typed by hand (`undefined` removes the field), or null while undecided. */
export type FieldChoice = 'mine' | 'theirs' | { value: Node } | null;

const isObj = (v: Node): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const eq = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Read and write only own properties: a request file from another branch can carry a
 * `"__proto__"` key, and plain `node[k]` would reach Object.prototype through it.
 */
const own = (o: Obj, k: string): Node => (Object.hasOwn(o, k) ? o[k] : undefined);
const put = (o: Obj, k: string, value: Json) =>
  Object.defineProperty(o, k, { value, writable: true, enumerable: true, configurable: true });

/** The value a field gets under `c`. */
export function chosenValue(f: Field, c: FieldChoice): Node {
  if (c && typeof c === 'object') return c.value;
  return c === 'theirs' ? f.theirs : f.mine;
}

/**
 * A value typed into the result: JSON (`5`, `"text"`, `{"a": 1}`), or empty to remove the field.
 * Throws on anything else so the editor can say so.
 */
export function parseValue(text: string): Node {
  return text.trim() === '' ? undefined : (JSON.parse(text) as Json);
}

/** Parse a side as a JSON object; a missing side is `{}`. Undefined when it isn't one. */
export function parseSide(text: string | null): Obj | undefined {
  if (text === null) return {};
  try {
    const v = JSON.parse(text) as Json;
    return isObj(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Who an array element is: its `key` / `name` / `id`, else the whole value. */
function identity(el: Json): string {
  if (isObj(el))
    for (const k of ['key', 'name', 'id']) {
      const v = own(el, k);
      if (typeof v === 'string' || typeof v === 'number') return `${k}=${v}`;
    }
  return `=${JSON.stringify(el)}`;
}

/** Identities of an array's elements; a repeat gets its occurrence (`key=tag`, `key=tag#2`). */
function identities(arr: Json[]): string[] {
  const seen = new Map<string, number>();
  return arr.map((el) => {
    const id = identity(el);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n > 1 ? `${id}#${n}` : id;
  });
}

/** How an identity reads in a label: `[limit]`, `["Accept"]`, `[tag #2]`. */
function elementLabel(id: string): string {
  const [who, n] = id.split('#');
  const text = who.startsWith('=') ? who.slice(1) : who.slice(who.indexOf('=') + 1);
  const short = text.length > 40 ? `${text.slice(0, 37)}…` : text;
  return `[${short}${n ? ` #${n}` : ''}]`;
}

/** Mine's order, with what theirs then the base have elsewhere put after their neighbour there. */
function order(base: string[], mine: string[], theirs: string[]): string[] {
  const out = [...mine];
  const merge = (ids: string[]) =>
    ids.forEach((id, i) => {
      if (out.includes(id)) return;
      const prev = ids
        .slice(0, i)
        .reverse()
        .find((p) => out.includes(p));
      // After the neighbour — and after anything mine added right there, so mine's run stays together.
      let at = prev === undefined ? 0 : out.indexOf(prev) + 1;
      while (at < out.length && !ids.includes(out[at])) at++;
      out.splice(at, 0, id);
    });
  merge(theirs);
  merge(base);
  return out;
}

type Child = { id: string; label: string; vals: [Node, Node, Node]; inArray: boolean };

/**
 * What a node is across the three sides. An array element a side lacks is one field (added or
 * removed); otherwise objects and arrays open up, and a node whose shape the sides disagree on
 * (an object in one, a value in another) stays one field, so a choice never mixes two shapes.
 */
function shape(vals: [Node, Node, Node], inArray: boolean): 'obj' | 'arr' | 'leaf' {
  const present = vals.filter((v) => v !== undefined);
  if (inArray && present.length < 3) return 'leaf';
  if (present.length && present.every(isObj)) return 'obj';
  if (present.length && present.every(Array.isArray)) return 'arr';
  return 'leaf';
}

function children(vals: [Node, Node, Node], kind: 'obj' | 'arr', id: string, label: string): Child[] {
  if (kind === 'obj') {
    const keys = vals.map((v) => (isObj(v) ? Object.keys(v) : [])) as [string[], string[], string[]];
    return order(...keys).map((k) => ({
      id: `${id}.${JSON.stringify(k)}`,
      label: label ? `${label}.${k}` : k,
      vals: vals.map((v) => (isObj(v) ? own(v, k) : undefined)) as [Node, Node, Node],
      inArray: false,
    }));
  }
  const arrs = vals.map((v) => (Array.isArray(v) ? v : [])) as [Json[], Json[], Json[]];
  const ids = arrs.map(identities) as [string[], string[], string[]];
  return order(...ids).map((el) => ({
    id: `${id}[${JSON.stringify(el)}]`,
    label: `${label}${elementLabel(el)}`,
    vals: arrs.map((a, s) => {
      const at = ids[s].indexOf(el);
      return at === -1 ? undefined : a[at];
    }) as [Node, Node, Node],
    inArray: true,
  }));
}

/** Leaf fields of the three objects, in merged order. */
export function fields(base: Obj, mine: Obj, theirs: Obj): Field[] {
  const out: Field[] = [];
  const walk = (c: Child) => {
    const kind = shape(c.vals, c.inArray);
    if (kind !== 'leaf') return children(c.vals, kind, c.id, c.label).forEach(walk);
    const [b, m, t] = c.vals;
    out.push({
      id: c.id,
      label: c.label,
      base: b,
      mine: m,
      theirs: t,
      kind: eq(m, b) && eq(t, b) ? 'same' : eq(t, b) ? 'mine' : eq(m, b) ? 'theirs' : eq(m, t) ? 'both' : 'conflict',
    });
  };
  children([base, mine, theirs], 'obj', '', '').forEach(walk);
  return out;
}

/** Each field's starting choice: decided for unchanged and same-way fields, open for the rest. */
export function initialChoices(fs: Field[]): FieldChoice[] {
  return fs.map((f) => (f.kind === 'same' || f.kind === 'both' ? 'mine' : null));
}

/** «Слить непересекающиеся»: every field only one side changed takes that side. */
export function autoChoices(fs: Field[], choices: FieldChoice[]): FieldChoice[] {
  return fs.map((f, i) => choices[i] ?? (f.kind === 'mine' ? 'mine' : f.kind === 'theirs' ? 'theirs' : null));
}

/**
 * The merged file, or null while a field is undecided. Walks the three sides the same way `fields`
 * did, takes each leaf's chosen value and pretty-prints like the workspace does. A container
 * left empty only because a side's addition was turned down disappears with it.
 */
export function mergeFields(
  base: Obj,
  mine: Obj,
  theirs: Obj,
  fs: Field[],
  choices: FieldChoice[],
  trailingNewline: boolean,
): string | null {
  if (choices.some((c) => c === null)) return null;
  const byId = new Map(fs.map((f, i) => [f.id, chosenValue(f, choices[i])]));
  const build = (c: Child): Node => {
    const kind = shape(c.vals, c.inArray);
    if (kind === 'leaf') return byId.get(c.id);
    const parts = children(c.vals, kind, c.id, c.label)
      .map((ch) => [ch, build(ch)] as const)
      .filter(([, v]) => v !== undefined);
    if (!parts.length && c.vals.some((v) => v === undefined)) return undefined;
    if (kind === 'arr') return parts.map(([, v]) => v as Json);
    const o: Obj = {};
    for (const [ch, v] of parts) put(o, JSON.parse(ch.id.slice(c.id.length + 1)) as string, v as Json);
    return o;
  };
  const out = build({ id: '', label: '', vals: [base, mine, theirs], inArray: false });
  return JSON.stringify(out ?? {}, null, 2) + (trailingNewline ? '\n' : '');
}
