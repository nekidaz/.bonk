import type { GrpcTabState } from './types';

/**
 * Workspace-relative ⇄ absolute path helpers for persisting gRPC `.proto`
 * references. Stored paths are relative to the workspace root when they live
 * inside it (so the workspace stays diffable and portable), absolute otherwise.
 * In memory they are always absolute (the compiler needs real paths).
 */

/** True for POSIX (`/…`), Windows drive (`C:\…`), or UNC (`\\…`) absolute paths. */
function isAbsolute(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
}

export function toWorkspaceRel(path: string, root: string): string {
  if (!root) return path;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function toAbs(path: string, root: string): string {
  if (!root || isAbsolute(path)) return path;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return `${prefix}${path}`;
}

function mapPaths(
  grpc: GrpcTabState | undefined,
  fn: (p: string) => string,
): GrpcTabState | undefined {
  if (!grpc || grpc.source !== 'proto') return grpc;
  return {
    ...grpc,
    protoPaths: grpc.protoPaths?.map(fn),
    importPaths: grpc.importPaths?.map(fn),
  };
}

/** Convert a tab's proto/import paths to workspace-relative form (for disk). */
export function grpcPathsToRel(grpc: GrpcTabState | undefined, root: string): GrpcTabState | undefined {
  return mapPaths(grpc, (p) => toWorkspaceRel(p, root));
}

/** Convert a tab's stored proto/import paths back to absolute (for the compiler). */
export function grpcPathsToAbs(grpc: GrpcTabState | undefined, root: string): GrpcTabState | undefined {
  return mapPaths(grpc, (p) => toAbs(p, root));
}
