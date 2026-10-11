import type { DynamicValue } from './dynamicVars';
export type RequestProtocol = 'http' | 'grpc';
/**
 * Tab kinds: the two request protocols plus the special full-pane tabs —
 * 'git' (diff / project-diff views), 'env' (the Environments manager),
 * 'runner' (the Collection Runner). Special tabs
 * hold no request state and are never persisted.
 */
export type Protocol = RequestProtocol | 'git' | 'env' | 'runner';
export type BodyMode = 'none' | 'form-data' | 'urlencoded' | 'raw' | 'binary' | 'graphql';
export type RawBodyFormat = 'JSON' | 'Text' | 'JavaScript' | 'HTML' | 'XML';
export type BodyParamKind = 'text' | 'file';
export type AuthType = 'inherit' | 'none' | 'bearer' | 'basic' | 'apiKey' | 'oauth2';
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
  /** `type: 'oauth2'`. The token is never saved here: it lives in the keychain. */
  oauth?: OAuthConfig;
}

export type OAuthGrant = 'authorization_code' | 'client_credentials' | 'password';

/** OAuth 2.0 client settings (`{{vars}}` allowed). Mirrors `OAuthConfig` in http.rs. */
export interface OAuthConfig {
  /** Empty means `authorization_code`. */
  grant?: OAuthGrant | '';
  authUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  clientId?: string;
  clientSecret?: string;
  /** `basic` (default): an Authorization header; `body`: in the form. */
  clientAuth?: 'basic' | 'body' | '';
  /** Space-separated. */
  scope?: string;
  audience?: string;
  /** Empty: `http://127.0.0.1:<free port>/callback`. */
  redirectUri?: string;
  /** PKCE S256, on unless false. */
  pkce?: boolean;
  username?: string;
  password?: string;
  /** Get a new token by itself when the old one expired; on unless false. */
  autoRefresh?: boolean;
}

/** A stored OAuth token as the UI sees it (no refresh token). Times are unix seconds. */
export interface OAuthTokenInfo {
  accessToken: string;
  tokenType: string;
  hasRefresh: boolean;
  expiresAt: number | null;
  scope: string;
  obtainedAt: number;
}

export interface OAuthEnsured {
  token: OAuthTokenInfo;
  /** Just obtained for this send (the old one had expired, or it was forced). */
  renewed: boolean;
  previousExpiresAt: number | null;
}

/** What an OAuth command rejects with (`OAuthError` in oauth.rs). */
export type OAuthFailure =
  | { kind: 'provider'; status: number; url: string; error: string; description: string; body: string }
  | { kind: 'login'; reason: string }
  | { kind: 'other'; message: string };

export interface OAuthLoginStarted {
  flowId: string;
  url: string;
  redirectUri: string;
  /** False: the redirect URI is not a loopback address, the code must be pasted. */
  listens: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  final_url: string;
  elapsed_ms: number;
  size_bytes: number;
  body_truncated?: boolean;
  /** The response's Set-Cookies with their effect on the jar (absent in old history entries). */
  cookies?: ResponseCookie[];
  /** How many jar cookies the next request to `final_url` carries; absent when sending is off. */
  jar_sends?: number;
}

/** One cookie of a workspace jar (bonk-core `CookieInfo`). */
export interface CookieInfo {
  name: string;
  value: string;
  /** Host (host-only cookie) or the Domain attribute without a leading dot. */
  domain: string;
  hostOnly: boolean;
  path: string;
  /** Unix ms; null = session cookie. */
  expiresMs: number | null;
  expired: boolean;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
  /** The cookie as a Set-Cookie value. */
  raw: string;
}

/** `null` = saving to the jar is off. */
export type CookieChange = 'new' | 'updated' | 'deleted' | 'rejected';
export type ResponseCookie = CookieInfo & { change: CookieChange | null };

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
  /** Workspace root whose cookie jar stores and sends cookies; '' = the app-wide jar. */
  cookieJar: string;
  cookiesSave: boolean;
  cookiesSend: boolean;
  /** Save session cookies too, so they survive a restart. */
  cookiesKeepSession: boolean;
  /** Domains never stored nor sent (`sentry.io`, `*.doubleclick.net`). */
  cookiesExclude: string[];
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
  /** Live / last stream for this tab (runtime-only). */
  grpcStream?: {
    messages: GrpcStreamMessage[];
    done: boolean;
    startedAt: number;
    headers?: Record<string, string>;
    /** Which side streams; absent on a stream started before this field existed (= server). */
    kind?: 'server' | 'client' | 'bidi';
    /** Client/bidi: when «Завершить» half-closed our side. */
    halfClosedAt?: number;
  };
  git?: GitTabState;
  /** Query-parameter rows for the Params table; appended to the URL on send. */
  params?: Param[];
  /** Latest pre-request + test script output for this tab (runtime-only). */
  testResults?: TabTestResults;
  /** The last request as it went on the wire + its `{{$dynamic}}` values: the Timeline (runtime-only). */
  sent?: { request: HttpRequest; dynamic: DynamicValue[] };
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
  /** Editor line of `error` (1-based), when the sandbox could pin it. */
  errorLine?: number;
  /** Stage whose script failed with `error`. 'pre' means the request was never sent (SC6). */
  errorPhase?: ScriptStage;
  /** SC5 console feed: both stages' logs, variable and header writes, and the send itself, in order. */
  events?: ScriptEvent[];
  /** Wall-clock time the post-response script took, ms (SC4 header). */
  postMs?: number;
  /** When the run finished (epoch ms): «Прошлый прогон 12:04». */
  at?: number;
}

/** The two script stages of a request. */
export type ScriptStage = 'pre' | 'post';

/** One `pm.test(...)` outcome. */
export interface ScriptTestResult {
  name: string;
  passed: boolean;
  error?: string;
  /** Line of the `pm.test(` call (1-based). */
  line?: number;
  /** Line of the assertion that failed. */
  errorLine?: number;
  /** Stage that ran the test (tabs only; the runner leaves it unset). */
  stage?: ScriptStage;
}

/**
 * One row of the script console (SC5). `kind` picks the row shape: `log` has `text`; `env`/`glob` are
 * variable writes (`op` set/unset, `key`, `value`); `hdr` a header change; `test` one `pm.test` outcome;
 * `send` the request itself (`text` = «GET url», `status`, `ms`).
 */
export interface ScriptEvent {
  t: number;
  stage: ScriptStage | 'send';
  kind: 'log' | 'env' | 'glob' | 'hdr' | 'test' | 'send';
  text?: string;
  op?: string;
  key?: string;
  value?: string;
  name?: string;
  passed?: boolean;
  status?: string;
  ms?: number;
}

export interface RequestNode {
  kind: 'request';
  id: string; // fs:<relpath>
  name: string;
  protocol: RequestProtocol;
  request: HttpRequest;
  params?: Param[];
  grpc?: GrpcTabState;
  /** The spec operation this request was imported from; re-import updates it (IM8). */
  spec?: SpecLink;
}

/** What an import generated for one request, so a re-import can tell spec changes from user edits. */
export interface SpecBase {
  method: string;
  url: string;
  params: [string, string][];
  headers: Record<string, string>;
  body: string;
}

/** Link from a saved request to its spec operation: `op` = operationId, else `METHOD path`. */
export interface SpecLink {
  op: string;
  base: SpecBase;
}

/** Where a collection was imported from (`.folder.bonk.json` `source`), for «Обновить из спецификации». */
export interface ImportSource {
  kind: 'url' | 'file';
  /** URL or absolute file path. */
  location: string;
  /** `OpenAPI 3.1`, `Postman v2.1`… */
  format: string;
  /** `info.version` at the last import. */
  version?: string;
  /** Import options at the last import (format-specific). */
  options?: Record<string, unknown>;
}

export interface FolderNode {
  kind: 'folder';
  id: string; // fs:<relpath>
  name: string;
  expanded: boolean;
  /** Collection-level auth (`.folder.bonk.json`); requests set to 'inherit' use it. */
  auth?: AuthConfig;
  /** Set on a collection made by import (IM8). */
  source?: ImportSource;
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
  /** A cherry-pick / merge / rebase / revert stopped on conflicts, or '' when none is in progress. */
  operation: '' | 'merge' | 'rebase' | 'cherry-pick' | 'revert';
  /** The branch tip before the last rebase while that rebase is its latest move, else ''. */
  undoRebase: string;
}

/** A ref pointing at a commit: `head` is the checked-out branch (or a detached `HEAD`). */
export interface GitRef {
  name: string;
  kind: 'head' | 'branch' | 'remote' | 'tag';
}

/** One commit of the G5 graph, newest first in topological order. */
export interface GraphCommit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  refs: GitRef[];
}

export interface GraphPage {
  commits: GraphCommit[];
  /** Commits in the whole range, for «Ещё N». */
  total: number;
  branches: number;
}

export interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface CommitDetail {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  body: string;
  /** Local and remote branches that contain the commit. */
  branches: string[];
  files: CommitFile[];
}

export type ResetMode = 'soft' | 'mixed' | 'hard';

/** One commit of a file's history; `path` is where the file was in it (renames followed). */
export interface FileCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  time: number;
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
}

/** One line of blame: the commit that last changed it (all zeros = not committed yet). */
export interface BlameLine {
  hash: string;
  author: string;
  time: number;
  summary: string;
  text: string;
}

/** G7: one unmerged file with each side's text; null = that side has no version (deleted there). */
export interface ConflictFile {
  path: string;
  base: string | null;
  mine: string | null;
  theirs: string | null;
}

/** G7: the stopped operation. `mine` / `theirs` are labels: the branch we're on and what comes in. */
export interface OperationInfo {
  kind: GitStatus['operation'];
  step: number;
  total: number;
  hash: string;
  subject: string;
  mine: string;
  theirs: string;
  /** A rebase paused at an `edit` step: change the requests, then continue. */
  paused: boolean;
}

/** G9: a commit an interactive rebase would replay, oldest first. */
export interface RebaseStep {
  hash: string;
  short: string;
  subject: string;
  /** The full message (subject, blank line, body). */
  message: string;
  /** Already on a remote branch: rewriting it needs a force push. */
  pushed: boolean;
}

export interface RebasePlan {
  onto: string;
  ontoShort: string;
  ontoSubject: string;
  commits: RebaseStep[];
}

export type RebaseVerb = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseAction {
  hash: string;
  action: RebaseVerb;
  /** The message a kept commit ends with after its squashes; required for reword. */
  message?: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  /** Committer time, unix seconds. */
  time: number;
}

/** A local or remote-tracking branch with its position against its upstream. */
export interface GitBranch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** One `git stash` entry; `index` is N in `stash@{N}`. */
export interface GitStash {
  index: number;
  hash: string;
  short: string;
  message: string;
  branch: string;
  time: number;
}

/** One file inside a stash, with its full-context diff. */
export interface StashFile {
  path: string;
  status: string;
  diff: string;
}

export type GitDiffMode = 'working' | 'staged';

export interface GitTabState {
  /** The file (views 'file', 'merge', 'history'), or the stash commit hash (view 'stash'). */
  path: string;
  mode: GitDiffMode;
  /** 'file' = single-file diff (default); 'project' = the aggregate Project Diff; 'stash' = one stash; 'commit' = the commit-message editor; 'graph' = the commit graph; 'history' = one file's commits and blame. */
  view?: 'file' | 'project' | 'stash' | 'commit' | 'graph' | 'conflicts' | 'merge' | 'history' | 'compare';
  /**
   * View 'file' of a past commit: its hash (the diff is against its first parent). View 'graph': the
   * commit to select. View 'compare': the target, compared against `path` (both commits or branches).
   */
  rev?: string;
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
/** One message of a stream (S20, Flow · gRPC Stream). */
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
  /** Response body (HTTP) / result body (gRPC). */
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
