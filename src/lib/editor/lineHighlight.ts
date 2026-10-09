/**
 * Viewport-only JSON colouring for big read-only documents. The lezer JSON parser also parses the whole
 * document in the background (100 ms main-thread slices, 17 MB = visible hitches); pretty-printed JSON is
 * line-oriented, so a per-line tokenizer over the visible lines gives the same colours at zero background cost.
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;
const MAX_LINE = 4000;

const mark = {
  key: Decoration.mark({ class: 'bs-tk-key' }),
  str: Decoration.mark({ class: 'bs-tk-str' }),
  lit: Decoration.mark({ class: 'bs-tk-lit' }),
};

/** [from, to, kind] tokens of one line of text (offsets relative to the line). Exported for tests. */
export function tokenizeLine(text: string): [number, number, 'key' | 'str' | 'lit'][] {
  const out: [number, number, 'key' | 'str' | 'lit'][] = [];
  if (text.length > MAX_LINE) return out;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (m[1] !== undefined) out.push([m.index, m.index + m[1].length, m[2] ? 'key' : 'str']);
    else out.push([m.index, m.index + m[0].length, 'lit']);
  }
  return out;
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  let doneTo = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = Math.max(from, doneTo + 1);
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      for (const [s, e, kind] of tokenizeLine(line.text)) b.add(line.from + s, line.from + e, mark[kind]);
      doneTo = line.to;
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export function lineHighlight(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
