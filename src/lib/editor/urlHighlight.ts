import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** Token classes for a URL's query string: `?`/`&`/`=` punctuation, parameter names, values. */
export type UrlToken = { from: number; to: number; kind: 'punct' | 'key' | 'value' };

/** Split the query part of `url` into tokens (positions are offsets into `url`). */
export function urlQueryTokens(url: string): UrlToken[] {
  const q = url.indexOf('?');
  if (q === -1) return [];
  const out: UrlToken[] = [{ from: q, to: q + 1, kind: 'punct' }];
  let pos = q + 1;
  for (const part of url.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key) out.push({ from: pos, to: pos + key.length, kind: 'key' });
    if (eq !== -1) {
      out.push({ from: pos + eq, to: pos + eq + 1, kind: 'punct' });
      if (eq + 1 < part.length) out.push({ from: pos + eq + 1, to: pos + part.length, kind: 'value' });
    }
    pos += part.length;
    if (pos < url.length) out.push({ from: pos, to: pos + 1, kind: 'punct' });
    pos += 1;
  }
  return out;
}

/** A line-break opportunity, so a wrapped URL breaks between parameters (S13). */
class BreakHint extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement('wbr');
  }
  eq(): boolean {
    return true;
  }
}

const marks = {
  punct: Decoration.mark({ class: 'cm-url-punct' }),
  key: Decoration.mark({ class: 'cm-url-key' }),
  value: Decoration.mark({ class: 'cm-url-value' }),
};
const breakHint = Decoration.widget({ widget: new BreakHint(), side: -1 });
// Each `&param=value` run stays on one line, so wrapping happens only at the break hints.
const segment = Decoration.mark({ class: 'cm-url-seg' });

function build(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  let segStart = 0;
  for (const t of urlQueryTokens(text)) {
    if (t.kind === 'punct' && text[t.from] === '&') {
      if (t.from > segStart) decos.push({ from: segStart, to: t.from, deco: segment });
      decos.push({ from: t.from, to: t.from, deco: breakHint });
      segStart = t.from;
    }
    decos.push({ from: t.from, to: t.to, deco: marks[t.kind] });
  }
  if (text.length > segStart && segStart > 0) decos.push({ from: segStart, to: text.length, deco: segment });
  // RangeSetBuilder needs ranges sorted by start, then by start side (widgets/outer marks first).
  decos.sort(
    (a, b) =>
      a.from - b.from ||
      (a.deco === breakHint ? -1 : b.deco === breakHint ? 1 : a.deco === segment ? -1 : b.deco === segment ? 1 : 0),
  );
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of decos) builder.add(d.from, d.to, d.deco);
  return builder.finish();
}

/** Query-string colouring + `&` wrap points for the URL bar (wrapping itself is switched on by the host). */
export function urlHighlight(): Extension {
  return [
    ViewPlugin.fromClass(
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
    ),
  ];
}
