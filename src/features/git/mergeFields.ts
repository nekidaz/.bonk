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

import { lineHunks } from './merge3';

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
  /**
   * Set when the field belongs to an array element matched only by place (every field changed):
   * the pairings it rests on. Passing them to `fields` as splits makes it a removal + addition.
   */
  guess?: string[];
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

/** An object element's own name: its `key` / `name` / `id`, if it has one. */
function naturalKey(el: Json): string | undefined {
  if (!isObj(el)) return undefined;
  for (const k of ['key', 'name', 'id']) {
    const v = own(el, k);
    if (typeof v === 'string' || typeof v === 'number') return `${k}=${v}`;
  }
  return undefined;
}

/** Who an array element is: its natural key, else the whole value. */
const identity = (el: Json): string => naturalKey(el) ?? `=${JSON.stringify(el)}`;

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

/** How many top-level fields two objects share with equal values — how alike two elements are. */
function likeness(a: Json, b: Json): number {
  if (!isObj(a) || !isObj(b)) return 0;
  return Object.keys(a).filter((k) => Object.hasOwn(b, k) && eq(a[k], b[k])).length;
}

/**
 * Whether two elements are built alike enough to be one element edited rather than one replaced
 * by another: both objects whose field names mostly agree (at least half of them, Jaccard).
 */
function builtAlike(a: Json, b: Json): boolean {
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  const shared = ka.filter((k) => Object.hasOwn(b, k)).length;
  const union = ka.length + kb.length - shared;
  return union === 0 || shared / union >= 0.5;
}

/**
 * Identities for an array of objects without a natural key, relative to the base: an element
 * unchanged since the base keeps the base element's identity (found by a common subsequence, as
 * lines are); inside a changed stretch each base element pairs, in order, with the most alike
 * element left on that side, so an edit stays an edit even next to an insertion; what is left
 * between matched neighbours on both sides pairs in place when built alike, so even an element
 * changed in every field stays the same element, while one replaced by something else does not.
 * Pairs made in place are guesses: `guesses` maps each base identity to the keys of its guessed
 * pairings, and a key in `splits` (the user said «Это замена») is not paired. What finds no pair
 * is new on its side (or gone from it).
 */
function pairedIdentities(
  arrs: [Json[], Json[], Json[]],
  arrayId: string,
  splits: ReadonlySet<string>,
  guesses: Map<string, string[]>,
): [string[], string[], string[]] {
  const [base] = arrs;
  const baseIds = base.map((_, i) => `@b${i}`);
  const str = (e: Json) => JSON.stringify(e);
  const side = (arr: Json[], tag: string): string[] => {
    const out = arr.map((_, i) => `@${tag}${i}`);
    const end = { aStart: base.length, aEnd: base.length, bStart: arr.length, bEnd: arr.length };
    let a = 0;
    let b = 0;
    for (const h of [...lineHunks(base.map(str), arr.map(str)), end]) {
      // Between changed stretches the two arrays run in step.
      for (; a < h.aStart; a++, b++) out[b] = baseIds[a];
      // First by likeness: each base element takes the most alike element still ahead.
      const pairs: [number, number][] = [];
      let from = h.bStart;
      for (let i = h.aStart; i < h.aEnd; i++) {
        let best = -1;
        let score = 0;
        for (let k = from; k < h.bEnd; k++) {
          const sc = likeness(base[i], arr[k]);
          if (sc > score) [best, score] = [k, sc];
        }
        if (best !== -1) {
          pairs.push([i, best]);
          from = best + 1;
        }
      }
      // Then in place: between two matched neighbours, what is left on both sides was replaced
      // there — an element changed in every field — so they pair in order, as a diff pairs a
      // removed line with the added one. The surplus on either side stays new or gone.
      const fences: [number, number][] = [[h.aStart - 1, h.bStart - 1], ...pairs, [h.aEnd, h.bEnd]];
      for (let f = 0; f + 1 < fences.length; f++) {
        const [i0, k0] = fences[f];
        const [i1, k1] = fences[f + 1];
        for (let n = 0; i0 + 1 + n < i1 && k0 + 1 + n < k1; n++) {
          const [i, k] = [i0 + 1 + n, k0 + 1 + n];
          const key = `${arrayId}|${baseIds[i]}|${tag}${k}`;
          if (splits.has(key) || !builtAlike(base[i], arr[k])) continue;
          pairs.push([i, k]);
          guesses.set(baseIds[i], [...(guesses.get(baseIds[i]) ?? []), key]);
        }
      }
      for (const [i, k] of pairs) out[k] = baseIds[i];
      a = h.aEnd;
      b = h.bEnd;
    }
    return out;
  };
  return [baseIds, side(arrs[1], 'm'), side(arrs[2], 't')];
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

type Child = { id: string; label: string; vals: [Node, Node, Node]; inArray: boolean; guess?: string[] };

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

function children({ vals, id, label, guess }: Child, kind: 'obj' | 'arr', splits: ReadonlySet<string>): Child[] {
  if (kind === 'obj') {
    const keys = vals.map((v) => (isObj(v) ? Object.keys(v) : [])) as [string[], string[], string[]];
    return order(...keys).map((k) => ({
      id: `${id}.${JSON.stringify(k)}`,
      label: label ? `${label}.${k}` : k,
      vals: vals.map((v) => (isObj(v) ? own(v, k) : undefined)) as [Node, Node, Node],
      inArray: false,
      guess,
    }));
  }
  const arrs = vals.map((v) => (Array.isArray(v) ? v : [])) as [Json[], Json[], Json[]];
  // Objects that all have a name match by it, plain values by value; other objects by position
  // relative to the base, labelled by where they end up.
  const all = arrs.flat();
  const byPosition = all.some(isObj) && !all.every((e) => naturalKey(e) !== undefined);
  const guesses = new Map<string, string[]>();
  const ids = byPosition
    ? pairedIdentities(arrs, id, splits, guesses)
    : (arrs.map(identities) as [string[], string[], string[]]);
  return order(...ids).map((el, at) => ({
    id: `${id}[${JSON.stringify(el)}]`,
    label: `${label}${byPosition ? `[${at}]` : elementLabel(el)}`,
    vals: arrs.map((a, s) => {
      const at = ids[s].indexOf(el);
      return at === -1 ? undefined : a[at];
    }) as [Node, Node, Node],
    inArray: true,
    guess: guesses.get(el),
  }));
}

/** Leaf fields of the three objects, in merged order. `splits`: guessed pairings turned down. */
export function fields(base: Obj, mine: Obj, theirs: Obj, splits: ReadonlySet<string> = new Set()): Field[] {
  const out: Field[] = [];
  const walk = (c: Child) => {
    const kind = shape(c.vals, c.inArray);
    if (kind !== 'leaf') return children(c, kind, splits).forEach(walk);
    const [b, m, t] = c.vals;
    out.push({
      id: c.id,
      label: c.label,
      base: b,
      mine: m,
      theirs: t,
      kind: eq(m, b) && eq(t, b) ? 'same' : eq(t, b) ? 'mine' : eq(m, b) ? 'theirs' : eq(m, t) ? 'both' : 'conflict',
      ...(c.guess ? { guess: c.guess } : {}),
    });
  };
  children({ id: '', label: '', vals: [base, mine, theirs], inArray: false }, 'obj', splits).forEach(walk);
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
  splits: ReadonlySet<string> = new Set(),
): string | null {
  if (choices.some((c) => c === null)) return null;
  const byId = new Map(fs.map((f, i) => [f.id, chosenValue(f, choices[i])]));
  const build = (c: Child): Node => {
    const kind = shape(c.vals, c.inArray);
    if (kind === 'leaf') return byId.get(c.id);
    const parts = children(c, kind, splits)
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
