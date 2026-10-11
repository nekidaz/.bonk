/**
 * G8: three-way merge of one file, line by line, like diff3. Each side is diffed against the common
 * base; where only one side changed a stretch the change is non-conflicting, where both changed it
 * differently it is a conflict. The editor shows the chunks side by side and the user takes,
 * rejects or auto-applies each side; `mergedText` is the result once nothing is pending.
 */

/** A changed range: base lines [aStart, aEnd) became side lines [bStart, bEnd). */
export interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * Changed ranges of `b` against `a` from a longest common subsequence of lines.
 * ponytail: O(n·m) table after trimming the common head and tail — fine for request files of a
 * few hundred lines; switch to Myers if big files ever come through here.
 */
export function lineHunks(a: string[], b: string[]): Hunk[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const n = x.length;
  const m = y.length;
  // lcs[i][j] = LCS length of x[i..] and y[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      close();
      i++;
      j++;
      continue;
    }
    open ??= { aStart: head + i, aEnd: head + i, bStart: head + j, bEnd: head + j };
    if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      j++;
      open.bEnd = head + j;
    } else {
      i++;
      open.aEnd = head + i;
    }
  }
  close();
  return hunks;
}

export type Chunk =
  | { kind: 'same'; lines: string[] }
  | {
      kind: 'change';
      base: string[];
      mine: string[];
      theirs: string[];
      /** Which sides changed this stretch of the base. */
      from: 'mine' | 'theirs' | 'both';
      conflict: boolean;
    };

const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

export function merge3(base: string[], mine: string[], theirs: string[]): Chunk[] {
  const all = [
    ...lineHunks(base, mine).map((h) => ({ ...h, side: 'mine' as const })),
    ...lineHunks(base, theirs).map((h) => ({ ...h, side: 'theirs' as const })),
  ].sort((p, q) => p.aStart - q.aStart || p.aEnd - q.aEnd);

  // Hunks of the two sides that overlap in the base form one chunk (a conflict when they disagree).
  // Changes that only touch stay apart, like in GoLand; two insertions at one spot can't be ordered, so they meet.
  const groups: { start: number; end: number; items: typeof all }[] = [];
  for (const h of all) {
    const g = groups.at(-1);
    const sameSpot = g && h.aStart === h.aEnd && g.start === g.end && h.aStart === g.start;
    if (g && (h.aStart < g.end || sameSpot)) {
      g.end = Math.max(g.end, h.aEnd);
      g.items.push(h);
    } else groups.push({ start: h.aStart, end: h.aEnd, items: [h] });
  }

  const chunks: Chunk[] = [];
  let pos = 0;
  const off = { mine: 0, theirs: 0 };
  const sides = { mine, theirs };
  for (const g of groups) {
    if (g.start > pos) chunks.push({ kind: 'same', lines: base.slice(pos, g.start) });
    const text = { mine: [] as string[], theirs: [] as string[] };
    for (const s of ['mine', 'theirs'] as const) {
      const delta = g.items
        .filter((h) => h.side === s)
        .reduce((d, h) => d + (h.bEnd - h.bStart) - (h.aEnd - h.aStart), 0);
      text[s] = sides[s].slice(g.start + off[s], g.end + off[s] + delta);
      off[s] += delta;
    }
    const by = new Set(g.items.map((h) => h.side));
    const from = by.size === 2 ? 'both' : by.has('mine') ? 'mine' : 'theirs';
    chunks.push({
      kind: 'change',
      base: base.slice(g.start, g.end),
      mine: text.mine,
      theirs: text.theirs,
      from,
      conflict: from === 'both' && !same(text.mine, text.theirs),
    });
    pos = g.end;
  }
  if (pos < base.length) chunks.push({ kind: 'same', lines: base.slice(pos) });
  return chunks;
}

/** What the user did with one side of a change: not yet, took it into the result, or rejected it. */
export type SideState = 'pending' | 'taken' | 'rejected';
export interface Resolution {
  mine: SideState;
  theirs: SideState;
  /** Taken by «Слить непересекающиеся», not by hand. */
  auto?: boolean;
}

/** A side that didn't change the stretch has nothing to offer: it starts rejected. */
export function initialResolution(c: Chunk): Resolution {
  if (c.kind === 'same') return { mine: 'taken', theirs: 'rejected' };
  if (c.from === 'both' && !c.conflict) return { mine: 'pending', theirs: 'rejected' };
  return {
    mine: c.from === 'theirs' ? 'rejected' : 'pending',
    theirs: c.from === 'mine' ? 'rejected' : 'pending',
  };
}

export const isPending = (r: Resolution) => r.mine === 'pending' || r.theirs === 'pending';

/** The result lines of a chunk, or null while a side is pending. Both rejected keeps the base. */
export function resolvedLines(c: Chunk, r: Resolution): string[] | null {
  if (c.kind === 'same') return c.lines;
  if (isPending(r)) return null;
  if (r.mine === 'rejected' && r.theirs === 'rejected') return c.base;
  return [...(r.mine === 'taken' ? c.mine : []), ...(r.theirs === 'taken' ? c.theirs : [])];
}

/** «Слить непересекающиеся»: take the changed side of every pending non-conflicting chunk. */
export function autoResolve(chunks: Chunk[], res: Resolution[]): Resolution[] {
  return chunks.map((c, i) => {
    const r = res[i];
    if (c.kind === 'same' || c.conflict || !isPending(r)) return r;
    return {
      mine: r.mine === 'pending' ? 'taken' : r.mine,
      theirs: r.theirs === 'pending' ? 'taken' : r.theirs,
      auto: true,
    };
  });
}

/** The merged file, or null while any chunk is pending. */
export function mergedText(chunks: Chunk[], res: Resolution[]): string | null {
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const lines = resolvedLines(chunks[i], res[i]);
    if (!lines) return null;
    out.push(...lines);
  }
  return out.join('\n');
}
