import { type GrpcField, type GrpcTabState, tokenize } from '$shared/model';
import { t, ru, en } from '$shared/i18n';

export function methodShort(symbol: string): string {
  const i = symbol.lastIndexOf('.');
  return i === -1 ? symbol : symbol.slice(i + 1);
}

/** E2/E5: short request message type of the picked method («CreateBatchRequest»), '' until the schema knows it. */
export function grpcInputType(grpc: GrpcTabState | undefined): string {
  const method = grpc?.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === grpc.method);
  return methodShort(method?.inputType ?? '');
}

/**
 * Postman-style guidance shown when the server connection worked but its
 * services could not be listed (no reflection support): neutral "load a
 * schema" advice instead of a red error.
 */
export const grpcNoServicesHint = (): string => t('grpc.noServicesHint');

/** True for the hint in either UI language (a stored error may predate a language switch). */
export const isGrpcNoServicesHint = (msg: string): boolean =>
  msg === ru['grpc.noServicesHint'] || msg === en['grpc.noServicesHint'];

/**
 * The server was not reached (refused, DNS, TLS handshake, connect timeout): `code` from a
 * `GrpcCommandError`. Such a dial is safe to retry, and the response pane draws it as S25.
 */
export const isGrpcConnectionCode = (code: string | undefined): boolean =>
  code === 'UNAVAILABLE' || code === 'DEADLINE_EXCEEDED';

/**
 * Infer plaintext-vs-TLS from an endpoint. An explicit `https://` / `http://`
 * scheme wins; otherwise port 443 implies TLS. Callers must pass the endpoint
 * with `{{vars}}` already resolved — the scheme or port may live inside a
 * variable value.
 */
export function inferGrpcPlaintext(endpoint: string): boolean {
  const clean = endpoint.trim().toLowerCase();
  if (clean.startsWith('https://')) return false;
  if (clean.startsWith('http://')) return true;
  return !/:443(\b|$)/.test(clean);
}

/** Which step of a gRPC connect flow failed (see `grpcConnectFailureMessage`). */
export type GrpcConnectStage = 'dial' | 'schema';

/**
 * Map a gRPC connect-flow failure to the banner message shown in the editor.
 *
 * Dial-stage failures (invalid/unresolved endpoint, unreachable server) always
 * surface the REAL error, for every schema source: "import a .proto" can't fix
 * an endpoint that never connected, and hiding e.g.
 * `invalid endpoint http://{{host}}:9090` behind schema guidance sends the
 * user chasing the wrong problem. Only a schema-stage failure (reflection
 * unsupported or failed AFTER the dial succeeded) on a reflection-sourced tab
 * becomes the neutral `grpcNoServicesHint()`; the proto source always shows
 * its verbatim error (compile failure / "select a .proto first").
 */
export function grpcConnectFailureMessage(
  source: GrpcTabState['source'],
  stage: GrpcConnectStage,
  error: unknown,
): string {
  if (stage === 'schema' && source !== 'proto') return grpcNoServicesHint();
  return error instanceof Error ? error.message : String(error);
}

/**
 * S30: over plaintext the `authorization` header would travel unencrypted, so
 * by default it isn't sent; the request can opt back in.
 */
export function stripsAuthorization(g: Pick<GrpcTabState, 'keepAuthOnPlaintext'>, plaintext: boolean): boolean {
  return plaintext && !g.keepAuthOnPlaintext;
}

/** S25: waits between dial attempts when Invoke can't reach the server (3 attempts). */
export const GRPC_DIAL_BACKOFF_MS = [500, 2000];

/** Short cause for the S25 card: «connection refused», or the error itself. */
export function dialFailureReason(error: string): string {
  const m = error.match(
    /connection refused|timed? ?out|connection reset|dns error|no route to host|network is unreachable|certificate[^:]*/i,
  );
  return (m?.[0] ?? error).toLowerCase();
}

/** gRPC codes caused by the request itself (amber `!`); the rest are server/transport (red `×`). */
const CLIENT_CODES = new Set([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'FAILED_PRECONDITION',
  'OUT_OF_RANGE',
  'CANCELLED',
]);
export function grpcCodeTone(code: string): 'warning' | 'danger' {
  return CLIENT_CODES.has(code) ? 'warning' : 'danger';
}

/** Method kind badge for the picker (S23). */
export function grpcMethodKind(m: { clientStreaming?: boolean; serverStreaming?: boolean }): string {
  if (m.clientStreaming && m.serverStreaming) return 'bidi stream';
  if (m.clientStreaming) return 'client stream';
  if (m.serverStreaming) return 'server stream';
  return 'unary';
}

/** G1: what a pasted `grpcurl …` command sets on the request. */
export interface GrpcurlImport {
  endpoint: string;
  plaintext: boolean;
  /** `pkg.Service.Method`, as the method picker stores it. */
  method?: string;
  message?: string;
  metadata: Record<string, string>;
  insecure: boolean;
  protoPaths: string[];
  importPaths: string[];
}

/** grpcurl flags that take a value (`-flag value` or `-flag=value`). */
const GRPCURL_VALUE_FLAGS = new Set([
  'd',
  'H',
  'rpc-header',
  'reflect-header',
  'proto',
  'protoset',
  'import-path',
  'authority',
  'servername',
  'cert',
  'key',
  'cacert',
  'max-time',
  'connect-timeout',
  'keepalive-time',
  'max-msg-sz',
  'format',
  'user-agent',
  'protoset-out',
]);

/** Parse a `grpcurl` command line; `undefined` when the text isn't one. */
export function parseGrpcurl(input: string): GrpcurlImport | undefined {
  if (!/^\s*grpcurl\s/.test(input)) return undefined;
  const out: GrpcurlImport = {
    endpoint: '',
    plaintext: false,
    metadata: {},
    insecure: false,
    protoPaths: [],
    importPaths: [],
  };
  const positional: string[] = [];
  const args = tokenize(input.replace(/\\\r?\n/g, ' ')).slice(1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    const [flag, inline] = arg.replace(/^--?/, '').split(/=(.*)/s);
    const value = inline ?? (GRPCURL_VALUE_FLAGS.has(flag) ? (args[++i] ?? '') : undefined);
    if (flag === 'plaintext') out.plaintext = true;
    else if (flag === 'insecure') out.insecure = true;
    else if (flag === 'd' && value !== '@') out.message = prettyJson(value ?? '');
    else if (flag === 'H' || flag === 'rpc-header') {
      const cut = (value ?? '').indexOf(':');
      if (cut > 0) out.metadata[value!.slice(0, cut).trim().toLowerCase()] = value!.slice(cut + 1).trim();
    } else if (flag === 'proto') out.protoPaths.push(value ?? '');
    else if (flag === 'import-path') out.importPaths.push(value ?? '');
  }
  const [endpoint = '', method] = positional.filter((p) => p !== 'list' && p !== 'describe' && p !== 'call');
  out.endpoint = endpoint;
  if (method) out.method = method.replace('/', '.');
  return out;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** G4: a message problem found before sending — a key the schema lacks, or a value of the wrong JSON type. */
export type GrpcMessageIssue = { field: string; kind: 'unknown' } | { field: string; kind: 'type'; expected: string };

function jsonFits(value: unknown, f: GrpcField): boolean {
  // null = field default; `{{var}}` strings resolve later, so any shape may hide behind them.
  if (value === null || (typeof value === 'string' && value.includes('{{'))) return true;
  switch (f.json) {
    case 'string':
      return typeof value === 'string';
    // proto3 JSON takes 64-bit ints (and NaN/Infinity) as strings too.
    case 'number':
      return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'enum':
      return (
        typeof value === 'number' ||
        (typeof value === 'string' && (!f.enumValues?.length || f.enumValues.includes(value)))
      );
    default:
      return true;
  }
}

/**
 * Check the top-level keys of a JSON message against the request schema.
 * Invalid JSON and non-objects yield nothing — the editor reports those itself.
 * ponytail: top level only; nested messages need their own schema from the backend.
 */
export function checkGrpcMessage(text: string, fields: GrpcField[] | undefined): GrpcMessageIssue[] {
  if (!fields?.length) return [];
  let value: unknown;
  try {
    value = JSON.parse(text.trim() || '{}');
  } catch {
    return [];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, v]): GrpcMessageIssue[] => {
    const f = fields.find((x) => x.name === key || x.protoName === key);
    if (!f) return [{ field: key, kind: 'unknown' }];
    return jsonFits(v, f) ? [] : [{ field: key, kind: 'type', expected: f.typeLabel }];
  });
}

/**
 * G4: true when the cursor (after any half-typed `"key`) sits where a top-level
 * key goes — right after the root `{` or a `,` at depth 1.
 */
export function atTopLevelKey(before: string): boolean {
  const head = before.replace(/"?[\w$]*$/, '');
  let depth = 0;
  let inString = false;
  let last = '';
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    if (!/\s/.test(ch)) last = ch;
  }
  return depth === 1 && (last === '{' || last === ',');
}

/** Starter value a completion inserts for a field: `""`, `0`, `false`, `[]`, `{}`, or the first enum value. */
export function grpcFieldStub(f: GrpcField): string {
  switch (f.json) {
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    case 'enum':
      return `"${f.enumValues?.[0] ?? ''}"`;
    default:
      return '""';
  }
}
