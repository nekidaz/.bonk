/** Expanded (focus) mode and collapsed-pane helpers. Pure; the UI state lives in stores/ui.ts. */
export type FocusMode = 'request' | 'response' | null;

/** Expand button: enter `want`, or leave when that pane is already expanded. */
export function toggleFocus(cur: FocusMode, want: 'request' | 'response'): FocusMode {
  return cur === want ? null : want;
}

/** ⌥⌘F: leave when expanded, otherwise expand the pane the caret is in (request when nothing is focused). */
export function expandTarget(cur: FocusMode, inResponse: boolean): FocusMode {
  return cur ? null : inResponse ? 'response' : 'request';
}

/** Max chars of the one-line preview shown in the collapsed strips. */
export const PREVIEW_CHARS = 140;

/**
 * One-line preview of a body for a strip: JSON is minified, other text collapses whitespace.
 * Big bodies are cut BEFORE any parsing so a 25 MB response never gets stringified for a 44 px strip.
 */
export function oneLinePreview(body: string, max = PREVIEW_CHARS): string {
  const head = body.length > 4096 ? body.slice(0, 4096) : body;
  let text = head;
  if (body.length <= 4096 && /^\s*[[{]/.test(head)) {
    try {
      text = JSON.stringify(JSON.parse(head));
    } catch {
      /* not JSON — fall through to whitespace collapsing */
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
