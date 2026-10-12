import { Channel, invoke } from '@tauri-apps/api/core';
import {
  type DynamicOptions,
  type DynamicValue,
  type InputAnswer,
  type InputDef,
  type InputRequest,
  type Scenario,
  type HttpRequest,
  type HttpResponse,
  type CookieInfo,
  type RequestSettings,
  type Param,
  type ServiceTree,
  type GrpcResult,
  type GrpcStreamMessage,
  type GrpcTls,
  type GrpcCertInfo,
  type GrpcPrefs,
  type AuthConfig,
  type OAuthEnsured,
  type OAuthLoginStarted,
  type OAuthTokenInfo,
  type ImportSource,
  type TreeNode,
  type RequestNode,
  type RunResultRow,
  type GitStatus,
  type GitCommit,
  type GitBranch,
  type GitStash,
  type StashFile,
  type GraphPage,
  type CommitDetail,
  type FileCommit,
  type CommitFile,
  type BlameLine,
  type GitRemote,
  type ReflogEntry,
  type ResetMode,
  type ConflictFile,
  type OperationInfo,
  type RebasePlan,
  type RebaseAction,
  type FileDiff,
  parseScriptResult,
  type ScriptPhase,
  type ScriptResult,
} from '$shared/model';

export interface TerminalOutput {
  status: number;
  elapsedMs: number;
  cwd: string;
}

/** One output line of a running terminal command (streamed, CT5). */
export interface TerminalLine {
  stderr: boolean;
  text: string;
}

/**
 * Client ids (McpClientStatus.id, McpInstallOptions.clients, journal `client`):
 * 'claude-desktop' | 'openai' (ChatGPT / Codex) | 'claude-code' | 'other' (manual config).
 */
export interface McpClientStatus {
  id: string;
  name: string;
  available: boolean;
  installed: boolean;
  needsUpdate: boolean;
  workspace?: string | null;
  detail: string;
  error?: string | null;
  configPath?: string | null;
  /** ms epoch of the latest journal entry from this client. */
  lastCallAt?: number | null;
}

export interface McpIntegrationStatus {
  binaryAvailable: boolean;
  installedBinary: string;
  version: string;
  clients: McpClientStatus[];
}

export type McpMethodPolicy = 'allow' | 'ask' | 'deny';

export interface McpInstallOptions {
  workspace: string;
  /** «Изменять воркспейс» off */
  readOnly: boolean;
  /** «Отправлять запросы» off */
  noNetwork: boolean;
  /** «Разрешённые хосты»; empty = any */
  targetHosts: string[];
  /** «Видеть значения секретов» */
  exposeSecrets: boolean;
  /** Names of app environments the AI may use (others denied). */
  environments: string[];
  /** POST, PUT, PATCH, DELETE */
  mutatingMethods: McpMethodPolicy;
  /** Client ids to install for; omitted = every available client. */
  clients?: string[];
}

export interface McpOperationResult {
  status: McpIntegrationStatus;
  messages: string[];
}

export interface McpJournalEntry {
  /** ms epoch */
  at: number;
  /** client id */
  client?: string | null;
  tool: string;
  method?: string | null;
  /** path or request name */
  target?: string | null;
  env?: string | null;
  status?: number | null;
  outcome: 'ok' | 'error' | 'denied';
  summary?: string | null;
}

export const terminalDefaultCwd = (): Promise<string> => invoke<string>('terminal_default_cwd');

/**
 * `runId` lets `cancelRequest(runId)` interrupt the command (⌃C). Output arrives line by line in
 * `onLine`; `env` (only `BONK_*` names) carries secrets so they never appear in the command text.
 */
export function terminalRun(
  cwd: string | null,
  command: string,
  onLine: (line: TerminalLine) => void,
  opts: { runId?: string; env?: Record<string, string> } = {},
): Promise<TerminalOutput> {
  const channel = new Channel<TerminalLine>();
  channel.onmessage = onLine;
  return invoke<TerminalOutput>('terminal_run', {
    cwd,
    command,
    runId: opts.runId ?? null,
    env: opts.env ?? null,
    onLine: channel,
  });
}

export const mcpIntegrationStatus = (): Promise<McpIntegrationStatus> =>
  invoke<McpIntegrationStatus>('mcp_integration_status');

export const installMcpIntegration = (options: McpInstallOptions): Promise<McpOperationResult> =>
  invoke<McpOperationResult>('mcp_install', { options });

export const uninstallMcpIntegration = (clients?: string[]): Promise<McpOperationResult> =>
  invoke<McpOperationResult>('mcp_uninstall', { clients });

/** Pretty JSON `{"mcpServers":{"bonk":{command,args}}}` for setting up another client by hand. */
export const mcpClientConfig = (options: McpInstallOptions): Promise<string> =>
  invoke<string>('mcp_client_config', { options });

/** Newest first. */
export const mcpJournal = (limit?: number): Promise<McpJournalEntry[]> =>
  invoke<McpJournalEntry[]>('mcp_journal', { limit });

export const cancelRequest = (requestId: string): Promise<void> => invoke<void>('cancel_request', { requestId });

/**
 * Run a user script in the sandboxed QuickJS engine. `context` is serialized to
 * JSON for the Rust side; the returned JSON string is parsed into a typed
 * `ScriptResult` here so callers never touch the wire format.
 */
export const runScript = async (phase: ScriptPhase, code: string, context: unknown): Promise<ScriptResult> => {
  const out = await invoke<string>('run_script', {
    phase,
    code,
    context: JSON.stringify(context),
  });
  return parseScriptResult(out);
};

// Rust sends `body: null`; the TS model (and script contexts) use "absent".
const fromRust = (req: HttpRequest): HttpRequest => ({ ...req, body: req.body ?? undefined });

/** Request preparation lives in bonk-core (shared with bonk-mcp): see request_prep.rs. */
export const httpPrepare = async (req: HttpRequest, params?: Param[]): Promise<HttpRequest> =>
  fromRust(await invoke<HttpRequest>('http_prepare', { req, params: params ?? null }));

/** `{{vars}}` from `scope`, then auth. Throws on invalid GraphQL variables. */
/** After the pre-request script: the request as it goes on the wire + the `{{$dynamic}}` values in it. */
export const httpResolve = async (
  req: HttpRequest,
  scope: Record<string, string>,
  dynamic?: DynamicOptions,
): Promise<{ request: HttpRequest; dynamic: DynamicValue[] }> => {
  const out = await invoke<{ request: HttpRequest; dynamic: DynamicValue[] }>('http_resolve', {
    req,
    scope,
    dynamic: dynamic ?? null,
  });
  return { request: fromRust(out.request), dynamic: out.dynamic };
};

/** One example value per `{{$name}}` (autocomplete, reference, settings preview). */
export const dynamicSamples = (options: DynamicOptions) =>
  invoke<Record<string, string>>('dynamic_samples', { options });

export const httpSend = (req: HttpRequest, requestId?: string, settings?: RequestSettings): Promise<HttpResponse> =>
  invoke<HttpResponse>('http_send', { req, requestId: requestId ?? null, settings: settings ?? null });

/** A failed gRPC command. `code` is the gRPC status name Rust picked (`GrpcErrorCode`), e.g. `UNAVAILABLE`. */
export class GrpcCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** `code` of a failed gRPC command; undefined for untyped errors. */
export const grpcErrorCode = (e: unknown): string | undefined => (e instanceof GrpcCommandError ? e.code : undefined);

/** `invoke` for commands returning Rust's `GrpcError` (`{ code, message }`): rejects with a `GrpcCommandError`. */
function grpcInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args).catch((e: unknown) => {
    if (e && typeof e === 'object' && 'code' in e && 'message' in e)
      throw new GrpcCommandError(String(e.code), String(e.message));
    throw e;
  });
}

export const grpcConnect = (
  endpoint: string,
  plaintext: boolean,
  tls?: GrpcTls,
  timeoutMs?: number,
  prefs?: GrpcPrefs,
) =>
  grpcInvoke<string>('grpc_connect', {
    endpoint,
    plaintext,
    tls: tls ?? null,
    prefs: prefs ?? null,
    timeoutMs: timeoutMs ?? null,
  });
/** [subject CN, expiry unix seconds] of the first certificate in a PEM/CRT file. */
export const certFileInfo = (path: string) => invoke<[string, number]>('cert_file_info', { path });
export const grpcTlsInspect = (endpoint: string, tls?: GrpcTls) =>
  invoke<GrpcCertInfo>('grpc_tls_inspect', { endpoint, tls: tls ?? null });
export const grpcReflect = (connectionId: string, timeoutMs?: number) =>
  grpcInvoke<ServiceTree>('grpc_reflect', { connectionId, timeoutMs: timeoutMs ?? null });
export const grpcTemplate = (connectionId: string, method: string) =>
  invoke<string>('grpc_template', { connectionId, method });
/** A gRPC call's wire message + metadata, prepared by bonk-core (shared with bonk-mcp). */
export const grpcPrepare = (p: {
  /** Effective auth: the request's own or its folder's (`effectiveAuth`). */
  auth?: AuthConfig;
  message: string;
  metadata?: Record<string, string>;
  scope: Record<string, string>;
  /** Plaintext without the S30 opt-in: don't send `authorization`. */
  stripAuthorization?: boolean;
  /** How `{{$dynamic}}` values are generated (Settings → Variables). */
  dynamic?: DynamicOptions;
}) =>
  invoke<{ message: string; metadata: Record<string, string> }>('grpc_prepare', {
    auth: p.auth ?? null,
    message: p.message,
    metadata: p.metadata ?? {},
    scope: p.scope,
    stripAuthorization: p.stripAuthorization ?? false,
    dynamic: p.dynamic ?? null,
  });

export const grpcCall = (
  connectionId: string,
  method: string,
  jsonBody: string,
  metadata: Record<string, string>,
  requestId?: string,
  timeoutMs?: number,
) =>
  grpcInvoke<GrpcResult>('grpc_call', {
    connectionId,
    method,
    jsonBody,
    metadata,
    requestId: requestId ?? null,
    timeoutMs: timeoutMs ?? null,
  });
/** Streaming call (server/client/bidi): `onMessage` fires per message; resolves with the stream summary. */
export function grpcStream(
  connectionId: string,
  method: string,
  jsonBody: string,
  metadata: Record<string, string>,
  requestId: string,
  onMessage: (message: GrpcStreamMessage) => void,
): Promise<GrpcResult> {
  const channel = new Channel<GrpcStreamMessage>();
  channel.onmessage = onMessage;
  return grpcInvoke<GrpcResult>('grpc_stream', {
    connectionId,
    method,
    jsonBody,
    metadata,
    requestId,
    onMessage: channel,
  });
}
/** What a Collection Runner run sends (bonk-core `runner::RunPlan`); request auth already effective. */
export interface RunPlan {
  requests: RequestNode[];
  iterations: number;
  dataRows: Record<string, string>[];
  delayMs: number;
  stopOnFailure: boolean;
  workspaceRoot: string;
  globalImportPaths: string[];
  /** How `{{$dynamic}}` values are generated (Settings → Variables). */
  dynamic?: DynamicOptions;
  requiredVariables?: string[];
  /** «Ask on send» variables of the workspace, by name (`.bonk/inputs.json`). */
  inputs?: Record<string, InputDef>;
  /** What a step does when it needs input nobody gave. */
  inputMode?: 'wait' | 'fail';
  /** Tries per step: a 4xx on a step with typed input opens the form again (0 = 3). */
  inputAttempts?: number;
}

/** Script writes of a run, for the env/globals stores (and cookie clears). */
export interface RunVarWrites {
  envSet: Record<string, string>;
  envUnset: string[];
  globalsSet: Record<string, string>;
  globalsUnset: string[];
  cookieClears: string[];
}

export type RunEvent =
  | { kind: 'iteration'; index: number; atMs: number }
  | { kind: 'call'; nodeId: string; name: string; method: string }
  | ({ kind: 'vars' } & RunVarWrites)
  | ({ kind: 'row' } & RunResultRow)
  | ({ kind: 'input' } & InputRequest)
  | ({ kind: 'resent' } & RunResultRow);

/** Run `plan` in bonk-core (the same runner a CLI uses); events stream as it goes. */
export function runnerRun(
  runId: string,
  plan: RunPlan,
  vars: { environment: Record<string, string>; globals: Record<string, string> },
  settings: RequestSettings,
  grpc: { prefs: GrpcPrefs; connectTimeoutMs?: number; deadlineMs?: number },
  onEvent: (event: RunEvent) => void,
): Promise<'done' | 'stopped'> {
  const channel = new Channel<RunEvent>();
  channel.onmessage = onEvent;
  return invoke('runner_run', { runId, plan, vars, settings, grpc, onEvent: channel });
}
export const runnerPause = (runId: string, paused: boolean) => invoke<void>('runner_pause', { runId, paused });
export const runnerStop = (runId: string) => invoke<void>('runner_stop', { runId });
/** The reply to the form of an `input` event. */
export const runnerInputAnswer = (inputId: string, answer: InputAnswer) =>
  invoke<void>('runner_input_answer', { inputId, answer });

export interface RequestExecution {
  row: RunResultRow;
  details: {
    request: HttpRequest | null;
    response: HttpResponse | null;
    grpcResult: GrpcResult | null;
    pre: unknown;
    post: unknown;
    postMs: number | null;
    oauth: OAuthEnsured | null;
    dynamic: DynamicValue[];
  };
}

export function requestRun(
  requestId: string,
  node: RequestNode,
  plan: RunPlan,
  vars: { environment: Record<string, string>; globals: Record<string, string> },
  settings: RequestSettings,
  grpc: { prefs: GrpcPrefs; connectTimeoutMs?: number; deadlineMs?: number },
  onEvent: (event: RunEvent) => void,
  connectionId?: string,
): Promise<RequestExecution> {
  const channel = new Channel<RunEvent>();
  channel.onmessage = onEvent;
  return invoke('request_run', {
    requestId,
    node,
    plan,
    vars,
    settings,
    grpc,
    onEvent: channel,
    connectionId: connectionId ?? null,
  });
}

export const scenariosLoad = (root: string) => invoke<Scenario[]>('scenarios_load', { root });
export const scenariosSave = (root: string, scenario: Scenario) => invoke<void>('scenarios_save', { root, scenario });
export const scenariosDelete = (root: string, name: string) => invoke<void>('scenarios_delete', { root, name });
/** The workspace's «ask on send» definitions (`.bonk/inputs.json`). */
export const inputsLoad = (root: string) => invoke<Record<string, InputDef>>('inputs_load', { root });
/** Replace the whole set; an empty one removes the file. */
export const inputsSave = (root: string, inputs: Record<string, InputDef>) =>
  invoke<void>('inputs_save', { root, inputs });

/** Client/bidi: send more messages (an object or an array) into the open stream `requestId`. */
export const grpcStreamSend = (requestId: string, jsonBody: string) =>
  invoke<number>('grpc_stream_send', { requestId, jsonBody });
/** Client/bidi: half-close the stream — the server sees end-of-stream, replies keep coming. */
export const grpcStreamEnd = (requestId: string) => invoke<void>('grpc_stream_end', { requestId });
export const grpcLoadProto = (connectionId: string, protoPaths: string[], importPaths: string[]) =>
  invoke<ServiceTree>('grpc_load_proto', { connectionId, protoPaths, importPaths });
export const protoPick = () => invoke<string[] | null>('proto_pick');
export const protoPickFolder = () => invoke<string | null>('proto_pick_folder');

export interface ProtoFileError {
  kind: 'missing_import' | 'compile';
  message: string;
  import?: string | null;
}
export interface ProtoMethodInfo {
  name: string;
  kind: 'unary' | 'server_stream' | 'client_stream' | 'bidi';
}
export interface ProtoServiceInfo {
  name: string;
  methods: ProtoMethodInfo[];
}
export interface ProtoFileInfo {
  path: string;
  name: string;
  ok: boolean;
  error?: ProtoFileError | null;
  services: ProtoServiceInfo[];
  wellKnownDeps: string[];
}
export interface ProtoInspection {
  files: ProtoFileInfo[];
  importPaths: string[];
}
/** Compile each file/folder individually; folders become import roots. */
export const grpcProtoInspect = (paths: string[], importPaths: string[]) =>
  invoke<ProtoInspection>('grpc_proto_inspect', { paths, importPaths });
export const protoRead = (path: string) => invoke<string>('proto_read', { path });

export const workspacePickFolder = () => invoke<string | null>('workspace_pick_folder');
export const filePick = () => invoke<string | null>('file_pick');
/** macOS: right edge (px) of the window's traffic lights; null elsewhere or in full screen. */
export const trafficLightsRight = () => invoke<number | null>('traffic_lights_right');
export const workspaceLoad = (path: string) => invoke<TreeNode[]>('workspace_load', { path });
/** Children of folder `dir` ('' = root); subfolders listed in `keep` come back without their children. */
export const workspaceLoadChildren = (root: string, dir: string, keep: string[]) =>
  invoke<TreeNode[]>('workspace_load_children', { root, dir, keep });
export const workspaceCreateFolder = (root: string, parent: string, name: string) =>
  invoke<string>('workspace_create_folder', { root, parent, name });
export const workspaceSaveFolderSource = (root: string, dir: string, source: ImportSource | null) =>
  invoke<void>('workspace_save_folder_source', { root, dir, source });
export const workspaceSaveFolderAuth = (root: string, dir: string, auth: AuthConfig | null) =>
  invoke<void>('workspace_save_folder_auth', { root, dir, auth });
export const workspaceSaveRequest = (root: string, dir: string, existing: string | null, node: RequestNode) =>
  invoke<string>('workspace_save_request', { root, dir, existing, node });
export const workspaceDelete = (root: string, path: string) => invoke<void>('workspace_delete', { root, path });
export const workspaceRename = (root: string, path: string, name: string) =>
  invoke<string>('workspace_rename', { root, path, name });
export const workspaceDuplicate = (root: string, path: string) => invoke<string>('workspace_duplicate', { root, path });
export const workspaceMove = (root: string, path: string, dest: string) =>
  invoke<string>('workspace_move', { root, path, dest });
export const workspaceReorder = (root: string, dir: string, names: string[]) =>
  invoke<void>('workspace_reorder', { root, dir, names });

// ---------- OpenAPI / Swagger import & export ----------
/** Prompt for a spec file (JSON/YAML) and return its base name + text, or null if cancelled. */
/** A file to import: base name, absolute path, size in bytes, text. */
export interface ImportFile {
  name: string;
  path: string;
  size: number;
  text: string;
}
export const openapiImportPick = () => invoke<ImportFile | null>('openapi_import_pick');
/** Read a dropped file or a recent source for import. */
export const importReadFile = (path: string) => invoke<ImportFile>('import_read_file', { path });
/** Prompt for a save location, write `contents` there, and return the path (or null if cancelled). */
export const openapiExportSave = (defaultName: string, contents: string, title?: string) =>
  invoke<string | null>('openapi_export_save', { defaultName, contents, title: title ?? null });

// ---------- User themes (~/.bonk/themes) ----------
export interface ThemeFile {
  slug: string;
  text: string;
}
export const themesList = () => invoke<ThemeFile[]>('themes_list');
/** Write `<slug>.json`, return its path. */
export const themeSave = (slug: string, text: string) => invoke<string>('theme_save', { slug, text });
/** Delete `<slug>.json` (already gone is fine). */
export const themeDelete = (slug: string) => invoke<void>('theme_delete', { slug });
/** Prompt for a Zed / VS Code theme file, or null if cancelled. */
export const themeImportPick = () => invoke<ImportFile | null>('theme_import_pick');

// ---------- Data & workspace settings ----------
export const appDataDir = () => invoke<string>('app_data_dir');

// Cookie jar of workspace root `workspace` ('' = the app-wide jar).
export const cookiesList = (workspace: string) => invoke<CookieInfo[]>('cookies_list', { workspace });
export const cookiesJarPath = (workspace: string) => invoke<string>('cookies_jar_path', { workspace });
/** Add or replace (same name, domain, path) a cookie, as if `url` had sent `setCookie`. */
export const cookiesAdd = (workspace: string, url: string, setCookie: string) =>
  invoke<void>('cookies_add', { workspace, url, setCookie });
export const cookiesRemove = (workspace: string, domain: string, path: string, name: string) =>
  invoke<boolean>('cookies_remove', { workspace, domain, path, name });
/** «Хранить между запусками» changed: re-save the jar with or without its session cookies. */
export const cookiesKeepSession = (workspace: string, keep: boolean) =>
  invoke<void>('cookies_keep_session', { workspace, keep });
/** Remove every cookie of `domain`, or the whole jar when null. */
export const cookiesClear = (workspace: string, domain: string | null) =>
  invoke<void>('cookies_clear', { workspace, domain });
export const revealPath = (path: string) => invoke<void>('reveal_path', { path });
export const openReleases = () => invoke<void>('open_releases');
export const workspaceRenameRoot = (root: string, name: string) =>
  invoke<string>('workspace_rename_root', { root, name });
export const workspaceTrash = (root: string) => invoke<void>('workspace_trash', { root });

// ---------- Git source control (all take the workspace path as `root`) ----------
export const gitStatus = (root: string) => invoke<GitStatus>('git_status', { root });
export const gitStage = (root: string, paths: string[]) => invoke<void>('git_stage', { root, paths });
export const gitUnstage = (root: string, paths: string[]) => invoke<void>('git_unstage', { root, paths });
export const gitCommit = (root: string, message: string, amend = false) =>
  invoke<string>('git_commit', { root, message, amend });
export const gitInit = (root: string) => invoke<void>('git_init', { root });
export const gitBranches = (root: string) => invoke<string[]>('git_branches', { root });
export const gitCheckout = (root: string, name: string) => invoke<void>('git_checkout', { root, name });
export const gitCreateBranch = (root: string, name: string) => invoke<void>('git_create_branch', { root, name });
/** `force` = `--force-with-lease`, for a branch rewritten after it was pushed. */
export const gitPush = (root: string, force = false) => invoke<string>('git_push', { root, force });
export type PullMode = 'auto' | 'merge' | 'rebase' | 'ff-only';
export const gitPull = (root: string, mode: PullMode = 'auto') => invoke<string>('git_pull', { root, mode });
export const gitDiff = (root: string, path: string, cached = false) =>
  invoke<string>('git_diff', { root, path, cached });
export const gitLog = (root: string, limit: number) => invoke<GitCommit[]>('git_log', { root, limit });
export const gitGraph = (root: string, limit: number) => invoke<string[]>('git_graph', { root, limit });
export const gitStatusDiffs = (root: string) => invoke<FileDiff[]>('git_status_diffs', { root });
/** Returns a snapshot of what was thrown away ('' if none could be taken), for gitRestoreSnapshot. */
export const gitDiscard = (root: string, paths: string[]) => invoke<string>('git_discard', { root, paths });
export const gitRemoteList = (root: string) => invoke<GitRemote[]>('git_remote_list', { root });
export const gitRemoteAdd = (root: string, name: string, url: string) =>
  invoke<void>('git_remote_add', { root, name, url });
export const gitRemoteRemove = (root: string, name: string) => invoke<void>('git_remote_remove', { root, name });
/** Clone into a new folder under `parent`; returns its path. */
export const gitClone = (url: string, parent: string) => invoke<string>('git_clone', { url, parent });
export const gitReflog = (root: string, limit: number) => invoke<ReflogEntry[]>('git_reflog', { root, limit });
/** Hashes of commits that touched a file whose path contains `query`, or one of `paths`. */
export const gitCommitsTouching = (root: string, query: string, paths: string[], all: boolean) =>
  invoke<string[]>('git_commits_touching', { root, query, paths, all });
/** `cached`: to the index (stage; with `reverse` unstage). Else to the files (with `reverse`: discard). */
export const gitApplyPatch = (root: string, patch: string, cached: boolean, reverse: boolean) =>
  invoke<void>('git_apply_patch', { root, patch, cached, reverse });
export const gitRestoreSnapshot = (root: string, snapshot: string, paths: string[]) =>
  invoke<void>('git_restore_snapshot', { root, snapshot, paths });
/** The full HEAD hash, '' on an unborn branch. */
export const gitHead = (root: string) => invoke<string>('git_head', { root });
/** Undo a commit / reset: HEAD from `expected` back to `to`, refused if HEAD moved meanwhile. */
export const gitMoveHead = (root: string, expected: string, to: string, mode: 'soft' | 'mixed' | 'keep') =>
  invoke<void>('git_move_head', { root, expected, to, mode });
/** What `target` (a commit or branch) has that `base` hasn't, file by file. */
export const gitCompare = (root: string, base: string, target: string) =>
  invoke<CommitFile[]>('git_compare', { root, base, target });
export const gitCompareFileDiff = (root: string, base: string, target: string, path: string) =>
  invoke<string>('git_compare_file_diff', { root, base, target, path });
export const gitBranchList = (root: string) => invoke<GitBranch[]>('git_branch_list', { root });
export const gitCheckoutRemote = (root: string, name: string) => invoke<void>('git_checkout_remote', { root, name });
export const gitStashList = (root: string) => invoke<GitStash[]>('git_stash_list', { root });
export const gitStashPush = (
  root: string,
  message: string,
  o: { includeUntracked: boolean; stagedOnly: boolean; keepIndex: boolean },
  /** Only these files (toplevel-relative); none = everything. */
  paths: string[] = [],
) => invoke<void>('git_stash_push', { root, message, ...o, paths });
export const gitStashApply = (root: string, index: number) => invoke<void>('git_stash_apply', { root, index });
export const gitStashPop = (root: string, index: number) => invoke<void>('git_stash_pop', { root, index });
export const gitStashDrop = (root: string, index: number) => invoke<void>('git_stash_drop', { root, index });
export const gitStashBranch = (root: string, name: string, index: number) =>
  invoke<void>('git_stash_branch', { root, name, index });
export const gitStashShow = (root: string, index: number) => invoke<StashFile[]>('git_stash_show', { root, index });
export const gitGraphLog = (root: string, all: boolean, skip: number, limit: number) =>
  invoke<GraphPage>('git_graph_log', { root, all, skip, limit });
export const gitCommitDetail = (root: string, hash: string) =>
  invoke<CommitDetail>('git_commit_detail', { root, hash });
export const gitCommitFileDiff = (root: string, hash: string, path: string) =>
  invoke<string>('git_commit_file_diff', { root, hash, path });
export const gitCherryPick = (root: string, hashes: string[]) => invoke<void>('git_cherry_pick', { root, hashes });
export const gitRevert = (root: string, hashes: string[]) => invoke<void>('git_revert', { root, hashes });
export const gitMerge = (root: string, branch: string) => invoke<void>('git_merge', { root, branch });
export const gitRebase = (root: string, onto: string) => invoke<void>('git_rebase', { root, onto });
export const gitCheckoutDetached = (root: string, hash: string) =>
  invoke<void>('git_checkout_detached', { root, hash });
export const gitReset = (root: string, hash: string, mode: ResetMode) =>
  invoke<void>('git_reset', { root, hash, mode });
export const gitCreateTag = (root: string, name: string, hash: string) =>
  invoke<void>('git_create_tag', { root, name, hash });
/** `checkout`: also switch to it; without, only the branch appears. */
export const gitCreateBranchAt = (root: string, name: string, hash: string, checkout = true) =>
  invoke<void>('git_create_branch_at', { root, name, hash, checkout });
export const gitFormatPatch = (root: string, hashes: string[]) => invoke<string>('git_format_patch', { root, hashes });
export const gitFetch = (root: string) => invoke<string>('git_fetch', { root });
export const gitOperationAbort = (root: string) => invoke<void>('git_operation_abort', { root });
export const gitOperationContinue = (root: string) => invoke<void>('git_operation_continue', { root });
export const gitConflicts = (root: string) => invoke<ConflictFile[]>('git_conflicts', { root });
export const gitOperationInfo = (root: string) => invoke<OperationInfo>('git_operation_info', { root });
export const gitResolveFile = (root: string, path: string, content: string) =>
  invoke<void>('git_resolve_file', { root, path, content });
export const gitResolveSide = (root: string, paths: string[], side: 'mine' | 'theirs') =>
  invoke<void>('git_resolve_side', { root, paths, side });
export const gitUnresolve = (root: string, paths: string[]) => invoke<void>('git_unresolve', { root, paths });
export const gitOperationSkip = (root: string) => invoke<void>('git_operation_skip', { root });
export const gitRebasePlan = (root: string, onto: string) => invoke<RebasePlan>('git_rebase_plan', { root, onto });
export const gitRebaseInteractive = (root: string, onto: string, steps: RebaseAction[]) =>
  invoke<void>('git_rebase_interactive', { root, onto, steps });
/** Put the branch back where it was before the last rebase (`before` = GitStatus.undoRebase). */
export const gitRebaseUndo = (root: string, before: string) => invoke<void>('git_rebase_undo', { root, before });
/** `force` deletes a branch whose commits aren't merged anywhere. Returns the tip it pointed at. */
export const gitDeleteBranch = (root: string, name: string, force: boolean) =>
  invoke<string>('git_delete_branch', { root, name, force });
/** `name` is `origin/x`. */
export const gitDeleteRemoteBranch = (root: string, name: string) =>
  invoke<string>('git_delete_remote_branch', { root, name });
export const gitRenameBranch = (root: string, old: string, name: string) =>
  invoke<void>('git_rename_branch', { root, old, new: name });
/** `remote`: also on the push remote. */
export const gitDeleteTag = (root: string, name: string, remote: boolean) =>
  invoke<void>('git_delete_tag', { root, name, remote });
export const gitPushTag = (root: string, name: string) => invoke<string>('git_push_tag', { root, name });
/** The commits that changed `path` (toplevel-relative), newest first, renames followed. */
export const gitFileLog = (root: string, path: string, skip: number, limit: number) =>
  invoke<FileCommit[]>('git_file_log', { root, path, skip, limit });
export const gitBlame = (root: string, path: string) => invoke<BlameLine[]>('git_blame', { root, path });

// OS keychain (secret env vars)
export const secretGet = (key: string) => invoke<string | null>('secret_get', { key });
export const secretSet = (key: string, value: string) => invoke<void>('secret_set', { key, value });
export const secretDelete = (key: string) => invoke<void>('secret_delete', { key });

// OAuth 2.0: tokens live in the keychain, keyed by the auth's settings resolved with `scope`.
type Scope = Record<string, string>;
export const oauthStatus = (auth: AuthConfig, scope: Scope) =>
  invoke<OAuthTokenInfo | null>('oauth_status', { auth, scope });
export const oauthToken = (auth: AuthConfig, scope: Scope, settings: RequestSettings | undefined, force: boolean) =>
  invoke<OAuthEnsured>('oauth_token', { auth, scope, settings: settings ?? null, force });
export const oauthForget = (auth: AuthConfig, scope: Scope) => invoke<void>('oauth_forget', { auth, scope });
export const oauthRevoke = (auth: AuthConfig, scope: Scope, settings?: RequestSettings) =>
  invoke<void>('oauth_revoke', { auth, scope, settings: settings ?? null });
export const oauthLoginStart = (auth: AuthConfig, scope: Scope) =>
  invoke<OAuthLoginStarted>('oauth_login_start', { auth, scope });
export const oauthLoginWait = (flowId: string, settings?: RequestSettings) =>
  invoke<OAuthTokenInfo>('oauth_login_wait', { flowId, settings: settings ?? null });
/** A pasted code or redirect URL; `null` cancels the login. */
export const oauthLoginInput = (flowId: string, input: string | null) =>
  invoke<void>('oauth_login_input', { flowId, input });
export const openUrl = (url: string) => invoke<void>('open_url', { url });

export const workspaceImportCollection = (
  root: string,
  collection: { name: string; children: TreeNode[]; auth?: AuthConfig; source?: ImportSource },
) => invoke<string>('workspace_import_collection', { root, collection });
