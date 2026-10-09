import { get } from 'svelte/store';
import { t, type Translate } from '../i18n';

export interface GrpcErrorPresentation {
  code: string;
  title: string;
  message: string;
  hint: string;
  raw: string;
  action?: 'metadata' | 'message';
  actionLabel?: string;
}

/** Which editor section each code points to; texts live in the i18n dictionary (`grpc.error.<CODE>.*`). */
const PRESENTATIONS: Record<string, { action?: 'metadata' | 'message'; actionLabel?: string }> = {
  CANCELLED: {},
  INVALID_ARGUMENT: { action: 'message', actionLabel: 'grpc.error.editMessage' },
  DEADLINE_EXCEEDED: {},
  NOT_FOUND: {},
  ALREADY_EXISTS: {},
  PERMISSION_DENIED: { action: 'metadata', actionLabel: 'grpc.error.openMetadata' },
  UNAUTHENTICATED: { action: 'metadata', actionLabel: 'grpc.error.openMetadata' },
  RESOURCE_EXHAUSTED: {},
  FAILED_PRECONDITION: {},
  ABORTED: {},
  OUT_OF_RANGE: { action: 'message', actionLabel: 'grpc.error.editMessage' },
  UNIMPLEMENTED: {},
  INTERNAL: {},
  UNAVAILABLE: {},
  DATA_LOSS: {},
  UNKNOWN: {},
};

function normalizeCode(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

function inferCode(text: string, fallback: string): string {
  // A real status code from the server wins over guessing from the text.
  const known = normalizeCode(fallback);
  if (known !== 'UNKNOWN' && PRESENTATIONS[known]) return known;
  const explicit =
    text.match(/grpc status\s+([A-Za-z_]+)\s*:/i)?.[1] ?? text.match(/(?:code|status)\s*[=:]\s*([A-Za-z_]+)/i)?.[1];
  if (explicit) return normalizeCode(explicit);

  const lower = text.toLowerCase();
  if (/authentication|credentials|authorization token|unauthenticated/.test(lower)) return 'UNAUTHENTICATED';
  if (/permission denied|not authorized|forbidden/.test(lower)) return 'PERMISSION_DENIED';
  if (/deadline|timed? out|timeout/.test(lower)) return 'DEADLINE_EXCEEDED';
  if (/unavailable|connection refused|transport error|failed to dial|connect failed|dns error/.test(lower))
    return 'UNAVAILABLE';
  if (/cancelled|canceled/.test(lower)) return 'CANCELLED';

  const normalizedFallback = normalizeCode(fallback);
  return PRESENTATIONS[normalizedFallback] ? normalizedFallback : 'UNKNOWN';
}

function cleanMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:error:\s*)?/i, '')
    .replace(/^grpc status\s+[A-Za-z_]+\s*:\s*/i, '')
    .replace(/^grpc status\s*:?\s*/i, '')
    .replace(/^status\s*[=:]\s*[A-Za-z_]+\s*,?\s*/i, '')
    .replace(/^message\s*[=:]\s*/i, '')
    .trim();
}

export function presentGrpcError(status: string, body: string, tr: Translate = get(t)): GrpcErrorPresentation {
  const raw = body.trim() || status.trim() || tr('grpc.error.unknownRaw');
  const code = inferCode(raw, status);
  const presentation = PRESENTATIONS[code] ?? PRESENTATIONS.UNKNOWN;
  const title = tr(`grpc.error.${PRESENTATIONS[code] ? code : 'UNKNOWN'}.title`);
  return {
    code,
    title,
    message: cleanMessage(raw) || title,
    hint: tr(`grpc.error.${PRESENTATIONS[code] ? code : 'UNKNOWN'}.hint`),
    raw,
    action: presentation.action,
    actionLabel: presentation.actionLabel && tr(presentation.actionLabel),
  };
}

/** One-line explanation under a failed call (S24), keyed by code. Codes without a note yield ''. */
const NOTE_CODES = new Set([
  'INVALID_ARGUMENT',
  'OUT_OF_RANGE',
  'FAILED_PRECONDITION',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'DEADLINE_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'ABORTED',
  'UNIMPLEMENTED',
  'INTERNAL',
  'DATA_LOSS',
  'CANCELLED',
]);

export function grpcErrorNote(code: string, numeric: number, tr: Translate = get(t)): string {
  return NOTE_CODES.has(code) ? tr('grpc.note.line', { n: numeric, note: tr(`grpc.note.${code}`) }) : '';
}
