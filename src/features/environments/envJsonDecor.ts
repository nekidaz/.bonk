/**
 * Marks in the environment JSON editor: the line with a syntax error (red, with a short hint at its end) and a
 * “secret · masked” chip after every masked secret value. Both are derived from the document itself, so the
 * marks can never point at stale offsets.
 */
import { type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { envFromJson } from '$shared/model';

const MAX_CHARS = 200_000;

class Mark extends WidgetType {
  constructor(
    readonly text: string,
    readonly cls: string,
  ) {
    super();
  }
  eq(other: Mark): boolean {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = this.cls;
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const HINTED = new Set(['comma', 'unexpected', 'eof', 'colon', 'key']);

export function envJsonDecor(labels: { chip: string; hint: (code: string) => string }): Extension {
  function build(view: EditorView): DecorationSet {
    const doc = view.state.doc;
    if (doc.length > MAX_CHARS) return Decoration.none;
    const text = doc.toString();
    const out: Range<Decoration>[] = [];
    const r = envFromJson(text);
    if (!r.ok && HINTED.has(r.error.code)) {
      const line = doc.lineAt(Math.min(r.error.pos, doc.length));
      out.push(Decoration.line({ class: 'env-err-line' }).range(line.from));
      out.push(Decoration.widget({ widget: new Mark(labels.hint(r.error.code), 'env-hint'), side: 1 }).range(line.to));
    }
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (line.text.includes('•••'))
        out.push(Decoration.widget({ widget: new Mark(labels.chip, 'env-chip'), side: 1 }).range(line.to));
    }
    return Decoration.set(out, true);
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
