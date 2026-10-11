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
    if (!inHunk || line.startsWith('\\')) continue;
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
