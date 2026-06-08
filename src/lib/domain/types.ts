export type RequestProtocol = 'http' | 'grpc';
export type Protocol = RequestProtocol | 'git';
export type BodyMode = 'none' | 'form-data' | 'urlencoded' | 'raw' | 'binary' | 'graphql';
export type RawBodyFormat = 'JSON' | 'Text' | 'JavaScript' | 'HTML' | 'XML';
export type BodyParamKind = 'text' | 'file';
export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';
export type ApiKeyLocation = 'header' | 'query';

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyMode?: BodyMode;
  rawBodyFormat?: RawBodyFormat;
  bodyParams?: BodyParam[];
  auth?: AuthConfig;
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

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  validateTls: boolean;
  maxResponseBodyBytes: number;
}

/** A single query-parameter row in the HTTP Params table (frontend-only). */
export interface Param {
  key: string;
  value: string;
  description: string;
  enabled: boolean;
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
  git?: GitTabState;
  /** Query-parameter rows for the Params table; appended to the URL on send. */
  params?: Param[];
}

export interface RequestNode {
  kind: 'request';
  id: string;            // fs:<relpath>
  name: string;
  protocol: RequestProtocol;
  request: HttpRequest;
  params?: Param[];
  grpc?: GrpcTabState;
}

export interface FolderNode {
  kind: 'folder';
  id: string;            // fs:<relpath>
  name: string;
  expanded: boolean;
  children: TreeNode[];
}

export type TreeNode = FolderNode | RequestNode;

export interface HistoryEntry {
  id: string;
  protocol: RequestProtocol;
  request: HttpRequest;
  status: number;
  ok?: boolean;            // explicit success flag (esp. for grpc)
  grpc?: GrpcTabState;     // snapshot for replay of grpc requests
  at: number;
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
}
export interface GrpcService { name: string; methods: GrpcMethod[]; }
export interface ServiceTree { services: GrpcService[]; }
export interface GrpcResult { ok: boolean; status: string; body: string; elapsed_ms: number; size_bytes: number; }
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
}
