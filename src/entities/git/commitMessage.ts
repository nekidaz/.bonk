/** G4b: git's convention — a subject of at most 72 characters, then a blank line and the body. */
export const SUBJECT_MAX = 72;

/** Most lines the sidebar commit box grows to before it scrolls. */
export const MESSAGE_MAX_LINES = 8;

/** The subject line and how many more lines follow it (shown collapsed as “N more lines”). */
export function messageParts(message: string): { subject: string; more: number } {
  const lines = message.replace(/\s+$/, '').split('\n');
  return { subject: lines[0], more: lines.length - 1 };
}
