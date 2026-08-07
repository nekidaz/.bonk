export interface GrpcErrorPresentation {
  code: string;
  title: string;
  message: string;
  hint: string;
  raw: string;
  action?: 'metadata' | 'message';
  actionLabel?: string;
}

const PRESENTATIONS: Record<string, { title: string; hint: string; action?: 'metadata' | 'message'; actionLabel?: string }> = {
  CANCELLED: {
    title: 'Request cancelled',
    hint: 'Invoke the method again when you are ready.',
  },
  INVALID_ARGUMENT: {
    title: 'Invalid request',
    hint: 'Check the JSON message and required fields before invoking again.',
    action: 'message',
    actionLabel: 'Edit message',
  },
  DEADLINE_EXCEEDED: {
    title: 'Request timed out',
    hint: 'Check the endpoint or increase the request timeout in Settings.',
  },
  NOT_FOUND: {
    title: 'Resource not found',
    hint: 'Verify the selected method and identifiers in the request message.',
  },
  ALREADY_EXISTS: {
    title: 'Resource already exists',
    hint: 'Change the unique identifier or use the existing resource.',
  },
  PERMISSION_DENIED: {
    title: 'Permission denied',
    hint: 'The credentials were recognized, but they do not allow this operation.',
    action: 'metadata',
    actionLabel: 'Open Metadata',
  },
  UNAUTHENTICATED: {
    title: 'Authentication required',
    hint: 'Add the required authorization token in the Metadata tab, then invoke again.',
    action: 'metadata',
    actionLabel: 'Open Metadata',
  },
  RESOURCE_EXHAUSTED: {
    title: 'Resource limit reached',
    hint: 'Wait and retry, or reduce the request size or frequency.',
  },
  FAILED_PRECONDITION: {
    title: 'Precondition failed',
    hint: 'The server is not ready for this operation. Review the request state and try again.',
  },
  ABORTED: {
    title: 'Operation aborted',
    hint: 'Retry the operation. The server stopped it because of a conflict.',
  },
  OUT_OF_RANGE: {
    title: 'Value out of range',
    hint: 'Check numeric values, offsets, and limits in the request message.',
    action: 'message',
    actionLabel: 'Edit message',
  },
  UNIMPLEMENTED: {
    title: 'Method not implemented',
    hint: 'Confirm that this server supports the selected gRPC method.',
  },
  INTERNAL: {
    title: 'Internal server error',
    hint: 'The server failed while processing the request. Check its logs for details.',
  },
  UNAVAILABLE: {
    title: 'Service unavailable',
    hint: 'Check the endpoint and TLS setting, then retry when the service is available.',
  },
  DATA_LOSS: {
    title: 'Data loss reported',
    hint: 'Do not retry blindly. Check the server logs and data integrity first.',
  },
  UNKNOWN: {
    title: 'gRPC request failed',
    hint: 'Review the technical details and verify the endpoint, message, and metadata.',
  },
};

function normalizeCode(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

function inferCode(text: string, fallback: string): string {
  const explicit = text.match(/grpc status\s+([A-Za-z_]+)\s*:/i)?.[1]
    ?? text.match(/(?:code|status)\s*[=:]\s*([A-Za-z_]+)/i)?.[1];
  if (explicit) return normalizeCode(explicit);

  const lower = text.toLowerCase();
  if (/authentication|credentials|authorization token|unauthenticated/.test(lower)) return 'UNAUTHENTICATED';
  if (/permission denied|not authorized|forbidden/.test(lower)) return 'PERMISSION_DENIED';
  if (/deadline|timed? out|timeout/.test(lower)) return 'DEADLINE_EXCEEDED';
  if (/unavailable|connection refused|transport error/.test(lower)) return 'UNAVAILABLE';
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

export function presentGrpcError(status: string, body: string): GrpcErrorPresentation {
  const raw = body.trim() || status.trim() || 'Unknown gRPC error';
  const code = inferCode(raw, status);
  const presentation = PRESENTATIONS[code] ?? PRESENTATIONS.UNKNOWN;
  return {
    code,
    title: presentation.title,
    message: cleanMessage(raw) || presentation.title,
    hint: presentation.hint,
    raw,
    action: presentation.action,
    actionLabel: presentation.actionLabel,
  };
}
