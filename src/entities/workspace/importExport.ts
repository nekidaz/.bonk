import { get } from 'svelte/store';
import type { RequestNode, TreeNode } from '$shared/model';
import { openapiImportPick, openapiExportSave, workspaceCreateFolder, workspaceSaveRequest } from '$shared/ipc';
import { idToRel, findNode } from './tree';
import { parseOpenApi, buildOpenApi, serializeSpec, type ExportFolder } from './openapi';
import { isCurlText, isHar, isInsomniaExport, parseCurlFile, parseHar, parseInsomniaExport } from './importers';
import {
  isPostmanCollection,
  parsePostmanCollection,
  type ImportedPostmanItem,
  type ParsedPostmanCollection,
} from './postman';
import { collections, workspacePath, ROOT, openWorkspaceFolder, reloadWorkspace } from './store';
import { environments, activeEnvironmentId, addEnvironment, setEnvVars } from '$entities/environment';

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

async function runImportOp(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`workspace: ${name} failed`, error);
    throw error;
  }
}

/**
 * Save a parsed spec into the workspace: a collection folder named after the
 * spec title, a subfolder per tag, one saved request per operation, and a
 * `{{baseUrl}}` environment. Runs as a single workspace op + reload.
 */
async function saveSpecToWorkspace(root: string, spec: ReturnType<typeof parseOpenApi>): Promise<void> {
  await runImportOp('importOpenApi', async () => {
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

async function savePostmanToWorkspace(root: string, collection: ParsedPostmanCollection): Promise<void> {
  await runImportOp('importPostmanCollection', async () => {
    const collectionId = await workspaceCreateFolder(root, ROOT, collection.title);
    const saveItems = async (parentId: string, items: ImportedPostmanItem[]): Promise<void> => {
      for (const item of items) {
        if (item.kind === 'folder') {
          const id = await workspaceCreateFolder(root, idToRel(parentId), item.name);
          await saveItems(id, item.items);
        } else {
          await workspaceSaveRequest(root, idToRel(parentId), null, item.node);
        }
      }
    };
    await saveItems(collectionId, collection.items);
    if (collection.variables.length > 0) {
      const previous = get(activeEnvironmentId);
      const id = addEnvironment(collection.title);
      setEnvVars(id, collection.variables);
      if (previous) activeEnvironmentId.set(previous);
    }
    await reloadWorkspace();
  });
}

/** Import either a Postman Collection v2.x JSON export or an OpenAPI/Swagger spec. */
export async function importApiText(text: string, name = 'pasted'): Promise<void> {
  const parsed = isCurlText(text)
    ? { kind: 'postman' as const, collection: parseCurlFile(text) }
    : isPostmanCollection(text)
      ? { kind: 'postman' as const, collection: parsePostmanCollection(text) }
      : isInsomniaExport(text)
        ? { kind: 'postman' as const, collection: parseInsomniaExport(text) }
        : isHar(text)
          ? { kind: 'postman' as const, collection: parseHar(text) }
          : { kind: 'openapi' as const, spec: parseOpenApi(text, name) };
  const root = await ensureWorkspaceRoot();
  if (!root) return;
  if (parsed.kind === 'postman') await savePostmanToWorkspace(root, parsed.collection);
  else await saveSpecToWorkspace(root, parsed.spec);
}

export async function importApiFile(): Promise<void> {
  const file = await openapiImportPick();
  if (!file) return;
  await importApiText(file.text, file.name);
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
