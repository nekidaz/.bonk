import type { Tab } from './types';
import { currentBodyMode, currentRawFormat } from './httpBody';

/** Map a 0-based character `position` in `raw` to a "line N, column M" string. */
export function jsonLineCol(raw: string, position: number): string {
  const before = raw.slice(0, Math.max(0, position));
  const lines = before.split('\n');
  return `line ${lines.length}, column ${lines[lines.length - 1].length + 1}`;
}

/**
 * Turn a thrown JSON parse error into a human-readable message, resolving any
 * "line/column" or "position" the engine reports back to a line/column in `raw`.
 */
export function jsonErrorMessage(raw: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumn) return `Invalid JSON at line ${lineColumn[1]}, column ${lineColumn[2]}.`;
  const position = message.match(/position\s+(\d+)/i);
  if (position) return `Invalid JSON at ${jsonLineCol(raw, Number(position[1]))}.`;
  return `Invalid JSON: ${message}`;
}

/**
 * Best-effort repair of loose JSON: drops trailing commas, quotes bare object
 * keys, and inserts missing commas between adjacent values on separate lines.
 */
export function repairLooseJson(raw: string): string {
  return raw
    .trim()
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
    .replace(
      /("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[}\]])(\s*\n\s*)("(?:\\.|[^"\\])*"\s*:)/g,
      '$1,$2$3',
    );
}

/**
 * Parse `raw` for beautifying. Tries strict JSON first; on failure retries the
 * loose-repaired form. Re-throws the original strict error if repair fails too.
 */
export function parseJsonForBeautify(raw: string): unknown {
  const source = raw.trim() || '{}';
  try {
    return JSON.parse(source);
  } catch (strictError) {
    const repaired = repairLooseJson(source);
    if (repaired !== source) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Report the original strict parse error below.
      }
    }
    throw strictError;
  }
}

/**
 * When the cursor sits at the start of a fresh line whose previous line ended in
 * a complete JSON value, insert a comma after that value so typing the next
 * key/value stays valid. Returns the (possibly) edited value and new cursor.
 */
export function maybeInsertCommaBeforeJsonValue(value: string, cursor: number): { value: string; cursor: number } {
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  if (value.slice(lineStart, cursor).trim() !== '') return { value, cursor };
  let prevEnd = lineStart - 1;
  while (prevEnd > 0 && /\s/.test(value[prevEnd - 1])) prevEnd -= 1;
  const prevStart = value.lastIndexOf('\n', prevEnd - 1) + 1;
  const previous = value.slice(prevStart, prevEnd).trim();
  if (!previous || /[,{\[]$/.test(previous)) return { value, cursor };
  if (!/("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[}\]])$/.test(previous)) {
    return { value, cursor };
  }
  return {
    value: `${value.slice(0, prevEnd)},${value.slice(prevEnd)}`,
    cursor: cursor + 1,
  };
}

/** Placeholder text for the body editor based on the tab's body mode / raw format. */
export function bodyPlaceholder(t: Tab | undefined): string {
  const mode = currentBodyMode(t);
  if (mode === 'graphql') return 'query GetUser {\n  user(id: "1") {\n    id\n  }\n}';
  if (mode === 'binary') return 'Paste binary-safe text payload';
  if (currentRawFormat(t) === 'JSON') return '{\n  "hello": "world"\n}';
  return 'Request body';
}
