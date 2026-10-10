/**
 * CodeMirror glue for script run results: the line number of each `pm.test` turns green or red (SC7),
 * and a failing line gets a red band with its message at the end (SC6 pre-request error, SC9 failed
 * assertion). Marks are by absolute line number — they describe the last run, not the live text.
 */
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutterLineClass,
  type DecorationSet,
} from '@codemirror/view';

export interface ScriptMarks {
  /** `pm.test` lines with their outcome. */
  tests: { line: number; ok: boolean }[];
  /** Lines to band in red, with the message shown after the code. */
  errors: { line: number; message: string }[];
}

class LineClass extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}
const OK = new LineClass('bs-ln-ok');
const FAIL = new LineClass('bs-ln-fail');

class ErrorNote extends WidgetType {
  constructor(readonly message: string) {
    super();
  }
  eq(other: ErrorNote): boolean {
    return other.message === this.message;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'bs-err-note';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'error';
    el.append(icon, this.message);
    return el;
  }
}

const sorted = <T extends { line: number }>(list: T[], lines: number) =>
  list.filter((x) => x.line >= 1 && x.line <= lines).sort((a, b) => a.line - b.line);

export function scriptMarks(marks: ScriptMarks): Extension {
  const gutter = (state: EditorState) => {
    const b = new RangeSetBuilder<GutterMarker>();
    const seen = new Set<number>();
    for (const m of sorted(marks.tests, state.doc.lines)) {
      if (seen.has(m.line)) continue;
      seen.add(m.line);
      const from = state.doc.line(m.line).from;
      b.add(from, from, m.ok ? OK : FAIL);
    }
    return b.finish();
  };
  const bands = (state: EditorState): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    const seen = new Set<number>();
    for (const e of sorted(marks.errors, state.doc.lines)) {
      if (seen.has(e.line)) continue;
      seen.add(e.line);
      const line = state.doc.line(e.line);
      b.add(line.from, line.from, Decoration.line({ class: 'bs-err-line' }));
      b.add(line.to, line.to, Decoration.widget({ widget: new ErrorNote(e.message), side: 1 }));
    }
    return b.finish();
  };
  return [gutterLineClass.compute(['doc'], gutter), EditorView.decorations.compute(['doc'], bands)];
}

/** Put the caret on `line`, scroll it to the middle and focus the editor. */
export function revealLine(view: EditorView, line: number): void {
  const n = Math.min(Math.max(1, line), view.state.doc.lines);
  const at = view.state.doc.line(n).from;
  view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
  view.focus();
}
