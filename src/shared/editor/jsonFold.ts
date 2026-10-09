/**
 * Pure fold-range computation for JSON text (no CodeMirror imports, so it is unit-testable and cheap).
 * One linear scan instead of a lezer parse: a 10 MB response never waits on a synchronous full parse.
 * Tolerant by design: request bodies carry `{{var}}` placeholders and half-typed text, so mismatched
 * brackets are ignored rather than throwing.
 */

export interface FoldRange {
  from: number;
  to: number;
}
export type ItemKind = 'objects' | 'arrays' | 'items';
export interface LargeFold extends FoldRange {
  /** Elements hidden by the fold (excludes the kept head/tail ones). */
  hidden: number;
  kind: ItemKind;
}

/** Default: arrays with more elements than this get their middle folded (Settings → Appearance overrides it). */
export const LARGE_ARRAY_MIN = 50;
export const FOLD_HEAD = 2;
export const FOLD_TAIL = 2;
/** Auto-fold on open only for documents at least this big (chars) or this long (lines). */
export const AUTO_FOLD_MIN_CHARS = 256 * 1024;
export const AUTO_FOLD_MIN_LINES = 1000;

export const shouldAutoFold = (chars: number, lines: number): boolean =>
  chars >= AUTO_FOLD_MIN_CHARS || lines >= AUTO_FOLD_MIN_LINES;

interface Frame {
  open: number;
  arr: boolean;
  nl: number;
  depth: number;
  commas: number;
  head: number[];
  ring: number[];
  kind?: ItemKind;
}

const kindOf = (c: string): ItemKind => (c === '{' ? 'objects' : c === '[' ? 'arrays' : 'items');

/**
 * Single pass. `large`: folds that keep the first FOLD_HEAD and last FOLD_TAIL elements of arrays with more
 * than `opts.min` (default LARGE_ARRAY_MIN) elements — the range starts right after the comma following the last kept head element
 * and ends right after the comma following the last hidden element, so the tail element stays on its own line.
 * `containers` (only when asked): every multi-line object/array except the root, for "Fold all".
 */
export function scanFolds(
  text: string,
  opts: { containers?: boolean; min?: number } = {},
): { large: LargeFold[]; containers: FoldRange[] } {
  const min = Math.max(FOLD_HEAD + FOLD_TAIL, opts.min ?? LARGE_ARRAY_MIN);
  const large: LargeFold[] = [];
  const containers: FoldRange[] = [];
  const stack: Frame[] = [];
  let nl = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '\n') {
      nl += 1;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && top.arr && top.kind === undefined && c !== ' ' && c !== '\t' && c !== '\r' && c !== ']')
      top.kind = kindOf(c);
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[')
      stack.push({ open: i, arr: c === '[', nl, depth: stack.length, commas: 0, head: [], ring: [] });
    else if (c === ',' && top?.arr) {
      top.commas += 1;
      if (top.head.length < FOLD_HEAD) top.head.push(i);
      top.ring.push(i);
      if (top.ring.length > FOLD_TAIL) top.ring.shift();
    } else if ((c === '}' && top && !top.arr) || (c === ']' && top?.arr)) {
      stack.pop();
      if (opts.containers && top.depth > 0 && nl > top.nl) containers.push({ from: top.open + 1, to: i });
      if (top.arr) {
        const n = top.kind === undefined ? 0 : top.commas + 1;
        if (n > min) {
          large.push({
            from: top.head[FOLD_HEAD - 1] + 1,
            to: top.ring[0] + 1,
            hidden: n - FOLD_HEAD - FOLD_TAIL,
            kind: top.kind ?? 'items',
          });
        }
      }
    }
  }
  large.sort((a, b) => a.from - b.from);
  // A fold inside an already-folded one is invisible; keep only the outermost.
  const out: LargeFold[] = [];
  let end = -1;
  for (const f of large) {
    if (f.from >= end) {
      out.push(f);
      end = f.to;
    }
  }
  containers.sort((a, b) => a.from - b.from);
  return { large: out, containers };
}

/**
 * Describe the text hidden by a fold: how many top-level elements it holds and their kind. Used for the chip.
 * `slice` is the folded text itself (for a large-array fold it ends right after a comma).
 */
export function describeSlice(slice: string): { count: number; kind: ItemKind } {
  let depth = 0;
  let commas = 0;
  let inStr = false;
  let esc = false;
  let kind: ItemKind | undefined;
  let last = '';
  for (let i = 0; i < slice.length; i += 1) {
    const c = slice[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') continue;
    if (kind === undefined && depth === 0 && c !== ',') kind = kindOf(c);
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) commas += 1;
    last = c;
  }
  // Slices that end on the separating comma already count every element; others have one extra.
  const count = last === ',' ? commas : commas + (kind === undefined ? 0 : 1);
  return { count, kind: kind ?? 'items' };
}
