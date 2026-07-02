import { get } from 'svelte/store';
import type { RequestNode, TreeNode } from '../domain/types';
import { openapiImportPick, openapiExportSave, workspaceCreateFolder, workspaceSaveRequest } from '../api';
import { idToRel, findNode } from '../domain/tree';
import {
  parseOpenApi,
  buildOpenApi,
  serializeSpec,
  type ExportFolder,
} from '../domain/openapi';
import {
  collections,
  workspacePath,
  environments,
  activeEnvironmentId,
  ROOT,
} from './state';
import { addEnvironment, setEnvVars } from './environments';
import { openWorkspaceFolder, reloadWorkspace, runWorkspaceOp } from './workspace';

/**
 * OpenAPI / Swagger import + export orchestration. The pure parse/build logic
 * lives in `domain/openapi`; this module wires it to the workspace, environments,
 * and the native file dialogs (via `api`). Errors surface with `console.error`
 * and a rethrow, matching how other workspace mutations report failure.
 */

/** Ensure a workspace is open (prompting if none); returns its root or null. */
async function ensureWorkspaceRoot(): Promise<string | null> {
  let root = get(workspacePath);
  if (!root) {
    await openWorkspaceFolder();
    root = get(workspacePath);
  }
  return root || null;
}

/**
 * Save a parsed spec into the workspace: a collection folder named after the
 * spec title, a subfolder per tag, one saved request per operation, and a
 * `{{baseUrl}}` environment. Runs as a single workspace op + reload.
 */
async function saveSpecToWorkspace(
  root: string,
  spec: ReturnType<typeof parseOpenApi>,
): Promise<void> {
  await runWorkspaceOp('importOpenApi', async () => {
    const collectionId = await workspaceCreateFolder(root, ROOT, spec.title);
    for (const folder of spec.folders) {
      if (folder.name) {
        const tagId = await workspaceCreateFolder(root, idToRel(collectionId), folder.name);
        for (const node of folder.requests) {
          await workspaceSaveRequest(root, idToRel(tagId), null, node);
        }
      } else {
        for (const node of folder.requests) {
          await workspaceSaveRequest(root, idToRel(collectionId), null, node);
        }
      }
    }
    if (spec.baseUrl) {
      // addEnvironment activates the new env as a side effect. An import must
      // not silently steal the user's active environment (their {{vars}} would
      // stop resolving), so restore the previous selection when one existed;
      // with none active, the imported env becomes active as a sensible default.
      const prevActive = get(activeEnvironmentId);
      const envId = addEnvironment(spec.title);
      setEnvVars(envId, [{ key: 'baseUrl', value: spec.baseUrl, enabled: true }]);
      if (prevActive) activeEnvironmentId.set(prevActive);
    }
    await reloadWorkspace();
  });
}

/**
 * Import a spec from raw text (paste / clipboard). Parses `text` as OpenAPI or
 * Swagger (JSON or YAML) and saves it into a new collection folder + a
 * `{{baseUrl}}` environment. The parse error is thrown so the import dialog can
 * show it inline; a cancelled workspace prompt is a no-op.
 */
export async function importOpenApiText(text: string, name = 'pasted'): Promise<void> {
  const root = await ensureWorkspaceRoot();
  if (!root) return;
  const spec = parseOpenApi(text, name);
  await saveSpecToWorkspace(root, spec);
}

/**
 * Import a spec from a file the user picks via a native dialog. Prompts for a
 * workspace first if none is open; a cancelled picker is a no-op.
 */
export async function importOpenApiFile(): Promise<void> {
  const root = await ensureWorkspaceRoot();
  if (!root) return;
  const file = await openapiImportPick();
  if (!file) return; // user cancelled the file dialog
  let spec;
  try {
    spec = parseOpenApi(file.text, file.name);
  } catch (err) {
    console.error('openapi: import parse failed', err);
    throw err;
  }
  await saveSpecToWorkspace(root, spec);
}

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
  const node = findNode(get(collections), folderId);
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
    const envs = get(environments);
    const activeId = get(activeEnvironmentId);
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
