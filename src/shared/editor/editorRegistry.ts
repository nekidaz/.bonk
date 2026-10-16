/**
 * Two small hooks other slices plug into every CodeEditor without new props:
 * - `completionExtras`: completion sources added by an extension (e.g. `{{$dynamic}}` names).
 *   Editors with their own completion list (`override`) still ask these; plain editors get
 *   them from `languageData`, which the extension registers as well.
 * - the last focused editor, so a dialog can insert text where the cursor was (DV4 “Insert”).
 */
import { Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CompletionSource } from '@codemirror/autocomplete';

export const completionExtras = Facet.define<CompletionSource>();

/** The first `completionExtras` source with a result. */
export const extraCompletionSource: CompletionSource = (ctx) => {
  for (const source of ctx.state.facet(completionExtras)) {
    const result = source(ctx);
    if (result) return result;
  }
  return null;
};

/**
 * Out-of-pane home for tooltips: the request pane clips (`contain: paint`). CodeMirror wraps them in a
 * container carrying the editor theme (`height: 100%`); straight in the flex-column body it would take
 * half the window from #app. No `overflow: hidden` here: in WebKit (the Tauri webview) CodeMirror may place
 * tooltips `absolute`, and the 0×0 host would clip them away. The box's own border is reset in editor.css.
 */
export function tooltipHost(): HTMLElement {
  let el = document.getElementById('bs-cm-tooltips');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bs-cm-tooltips';
    el.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:1000';
    document.body.append(el);
  }
  return el;
}

let lastFocused: EditorView | null = null;

/** Remembers the editor that last had focus (part of every editable CodeEditor). */
export const trackFocus = EditorView.domEventHandlers({
  focus: (_event, view) => {
    lastFocused = view;
    return false;
  },
});

/** Replace the selection of the last focused editor with `text`. False when there is none. */
export function insertAtLastCursor(text: string): boolean {
  const view = lastFocused;
  if (!view?.dom.isConnected || view.state.readOnly) return false;
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
  return true;
}
