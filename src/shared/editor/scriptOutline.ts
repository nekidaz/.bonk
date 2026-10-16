/**
 * “Outline” of a script (SC8): `// ── Section` comments split it into sections, and each section lists
 * its functions, `pm.test` blocks and `pm.environment.set` / `pm.globals.set` variables. A line scan,
 * not a parser: it only has to be right for the way people write these scripts.
 */
export type OutlineKind = 'fn' | 'test' | 'var';

export interface OutlineItem {
  kind: OutlineKind;
  name: string;
  /** 1-based line. */
  line: number;
}

export interface OutlineSection {
  /** '' for whatever comes before the first `// ──` header. */
  title: string;
  /** Header line; 0 for the untitled head. */
  line: number;
  items: OutlineItem[];
}

const SECTION = /^\s*\/\/\s*[─—━=-]{2,}\s*(.*?)\s*[─—━=-]*\s*$/;
const FN_DECL = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/;
const FN_VAR = /^\s*(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/;
const TEST = /pm\.test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
const VAR = /pm\.(?:environment|globals)\.set\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

export function scriptOutline(code: string): OutlineSection[] {
  const sections: OutlineSection[] = [{ title: '', line: 0, items: [] }];
  code.split('\n').forEach((text, i) => {
    const line = i + 1;
    const header = SECTION.exec(text);
    if (header && header[1]) {
      sections.push({ title: header[1], line, items: [] });
      return;
    }
    const items = sections[sections.length - 1].items;
    const fn = FN_DECL.exec(text) ?? FN_VAR.exec(text);
    if (fn) items.push({ kind: 'fn', name: fn[1], line });
    const test = TEST.exec(text);
    if (test) items.push({ kind: 'test', name: test[2], line });
    const v = VAR.exec(text);
    if (v) items.push({ kind: 'var', name: v[2], line });
  });
  return sections.filter((s) => s.title || s.items.length);
}
