import { t, type Translate } from '$shared/i18n';

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

/** `status` is a real gRPC code (from the server, or the `code` of a `GrpcCommandError`); anything else is UNKNOWN. */
function knownCode(status: string): string {
  const code = normalizeCode(status);
  return PRESENTATIONS[code] ? code : 'UNKNOWN';
}

function cleanMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:error:\s*)?/i, '')
    .replace(/^status\s*[=:]\s*[A-Za-z_]+\s*,?\s*/i, '')
    .replace(/^message\s*[=:]\s*/i, '')
    .trim();
}

export function presentGrpcError(status: string, body: string, tr: Translate = t): GrpcErrorPresentation {
  const raw = body.trim() || status.trim() || tr('grpc.error.unknownRaw');
  const code = knownCode(status);
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

export function grpcErrorNote(code: string, numeric: number, tr: Translate = t): string {
  return NOTE_CODES.has(code) ? tr('grpc.note.line', { n: numeric, note: tr(`grpc.note.${code}`) }) : '';
}
