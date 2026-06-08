export type DiffRow = {
  text: string;
  cls: string;
  oldLine: string;
  newLine: string;
};

export function diffLineClass(line: string): string {
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff --git') ||
    line.startsWith('index ')
  )
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
