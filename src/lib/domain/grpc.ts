import type { GrpcTabState } from './types';

export function methodShort(symbol: string): string {
  const i = symbol.lastIndexOf('.');
  return i === -1 ? symbol : symbol.slice(i + 1);
}

/**
 * Postman-style guidance shown when the server connection worked but its
 * services could not be listed (no reflection support): neutral "load a
 * schema" advice instead of a red error.
 */
export const GRPC_NO_SERVICES_HINT =
  "Couldn't load services from the server. Import a .proto file (in the schema menu above) to load this API's services and methods.";

/**
 * Infer plaintext-vs-TLS from an endpoint: plaintext unless it clearly targets
 * the TLS port (`:443`). Callers must pass the endpoint with `{{vars}}` already
 * resolved — the `:443` may live inside a variable's value (e.g.
 * `{{host}}` = `api.example.com:443`), so testing the raw template would
 * mis-infer plaintext for TLS endpoints.
 */
export function inferGrpcPlaintext(endpoint: string): boolean {
  return !/:443(\b|$)/.test(endpoint);
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
 * becomes the neutral `GRPC_NO_SERVICES_HINT`; the proto source always shows
 * its verbatim error (compile failure / "select a .proto first").
 */
export function grpcConnectFailureMessage(
  source: GrpcTabState['source'],
  stage: GrpcConnectStage,
  error: unknown,
): string {
  if (stage === 'schema' && source !== 'proto') return GRPC_NO_SERVICES_HINT;
  return error instanceof Error ? error.message : String(error);
}
