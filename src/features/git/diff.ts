export type DiffRow = {
  text: string;
  cls: string;
  oldLine: string;
  newLine: string;
};

export function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index '))
    return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

export function diffRows(text: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  return text.split('\n').map((line) => {
    const cls = diffLineClass(line);
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text: line || ' ', cls, oldLine: '', newLine: '' };
    }
    if (cls === 'add') {
      return { text: line || ' ', cls, oldLine: '', newLine: String(newLine++) };
    }
    if (cls === 'del') {
      return { text: line || ' ', cls, oldLine: String(oldLine++), newLine: '' };
    }
    if (cls === 'meta' || !oldLine || !newLine) {
      return { text: line || ' ', cls, oldLine: '', newLine: '' };
    }
    return { text: line || ' ', cls, oldLine: String(oldLine++), newLine: String(newLine++) };
  });
}

export function diffStats(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

/** One line of a full-file diff: unchanged, added or removed, with its line number(s). */
export interface FileLine {
  kind: 'ctx' | 'add' | 'del';
  old?: number;
  new?: number;
  text: string;
  /** git's «\ No newline at end of file» came after this line. */
  noEol?: true;
}

/**
 * Lines of a unified diff, without its headers. Fed a full-context diff (`-U100000`)
 * this is the whole file, so the view can show it with real line numbers.
 */
export function fileLines(text: string): FileLine[] {
  const out: FileLine[] = [];
  let o = 0;
  let n = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      o = Number(hunk[1]);
      n = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (inHunk && line.startsWith('\\')) {
      const last = out.at(-1);
      if (last) last.noEol = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('diff --git')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('+')) out.push({ kind: 'add', new: n++, text: line.slice(1) });
    else if (line.startsWith('-')) out.push({ kind: 'del', old: o++, text: line.slice(1) });
    else if (line.startsWith(' ')) out.push({ kind: 'ctx', old: o++, new: n++, text: line.slice(1) });
  }
  return out;
}

/** A row of the side-by-side view: HEAD on the left, the new side on the right; a missing side is a filler. */
export interface SplitRow {
  left?: FileLine;
  right?: FileLine;
}

/** Pair removed lines with the added lines that replace them; unchanged lines sit on both sides. */
export function splitRows(lines: FileLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === 'ctx') {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels: FileLine[] = [];
    const adds: FileLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}

/**
 * The changed middle of two versions of a line, by common prefix and suffix: `[start, endA, endB]`,
 * so `a.slice(start, endA)` was replaced by `b.slice(start, endB)`.
 */
export function changedSpan(a: string, b: string): [number, number, number] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  return [s, ea, eb];
}

/** A run of changed (added / removed) lines: indices `[start, end)` into `fileLines`. */
export interface Block {
  start: number;
  end: number;
}

/** The change blocks of a file's lines, top to bottom. */
export function changeBlocks(lines: FileLine[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === 'ctx') continue;
    const start = i;
    while (i < lines.length && lines[i].kind !== 'ctx') i++;
    out.push({ start, end: i });
  }
  return out;
}

/**
 * A patch of one block (or of the chosen lines in it, `selected` = their indices) that `git apply`
 * takes. Applied forward it turns the diff's old side into the new one for those lines (stage);
 * `reverse` builds it to be applied with `-R` to the new side (unstage, discard), so lines left out
 * stay as the new side has them. Three lines of context each way, up to the neighbouring blocks.
 */
export function blockPatch(
  path: string,
  lines: FileLine[],
  block: Block,
  selected?: Set<number>,
  reverse = false,
): string {
  type Sign = ' ' | '-' | '+';
  const pick = (i: number) => !selected || selected.has(i);
  const body: { sign: Sign; l: FileLine }[] = [];
  let from = block.start;
  while (from > 0 && block.start - from < 3 && lines[from - 1].kind === 'ctx') from--;
  let to = block.end;
  while (to < lines.length && to - block.end < 3 && lines[to].kind === 'ctx') to++;
  for (let i = from; i < to; i++) {
    const l = lines[i];
    if (l.kind === 'ctx') body.push({ sign: ' ', l });
    else if (pick(i)) body.push({ sign: l.kind === 'add' ? '+' : '-', l });
    // A line left out stays as the side the patch applies to has it: there it is context.
    else if ((l.kind === 'del') !== reverse) body.push({ sign: ' ', l });
  }

  // «No newline at end of file» belongs to the last line of a side only. A line that lost its place
  // as the last one (lines added after it, say) gets its newline: a context line splits in two.
  const out: { sign: Sign; text: string; eol: boolean }[] = [];
  body.forEach((b, i) => {
    const rest = body.slice(i + 1);
    const lastOld = !rest.some((r) => r.sign !== '+');
    const lastNew = !rest.some((r) => r.sign !== '-');
    const ne = !!b.l.noEol;
    const text = b.l.text;
    if (b.sign === '-') out.push({ sign: '-', text, eol: !(ne && lastOld) });
    else if (b.sign === '+') out.push({ sign: '+', text, eol: !(ne && lastNew) });
    else if (!ne || lastOld === lastNew) out.push({ sign: ' ', text, eol: !(ne && lastOld) });
    else out.push({ sign: '-', text, eol: !lastOld }, { sign: '+', text, eol: !lastNew });
  });

  const oldCount = out.filter((b) => b.sign !== '+').length;
  const newCount = out.filter((b) => b.sign !== '-').length;
  // Where the hunk starts on each side; an empty side starts after the line before it.
  const before = lines.slice(0, from).filter((l) => l.kind !== 'add').length;
  const beforeNew = lines.slice(0, from).filter((l) => l.kind !== 'del').length;
  const oldStart = oldCount ? before + 1 : before;
  const newStart = newCount ? beforeNew + 1 : beforeNew;
  const text = out.map((b) => `${b.sign}${b.text}\n${b.eol ? '' : '\\ No newline at end of file\n'}`).join('');
  return (
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` +
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${text}`
  );
}
