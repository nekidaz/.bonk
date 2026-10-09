/**
 * Live JSON syntax check for the body editor (S10). Tolerates `{{var}}` placeholders — they are swapped for
 * same-length JSON-neutral text, so offsets stay true to the editor document. Pure.
 */

/** Bodies above this are not re-parsed on every pause in typing. */
export const LINT_MAX_CHARS = 2_000_000;

export interface JsonProblem {
  /** Offset into the original text. */
  pos: number;
  error: unknown;
}

const neutral = (text: string): string => text.replace(/\{\{[^{}\n]*\}\}/g, (m) => `0${' '.repeat(m.length - 1)}`);

function offsetOf(text: string, message: string): number {
  const lc = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lc) {
    let line = 1;
    let i = 0;
    while (line < Number(lc[1]) && i < text.length) if (text.charCodeAt(i++) === 10) line += 1;
    return Math.min(text.length, i + Number(lc[2]) - 1);
  }
  const p = message.match(/position\s+(\d+)/i);
  return p ? Math.min(text.length, Number(p[1])) : text.length;
}

/** The first syntax problem, or null for valid (or empty, or too large to check) JSON. */
export function jsonProblem(text: string): JsonProblem | null {
  if (!text.trim() || text.length > LINT_MAX_CHARS) return null;
  try {
    JSON.parse(neutral(text));
    return null;
  } catch (error) {
    return { pos: offsetOf(text, error instanceof Error ? error.message : String(error)), error };
  }
}
