/** Status wording shared by the response header and its collapsed strip. Pure. */
export const HTTP_STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Error',
  502: 'Bad Gateway',
  503: 'Unavailable',
  504: 'Gateway Timeout',
};

export const GRPC_CODES = [
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
];

/** `0 OK`, `14 UNAVAILABLE` — gRPC status with its numeric code. */
export const grpcStatusLabel = (code: string): string =>
  GRPC_CODES.includes(code) ? `${GRPC_CODES.indexOf(code)} ${code}` : code;

/** `42 ms`, `3.4 s`. */
export const elapsedLabel = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
