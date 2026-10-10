import type { RequestNode, TreeNode } from '$shared/model';
import { openapiExportSave } from '$shared/ipc';
import { findNode } from './tree';
import { buildOpenApi, serializeSpec, type ExportFolder } from './openapi';
import { workspace } from './store.svelte';
import { environments } from '$entities/environment';

/**
 * OpenAPI export orchestration: the pure build logic lives in `openapi.ts`; this
 * wires it to the workspace, environments and the native Save dialog. Import
 * lives in features/import (the import window).
 */

/** Collect http RequestNodes under `folderId`, tagged by their immediate parent folder name. Counts skipped grpc nodes. */
function collectHttpRequests(
  node: TreeNode,
  tag: string | null,
): { folders: Map<string | null, RequestNode[]>; grpcSkipped: number } {
  const folders = new Map<string | null, RequestNode[]>();
  let grpcSkipped = 0;
  const push = (t: string | null, r: RequestNode): void => {
    const list = folders.get(t);
    if (list) list.push(r);
    else folders.set(t, [r]);
  };
  const walk = (n: TreeNode, currentTag: string | null): void => {
    if (n.kind === 'request') {
      if (n.protocol === 'http') push(currentTag, n);
      else grpcSkipped++;
      return;
    }
    for (const child of n.children) walk(child, n.name);
  };
  // The top folder's own name is not a tag (it becomes the collection title);
  // its direct request children are ungrouped, nested folders become tags.
  if (node.kind === 'folder') {
    for (const child of node.children) walk(child, tag);
  } else if (node.protocol === 'http') {
    push(tag, node);
  } else {
    grpcSkipped++;
  }
  return { folders, grpcSkipped };
}

/**
 * Export the folder `folderId` as an OpenAPI 3.0 spec (JSON or YAML) via a native
 * Save dialog. grpc requests are skipped. When requests use `{{baseUrl}}` and an
 * environment defines it, that value seeds the spec's server URL; otherwise a
 * common URL prefix is derived by the builder.
 */
export async function exportOpenApiFolder(folderId: string, format: 'json' | 'yaml'): Promise<void> {
  const node = findNode(workspace.tree, folderId);
  if (!node || node.kind !== 'folder') return;

  const { folders, grpcSkipped } = collectHttpRequests(node, null);
  if (grpcSkipped > 0) {
    console.warn(`openapi: skipped ${grpcSkipped} gRPC request(s) — OpenAPI export is HTTP-only`);
  }

  const exportFolders: ExportFolder[] = [...folders.entries()].map(([tag, requests]) => ({ tag, requests }));
  const usesBaseUrl = exportFolders.some((f) => f.requests.some((r) => r.request.url.includes('{{baseUrl}}')));

  // Prefer the active environment's baseUrl, else any environment that defines one.
  let baseUrl: string | undefined;
  if (usesBaseUrl) {
    const envs = environments.list;
    const activeId = environments.activeId;
    const active = activeId ? envs.find((e) => e.id === activeId) : undefined;
    const findBaseUrl = (env: (typeof envs)[number] | undefined): string | undefined =>
      env?.vars.find((v) => v.enabled && v.key === 'baseUrl')?.value;
    baseUrl = findBaseUrl(active) ?? envs.map(findBaseUrl).find((v) => v != null);
  }

  const doc = buildOpenApi(node.name, exportFolders, baseUrl ? { baseUrl } : {});
  const text = serializeSpec(doc, format);

  try {
    await openapiExportSave(`${node.name}.${format === 'yaml' ? 'yaml' : 'json'}`, text);
  } catch (err) {
    console.error('openapi: export save failed', err);
    throw err;
  }
}
