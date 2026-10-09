import { Channel, invoke } from '@tauri-apps/api/core';
import type { HttpRequest, HttpResponse, RequestSettings, ServiceTree, GrpcResult, GrpcStreamMessage, GrpcTls, GrpcCertInfo, GrpcPrefs } from './domain/types';
import type { AuthConfig, TreeNode, RequestNode, GitStatus, GitCommit, FileDiff } from './domain/types';
import { parseScriptResult, type ScriptPhase, type ScriptResult } from './domain/scripts';

export interface TerminalOutput {
  stdout: string;
  stderr: string;
  status: number;
  elapsedMs: number;
  cwd: string;
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

export const terminalDefaultCwd = (): Promise<string> =>
  invoke<string>('terminal_default_cwd');

/** `runId` lets `cancelRequest(runId)` interrupt the command (⌃C). */
export const terminalRun = (cwd: string | null, command: string, runId?: string): Promise<TerminalOutput> =>
  invoke<TerminalOutput>('terminal_run', { cwd, command, runId: runId ?? null });

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

export const cancelRequest = (requestId: string): Promise<void> =>
  invoke<void>('cancel_request', { requestId });

/**
 * Run a user script in the sandboxed QuickJS engine. `context` is serialized to
 * JSON for the Rust side; the returned JSON string is parsed into a typed
 * `ScriptResult` here so callers never touch the wire format.
 */
export const runScript = async (
  phase: ScriptPhase,
  code: string,
  context: unknown,
): Promise<ScriptResult> => {
  const out = await invoke<string>('run_script', {
    phase,
    code,
    context: JSON.stringify(context),
  });
  return parseScriptResult(out);
};

export const httpSend = (
  req: HttpRequest,
  requestId?: string,
  settings?: RequestSettings,
): Promise<HttpResponse> =>
  invoke<HttpResponse>('http_send', { req, requestId: requestId ?? null, settings: settings ?? null });

export const grpcConnect = (endpoint: string, plaintext: boolean, tls?: GrpcTls, timeoutMs?: number, prefs?: GrpcPrefs) =>
  invoke<string>('grpc_connect', { endpoint, plaintext, tls: tls ?? null, prefs: prefs ?? null, timeoutMs: timeoutMs ?? null });
/** [subject CN, expiry unix seconds] of the first certificate in a PEM/CRT file. */
export const certFileInfo = (path: string) => invoke<[string, number]>('cert_file_info', { path });
export const grpcTlsInspect = (endpoint: string, tls?: GrpcTls) =>
  invoke<GrpcCertInfo>('grpc_tls_inspect', { endpoint, tls: tls ?? null });
export const grpcReflect = (connectionId: string, timeoutMs?: number) =>
  invoke<ServiceTree>('grpc_reflect', { connectionId, timeoutMs: timeoutMs ?? null });
export const grpcTemplate = (connectionId: string, method: string) =>
  invoke<string>('grpc_template', { connectionId, method });
export const grpcCall = (
  connectionId: string,
  method: string,
  jsonBody: string,
  metadata: Record<string, string>,
  requestId?: string,
  timeoutMs?: number,
) => invoke<GrpcResult>('grpc_call', { connectionId, method, jsonBody, metadata, requestId: requestId ?? null, timeoutMs: timeoutMs ?? null });
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
  return invoke<GrpcResult>('grpc_stream', { connectionId, method, jsonBody, metadata, requestId, onMessage: channel });
}
/** Client/bidi: send more messages (an object or an array) into the open stream `requestId`. */
export const grpcStreamSend = (requestId: string, jsonBody: string) => invoke<number>('grpc_stream_send', { requestId, jsonBody });
/** Client/bidi: half-close the stream — the server sees end-of-stream, replies keep coming. */
export const grpcStreamEnd = (requestId: string) => invoke<void>('grpc_stream_end', { requestId });
export const grpcLoadProto = (connectionId: string, protoPaths: string[], importPaths: string[]) =>
  invoke<ServiceTree>('grpc_load_proto', { connectionId, protoPaths, importPaths });
export const protoPick = () => invoke<string[] | null>('proto_pick');

export interface ProtoFileError { kind: 'missing_import' | 'compile'; message: string; import?: string | null }
export interface ProtoMethodInfo { name: string; kind: 'unary' | 'server_stream' | 'client_stream' | 'bidi' }
export interface ProtoServiceInfo { name: string; methods: ProtoMethodInfo[] }
export interface ProtoFileInfo {
  path: string;
  name: string;
  ok: boolean;
  error?: ProtoFileError | null;
  services: ProtoServiceInfo[];
  wellKnownDeps: string[];
}
export interface ProtoInspection { files: ProtoFileInfo[]; importPaths: string[] }
/** Compile each file/folder individually; folders become import roots. */
export const grpcProtoInspect = (paths: string[], importPaths: string[]) =>
  invoke<ProtoInspection>('grpc_proto_inspect', { paths, importPaths });
export const protoRead = (path: string) => invoke<string>('proto_read', { path });

export const workspacePickFolder = () =>
  invoke<string | null>('workspace_pick_folder');
export const filePick = () =>
  invoke<string | null>('file_pick');
export const workspaceLoad = (path: string) =>
  invoke<TreeNode[]>('workspace_load', { path });
export const workspaceCreateFolder = (root: string, parent: string, name: string) =>
  invoke<string>('workspace_create_folder', { root, parent, name });
export const workspaceSaveFolderAuth = (root: string, dir: string, auth: AuthConfig | null) =>
  invoke<void>('workspace_save_folder_auth', { root, dir, auth });
export const workspaceSaveRequest = (
  root: string,
  dir: string,
  existing: string | null,
  node: RequestNode,
) => invoke<string>('workspace_save_request', { root, dir, existing, node });
export const workspaceDelete = (root: string, path: string) =>
  invoke<void>('workspace_delete', { root, path });
export const workspaceRename = (root: string, path: string, name: string) =>
  invoke<string>('workspace_rename', { root, path, name });
export const workspaceDuplicate = (root: string, path: string) =>
  invoke<string>('workspace_duplicate', { root, path });
export const workspaceMove = (root: string, path: string, dest: string) =>
  invoke<string>('workspace_move', { root, path, dest });

// ---------- OpenAPI / Swagger import & export ----------
/** Prompt for a spec file (JSON/YAML) and return its base name + text, or null if cancelled. */
export const openapiImportPick = () =>
  invoke<{ name: string; text: string } | null>('openapi_import_pick');
/** Prompt for a save location, write `contents` there, and return the path (or null if cancelled). */
export const openapiExportSave = (defaultName: string, contents: string, title?: string) =>
  invoke<string | null>('openapi_export_save', { defaultName, contents, title: title ?? null });

// ---------- Data & workspace settings ----------
export const appDataDir = () => invoke<string>('app_data_dir');
export const revealPath = (path: string) => invoke<void>('reveal_path', { path });
export const workspaceRenameRoot = (root: string, name: string) =>
  invoke<string>('workspace_rename_root', { root, name });
export const workspaceTrash = (root: string) => invoke<void>('workspace_trash', { root });

// ---------- Git source control (all take the workspace path as `root`) ----------
export const gitStatus = (root: string) =>
  invoke<GitStatus>('git_status', { root });
export const gitStage = (root: string, paths: string[]) =>
  invoke<void>('git_stage', { root, paths });
export const gitUnstage = (root: string, paths: string[]) =>
  invoke<void>('git_unstage', { root, paths });
export const gitCommit = (root: string, message: string) =>
  invoke<string>('git_commit', { root, message });
export const gitInit = (root: string) =>
  invoke<void>('git_init', { root });
export const gitBranches = (root: string) =>
  invoke<string[]>('git_branches', { root });
export const gitCheckout = (root: string, name: string) =>
  invoke<void>('git_checkout', { root, name });
export const gitCreateBranch = (root: string, name: string) =>
  invoke<void>('git_create_branch', { root, name });
export const gitPush = (root: string) =>
  invoke<string>('git_push', { root });
export const gitPull = (root: string) =>
  invoke<string>('git_pull', { root });
export const gitDiff = (root: string, path: string, cached = false) =>
  invoke<string>('git_diff', { root, path, cached });
export const gitLog = (root: string, limit: number) =>
  invoke<GitCommit[]>('git_log', { root, limit });
export const gitGraph = (root: string, limit: number) =>
  invoke<string[]>('git_graph', { root, limit });
export const gitStatusDiffs = (root: string) =>
  invoke<FileDiff[]>('git_status_diffs', { root });
export const gitDiscard = (root: string, paths: string[]) =>
  invoke<void>('git_discard', { root, paths });

// OS keychain (secret env vars)
export const secretGet = (key: string) => invoke<string | null>('secret_get', { key });
export const secretSet = (key: string, value: string) => invoke<void>('secret_set', { key, value });
export const secretDelete = (key: string) => invoke<void>('secret_delete', { key });
