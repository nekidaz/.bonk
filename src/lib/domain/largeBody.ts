/** Large body helpers (E1–E7): when a body counts as large, its size/line stats, Beautify. */
import { utf8Length } from './editorStats';
import { formatMarkup } from './highlight';
import { parseJsonForBeautify } from './jsonEditor';
import { currentBodyMode, currentRawFormat } from './httpBody';
import type { BodyMode, HttpRequest, RawBodyFormat, Tab } from './types';

/** From here the body head (S10) folds into the request tabs row (E1 rule 2). */
export const LARGE_BODY_CHARS = 16 * 1024;
export const LARGE_BODY_LINES = 200;
/** Above this, bytes are reported as the UTF-16 length (`~`) instead of an exact UTF-8 count per keystroke. */
const EXACT_BYTES_MAX = 1_000_000;

export interface TextStats {
  bytes: number;
  lines: number;
  /** `bytes` is approximate. */
  approx: boolean;
}

export function textStats(text: string): TextStats {
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines += 1;
  const approx = text.length > EXACT_BYTES_MAX;
  return { bytes: approx ? text.length : utf8Length(text), lines, approx };
}

export function isLargeBody(text: string): boolean {
  if (text.length > LARGE_BODY_CHARS) return true;
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1 && lines <= LARGE_BODY_LINES; i = text.indexOf('\n', i + 1)) lines += 1;
  return lines > LARGE_BODY_LINES;
}

/** Beautify refuses bodies over this many chars: a multi-MB parse + re-stringify would freeze the UI. */
export const BEAUTIFY_MAX_CHARS = 8_000_000;

/** Formatted body text; throws on a body that does not parse. JSON keeps loose-JSON repair (trailing commas, bare keys). */
export function beautify(body: string, format: RawBodyFormat): string {
  if (format === 'JSON') return JSON.stringify(parseJsonForBeautify(body), null, 2);
  if (format === 'HTML' || format === 'XML') return formatMarkup(body);
  return body;
}

/** The body format dropdown in the request tabs row (E1): raw formats plus the other body modes. */
export type BodyKind = 'json' | 'text' | 'javascript' | 'html' | 'xml' | 'graphql' | 'none' | 'urlencoded' | 'multipart' | 'binary';
export const RAW_KINDS: readonly BodyKind[] = ['json', 'text', 'javascript', 'html', 'xml', 'graphql'];
export const OTHER_KINDS: readonly BodyKind[] = ['none', 'urlencoded', 'multipart', 'binary'];
const KIND_FORMAT: Partial<Record<BodyKind, RawBodyFormat>> = { json: 'JSON', text: 'Text', javascript: 'JavaScript', html: 'HTML', xml: 'XML' };

export function bodyKindOf(t: Pick<Tab, 'request'>): BodyKind {
  const mode = currentBodyMode(t);
  if (mode === 'raw') return currentRawFormat(t).toLowerCase() as BodyKind;
  return mode === 'form-data' ? 'multipart' : mode;
}

/** The request switched to `kind` (body text and form rows are kept). */
export function applyBodyKind(request: HttpRequest, kind: BodyKind): HttpRequest {
  const format = KIND_FORMAT[kind];
  if (format) return { ...request, bodyMode: 'raw', rawBodyFormat: format };
  return { ...request, bodyMode: kind === 'multipart' ? 'form-data' : (kind as BodyMode) };
}
