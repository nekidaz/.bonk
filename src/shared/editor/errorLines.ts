import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { revealLine } from './scriptMarks';
import type { Extension } from '@codemirror/state';

/**
 * S24: tint the JSON lines whose key is a field the server rejected
 * (`google.rpc.BadRequest` violations). Matches the last path segment,
 * so `customer.email` marks the `"email"` line.
 */
export function errorFieldLines(fields: string[]): Extension {
  const keys = new Set(
    fields.map(
      (f) =>
        f
          .split(/[.[\]]/)
          .filter(Boolean)
          .at(-1) ?? f,
    ),
  );
  if (!keys.size) return [];
  const line = Decoration.line({ class: 'cm-error-line' });
  const build = (view: EditorView): DecorationSet => {
    const marks = [];
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const l = view.state.doc.line(n);
      const key = l.text.match(/^\s*"([^"]+)"\s*:/)?.[1];
      if (key && keys.has(key)) marks.push(line.range(l.from));
    }
    return Decoration.set(marks);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** IM6: tint line `line` (1-based) of a document that doesn't parse; `reveal` also scrolls there and puts the cursor on it. */
export function errorAtLine(line: number, reveal = false): Extension {
  const mark = Decoration.line({ class: 'cm-import-error' });
  const build = (view: EditorView): DecorationSet =>
    line >= 1 && line <= view.state.doc.lines
      ? Decoration.set([mark.range(view.state.doc.line(line).from)])
      : Decoration.none;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
        // A view can't be dispatched to while it is being configured.
        if (reveal) requestAnimationFrame(() => revealLine(view, line));
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
