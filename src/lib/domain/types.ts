export type RequestProtocol = 'http' | 'grpc';
/**
 * Tab kinds: the two request protocols plus the special full-pane tabs —
 * 'git' (diff / project-diff views), 'env' (the Environments manager),
 * 'runner' (the Collection Runner), and 'flow' (a Flow canvas). Special tabs
 * hold no request state and are never persisted.
 */
export type Protocol = RequestProtocol | 'git' | 'env' | 'runner' | 'flow';
export type BodyMode = 'none' | 'form-data' | 'urlencoded' | 'raw' | 'binary' | 'graphql';
export type RawBodyFormat = 'JSON' | 'Text' | 'JavaScript' | 'HTML' | 'XML';
export type BodyParamKind = 'text' | 'file';
export type AuthType = 'inherit' | 'none' | 'bearer' | 'basic' | 'apiKey';
export type ApiKeyLocation = 'header' | 'query';

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** JSON object text from the GraphQL Variables editor. */
  graphqlVariables?: string;
  /** Local file to stream as a binary request body when bodyMode is 'binary'. */
  binaryFilePath?: string;
  bodyMode?: BodyMode;
  rawBodyFormat?: RawBodyFormat;
  bodyParams?: BodyParam[];
  auth?: AuthConfig;
  /** Postman-style pre-request script (JS); runs before {{var}} resolution. */
  preRequestScript?: string;
  /** Postman-style test script (JS); runs against the response. */
  testScript?: string;
  /** Free-text description per header key (Headers table). */
  headerNotes?: Record<string, string>;
  /** Header keys kept in the request but switched off: never sent. */
  disabledHeaders?: string[];
}

export interface BodyParam {
  key: string;
  value: string;
  description: string;
  enabled: boolean;
  kind?: BodyParamKind;
  filePath?: string;
}

export interface AuthConfig {
  type: AuthType;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyIn?: ApiKeyLocation;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  final_url: string;
  elapsed_ms: number;
  size_bytes: number;
  body_truncated?: boolean;
}

export type ProxyMode = 'system' | 'none' | 'manual';

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  validateTls: boolean;
  maxResponseBodyBytes: number;
  proxy: { mode: ProxyMode; url: string; bypass: string; username: string; password: string };
  caPaths: string[];
  trustSystemCas: boolean;
  /** Per-host mTLS identities; the backend picks the one matching the request host. */
  clientCerts: { host: string; certPath: string; keyPath: string; p12Path?: string; p12Password?: string }[];
}

/** Per-request overrides of the global request settings (RequestSettings popover); unset = use the global value. */
export interface RequestOverrides {
  timeoutMs?: number;
  followRedirects?: boolean;
  validateTls?: boolean;
}

/** Global gRPC limits / rendering options (bonk-core `GrpcPrefs`). */
export interface GrpcPrefs {
  maxMessageMb: number;
  keepaliveSecs: number;
  emitDefaults: boolean;
  int64AsNumber: boolean;
}

/** A single query-parameter row in the HTTP Params table (frontend-only). */
export interface Param {
  key: string;
  value: string;
  description: string;
  enabled: boolean;
}

/** A single variable row in an environment / the globals table (mirrors ParamRow). */
export interface VarRow {
  key: string;
  value: string;
  enabled: boolean;
  /** Masked in the UI and kept out of cURL / code snippets. */
  secret?: boolean;
}

/** A named set of variables. `{{key}}` placeholders resolve against the active one. */
export interface Environment {
  id: string;
  name: string;
  vars: VarRow[];
  /** Label colour key (see ENV_COLORS in palette.ts); absent = derived from the name. */
  color?: string;
  /** Confirm mutating requests; absent = derived from the name (production). */
  protected?: boolean;
}

export interface Tab {
  id: string;
  protocol: Protocol;
  title: string;
  /** True once the user explicitly renames the request; URL edits no longer auto-rename it. */
  manualTitle?: boolean;
  request: HttpRequest;
  /** fs id of the saved request file this tab is linked to, if any. */
  savedPath?: string;
  /** id of the history entry this tab was opened from, if any (dedupes re-opens). */
  historyId?: string;
  response?: HttpResponse;
  grpc?: GrpcTabState;
  grpcResult?: GrpcResult;
  /** Live / last server stream for this tab (runtime-only). */
  grpcStream?: { messages: GrpcStreamMessage[]; done: boolean; startedAt: number; headers?: Record<string, string> };
  git?: GitTabState;
  /** Query-parameter rows for the Params table; appended to the URL on send. */
  params?: Param[];
  /** Latest pre-request + test script output for this tab (runtime-only). */
  testResults?: TabTestResults;
  /** id of the Flow this tab shows (protocol 'flow' only). */
  flowId?: string;
  /** Per-request overrides of timeout / redirects / TLS verification (session-only, not saved to the file). */
  settings?: RequestOverrides;
  /** S17b: pinned tabs lead the strip and survive «Закрыть остальные / справа / все». */
  pinned?: boolean;
}

/** Aggregated script output attached to a tab after a send (not persisted). */
export interface TabTestResults {
  tests: ScriptTestResult[];
  logs: string[];
  /** Fatal script error (thrown/timeout), if any, from either phase. */
  error?: string;
}

/** One `pm.test(...)` outcome. */
export interface ScriptTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface RequestNode {
  kind: 'request';
  id: string; // fs:<relpath>
  name: string;
  protocol: RequestProtocol;
  request: HttpRequest;
  params?: Param[];
  grpc?: GrpcTabState;
}

export interface FolderNode {
  kind: 'folder';
  id: string; // fs:<relpath>
  name: string;
  expanded: boolean;
  /** Collection-level auth (`.folder.bonk.json`); requests set to 'inherit' use it. */
  auth?: AuthConfig;
  children: TreeNode[];
}

export type TreeNode = FolderNode | RequestNode;

export interface HistoryEntry {
  id: string;
  protocol: RequestProtocol;
  request: HttpRequest;
  status: number;
  ok?: boolean; // explicit success flag (esp. for grpc)
  grpc?: GrpcTabState; // snapshot for replay of grpc requests
  at: number;
  envName?: string; // environment active when it was sent
  /** S21: the saved request it came from, and the editable draft as typed (with {{vars}}). */
  savedPath?: string;
  title?: string;
  raw?: HttpRequest;
  params?: Param[];
}

// ---------- Git source control (camelCase, mirrors the Rust core types) ----------
/** One changed/untracked path. `index`/`worktree` are single porcelain status chars. */
export interface GitFile {
  path: string;
  /** Status in the index ("M","A","D","R","?"," "). */
  index: string;
  /** Status in the worktree ("M","A","D","R","?"," "). */
  worktree: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  /**
   * Workspace path relative to the git toplevel, forward-slash and
   * trailing-slash terminated (e.g. `"collections/"`); empty when the workspace
   * is the toplevel. `files[].path` are toplevel-relative, so map a
   * workspace-relative node id to its status key as `prefix + wsRel`.
   */
  prefix: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
}

export type GitDiffMode = 'working' | 'staged';

export interface GitTabState {
  path: string;
  mode: GitDiffMode;
  /** 'file' = single-file diff (default); 'project' = the aggregate Project Diff. */
  view?: 'file' | 'project';
}

export interface FileDiff {
  path: string;
  staged: boolean;
  untracked: boolean;
  diff: string;
}

export interface GrpcMethod {
  name: string;
  symbol: string;
  /** True for client/bidi-streaming RPCs (client side is a stream). */
  clientStreaming?: boolean;
  /** True for server/bidi-streaming RPCs (server side is a stream). */
  serverStreaming?: boolean;
  /** Full name of the request message type, e.g. `helloworld.HelloRequest`. */
  inputType?: string;
  /** Number of fields in the request message. */
  inputFields?: number;
  /** Full name of the response message type, e.g. `helloworld.HelloReply`. */
  outputType?: string;
  /** G4: top-level request fields for completions and pre-send checks. */
  inputSchema?: GrpcField[];
}
export interface GrpcField {
  /** JSON name; `protoName` is accepted in messages too. */
  name: string;
  protoName: string;
  /** `string`, `enum Greeting`, `repeated string`, `map<string, int32>`. */
  typeLabel: string;
  json: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum' | 'any';
  /** First line of the .proto comment, '' without source info. */
  doc?: string;
  enumValues?: string[];
}
export interface GrpcService {
  name: string;
  methods: GrpcMethod[];
}
export interface ServiceTree {
  services: GrpcService[];
}
/** One message of a server stream (S20). */
export interface GrpcStreamMessage {
  index: number;
  atMs: number;
  body: string;
  sizeBytes: number;
  /** First event only: response headers, before any message. */ headers?: Record<string, string>;
  /** Frontend only: a message we sent on a client/bidi stream. */ sent?: boolean;
}
export interface GrpcResult {
  ok: boolean;
  status: string;
  body: string;
  elapsed_ms: number;
  size_bytes: number;
  metadata?: Record<string, string>;
  trailers?: Record<string, string>;
  details?: GrpcErrorDetail[];
  /** S25: dial attempts and the waits between them (frontend only). */ attempts?: number;
  backoffMs?: number[];
}
/** A decoded `google.rpc.Status` detail; BadRequest carries field violations (S24). */
export interface GrpcErrorDetail {
  typeName: string;
  fieldViolations: { field: string; description: string }[];
}
/** Per-request TLS options (S29). Unset = system roots, verified. */
export interface GrpcTls {
  insecure?: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  clientP12?: string;
  clientP12Password?: string;
}
/** The server's leaf certificate as seen in a TLS handshake. */
export interface GrpcCertInfo {
  verified: boolean;
  error?: string | null;
  subject: string;
  issuer: string;
  notAfter: number;
}

// ---------- Collection Runner ----------
/**
 * One executed request in a Collection Runner run — a flat, self-contained
 * row so the results list can stream and the exported report needs no back-refs.
 * `ok` is the single "this passed" verdict: transport succeeded AND every
 * `pm.test` passed AND no fatal script/connect error.
 */
export interface RunResultRow {
  id: string; // crypto.randomUUID()
  iteration: number; // 1-based
  requestName: string;
  protocol: RequestProtocol;
  method: string; // HTTP method, or 'gRPC'
  target: string; // resolved URL (HTTP) or "endpoint · method" (gRPC)
  status: number | string; // HTTP status code, or gRPC status text ('OK', etc)
  ok: boolean; // transport ok AND all tests passed AND no fatal error
  elapsedMs: number;
  tests: ScriptTestResult[];
  logs: string[];
  error?: string; // transport/connect/fatal error message
  /** Response body (HTTP) / result body (gRPC); Flows pass it downstream. */
  responseBody?: string;
  /** Saved request node id (Runner re-runs, "Открыть запрос"). */
  nodeId?: string;
  /** Start time within its iteration, excluding the configured delay (waterfall). */
  startOffsetMs?: number;
  /** Response size, bytes. */
  sizeBytes?: number;
  /** Runner: when the call finished, ms since the run started (R3 log). */
  endMs?: number;
}

/** Lifecycle of a Collection Runner run. */
export type RunStatus = 'idle' | 'running' | 'done' | 'stopped';
export interface GrpcTabState {
  endpoint: string;
  plaintext: boolean;
  connectionId?: string;
  tree?: ServiceTree;
  method?: string;
  message: string;
  metadata: Record<string, string>;
  /** Schema source for this tab. Defaults to reflection when unset. */
  source?: 'reflection' | 'proto';
  /** Absolute (in-memory) or workspace-relative (on disk) .proto file paths. */
  protoPaths?: string[];
  /** Extra compiler import roots for resolving `import` statements. */
  importPaths?: string[];
  /** TLS options (ignored for plaintext). */
  tls?: GrpcTls;
  /** Auth sent as metadata; unset / 'inherit' takes the collection's (S19 «Auth»). */
  auth?: AuthConfig;
  /** Plaintext only: drop `authorization` metadata so tokens never go out unencrypted (default on). */
  keepAuthOnPlaintext?: boolean;
  /** Postman-style pre-request script (JS); runs before {{var}} resolution and the call. */
  preRequestScript?: string;
  /** Postman-style test script (JS); runs against the gRPC result. */
  testScript?: string;
}
