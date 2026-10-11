/**
 * G8 «Поля»: the three-way merge of a request file by JSON field instead of by line. Each side is
 * flattened to leaf fields (`headers.Accept`, `body.mode`); a field changed by one side merges by
 * itself, a field both sides changed differently is a conflict. Two sides adding different headers
 * next to each other — a line conflict in JSON mode — is no conflict here.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };

/** One field across the three versions; `undefined` = the field isn't there. */
export interface Field {
  path: string[];
  base: Json | undefined;
  mine: Json | undefined;
  theirs: Json | undefined;
  /** Who changed it against the base: nobody, one side, both the same way, or both differently. */
  kind: 'same' | 'mine' | 'theirs' | 'both' | 'conflict';
}

/** A side, a value typed by hand (`undefined` removes the field), or null while undecided. */
export type FieldChoice = 'mine' | 'theirs' | { value: Json | undefined } | null;

/** The value a field gets under `c`. */
export function chosenValue(f: Field, c: FieldChoice): Json | undefined {
  if (c && typeof c === 'object') return c.value;
  return c === 'theirs' ? f.theirs : f.mine;
}

/**
 * A value typed into the result: JSON (`5`, `"text"`, `{"a": 1}`), or empty to remove the field.
 * Throws on anything else so the editor can say so.
 */
export function parseValue(text: string): Json | undefined {
  return text.trim() === '' ? undefined : (JSON.parse(text) as Json);
}

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const eq = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

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

/**
 * Leaf fields of the three objects, in mine's key order, then theirs', then the base's. Where the
 * sides disagree on the shape (an object in one, a value in another) the whole subtree is one
 * field, so a choice never mixes the two shapes. Arrays are compared whole.
 */
export function fields(base: Obj, mine: Obj, theirs: Obj): Field[] {
  const out: Field[] = [];
  const walk = (b: Json | undefined, m: Json | undefined, t: Json | undefined, path: string[]) => {
    const present = [b, m, t].filter((v) => v !== undefined);
    if (path.length && !present.every(isObj)) {
      const kind =
        eq(m, b) && eq(t, b) ? 'same' : eq(t, b) ? 'mine' : eq(m, b) ? 'theirs' : eq(m, t) ? 'both' : 'conflict';
      out.push({ path, base: b, mine: m, theirs: t, kind });
      return;
    }
    const keys = [...new Set([m, t, b].flatMap((v) => (isObj(v) ? Object.keys(v) : [])))];
    for (const k of keys) {
      const pick = (v: Json | undefined) => (isObj(v) ? own(v, k) : undefined);
      walk(pick(b), pick(m), pick(t), [...path, k]);
    }
  };
  walk(base, mine, theirs, []);
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
 * Read and write only own properties: a request file from another branch can carry a
 * `"__proto__"` key, and plain `node[k]` would reach Object.prototype through it.
 */
const own = (o: Obj, k: string): Json | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);
const put = (o: Obj, k: string, value: Json) =>
  Object.defineProperty(o, k, { value, writable: true, enumerable: true, configurable: true });

function setPath(obj: Obj, path: string[], value: Json | undefined): void {
  let node: Obj = obj;
  for (const k of path.slice(0, -1)) {
    let child = own(node, k);
    if (!isObj(child)) put(node, k, (child = {}));
    node = child;
  }
  const last = path[path.length - 1];
  if (value === undefined) {
    if (Object.hasOwn(node, last)) delete node[last];
  } else put(node, last, value);
}

/**
 * The merged file, or null while a field is undecided. Starts from mine (its key order and
 * formatting rules), applies every chosen value and pretty-prints like the workspace does.
 */
export function mergeFields(mine: Obj, fs: Field[], choices: FieldChoice[], trailingNewline: boolean): string | null {
  if (choices.some((c) => c === null)) return null;
  const out = structuredClone(mine);
  fs.forEach((f, i) => setPath(out, f.path, chosenValue(f, choices[i])));
  return JSON.stringify(out, null, 2) + (trailingNewline ? '\n' : '');
}
