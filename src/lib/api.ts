import { invoke } from '@tauri-apps/api/core';
import type { HttpRequest, HttpResponse, RequestSettings, ServiceTree, GrpcResult } from './domain/types';
import type { TreeNode, RequestNode, GitStatus, GitCommit, FileDiff } from './domain/types';

export const cancelRequest = (requestId: string): Promise<void> =>
  invoke<void>('cancel_request', { requestId });

export const httpSend = (
  req: HttpRequest,
  requestId?: string,
  settings?: RequestSettings,
): Promise<HttpResponse> =>
  invoke<HttpResponse>('http_send', { req, requestId: requestId ?? null, settings: settings ?? null });

export const grpcConnect = (endpoint: string, plaintext: boolean, timeoutMs?: number) =>
  invoke<string>('grpc_connect', { endpoint, plaintext, timeoutMs: timeoutMs ?? null });
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
export const grpcLoadProto = (connectionId: string, protoPaths: string[], importPaths: string[]) =>
  invoke<ServiceTree>('grpc_load_proto', { connectionId, protoPaths, importPaths });
export const protoPick = () => invoke<string[] | null>('proto_pick');

export const workspacePickFolder = () =>
  invoke<string | null>('workspace_pick_folder');
export const filePick = () =>
  invoke<string | null>('file_pick');
export const workspaceLoad = (path: string) =>
  invoke<TreeNode[]>('workspace_load', { path });
export const workspaceCreateFolder = (root: string, parent: string, name: string) =>
  invoke<string>('workspace_create_folder', { root, parent, name });
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
