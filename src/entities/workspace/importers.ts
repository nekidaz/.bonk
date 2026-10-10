import { t } from '$shared/i18n';
import {
  paramsFromUrl,
  syncUrlWithParams,
  parseCurl,
  type AuthConfig,
  type HttpRequest,
  type Param,
  type RequestNode,
  type VarRow,
} from '$shared/model';
import type { ImportedPostmanItem, ParsedPostmanCollection } from './postman';

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function rows(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.flatMap((item) => (object(item) ? [item as RecordValue] : [])) : [];
}

function parseJson(text: string): RecordValue | null {
  try {
    return object(JSON.parse(text));
  } catch {
    return null;
  }
}

function makeNode(name: string, request: HttpRequest, params: Param[]): ImportedPostmanItem {
  return {
    kind: 'request',
    node: {
      kind: 'request',
      id: '',
      name,
      protocol: 'http',
      request,
      ...(params.length > 0 ? { params } : {}),
    } satisfies RequestNode,
  };
}

// ---------- Insomnia export v4 ----------

function isInsomniaExport(text: string): boolean {
  const doc = parseJson(text);
  return doc?._type === 'export' && doc.__export_format === 4 && Array.isArray(doc.resources);
}

/** `{{ _.name }}` -> `{{name}}` */
function insomniaTemplate(value: unknown): string {
  return str(value).replace(/\{\{\s*_\.([^}\s]+)\s*\}\}/g, '{{$1}}');
}

function insomniaAuth(value: unknown): AuthConfig | undefined {
  const source = object(value);
  if (!source || source.disabled === true) return undefined;
  const type = str(source.type).toLowerCase();
  if (type === 'bearer') return { type: 'bearer', bearerToken: insomniaTemplate(source.token) };
  if (type === 'basic') {
    return {
      type: 'basic',
      basicUsername: insomniaTemplate(source.username),
      basicPassword: insomniaTemplate(source.password),
    };
  }
  return undefined;
}

function insomniaRequest(res: RecordValue): ImportedPostmanItem {
  const method = (str(res.method) || 'GET').toUpperCase();
  const params: Param[] = rows(res.parameters).map((p) => ({
    key: insomniaTemplate(p.name),
    value: insomniaTemplate(p.value),
    description: '',
    enabled: p.disabled !== true,
  }));
  const url = syncUrlWithParams(insomniaTemplate(res.url), params);
  const headers: Record<string, string> = {};
  for (const h of rows(res.headers)) {
    if (h.disabled === true || !str(h.name).trim()) continue;
    headers[insomniaTemplate(h.name)] = insomniaTemplate(h.value);
  }
  const request: HttpRequest = { method, url, headers };
  const auth = insomniaAuth(res.authentication);
  if (auth) request.auth = auth;
  const body = object(res.body);
  if (body && typeof body.text === 'string' && body.text) {
    const mime = str(body.mimeType).toLowerCase();
    request.bodyMode = 'raw';
    request.body = insomniaTemplate(body.text);
    request.rawBodyFormat = mime.includes('json')
      ? 'JSON'
      : mime.includes('xml')
        ? 'XML'
        : mime.includes('html')
          ? 'HTML'
          : 'Text';
  }
  return makeNode(str(res.name) || `${method} ${url}`, request, params);
}

export function parseInsomniaExport(text: string): ParsedPostmanCollection {
  const doc = parseJson(text);
  if (!doc || !isInsomniaExport(text)) throw new Error(t('import.err.insomnia'));
  const resources = rows(doc.resources);
  const workspace = resources.find((r) => r._type === 'workspace');
  const workspaceId = str(workspace?._id);

  const children = new Map<string, RecordValue[]>();
  for (const r of resources) {
    if (r._type !== 'request' && r._type !== 'request_group') continue;
    const parent = str(r.parentId);
    children.set(parent, [...(children.get(parent) ?? []), r]);
  }
  const build = (parentId: string, seen: Set<string>): ImportedPostmanItem[] =>
    (children.get(parentId) ?? [])
      .sort((a, b) => Number(a.metaSortKey ?? 0) - Number(b.metaSortKey ?? 0))
      .flatMap((r): ImportedPostmanItem[] => {
        if (r._type === 'request') return [insomniaRequest(r)];
        const id = str(r._id);
        if (seen.has(id)) return [];
        return [{ kind: 'folder', name: str(r.name) || 'Folder', items: build(id, new Set(seen).add(id)) }];
      });

  // Base environment = the one parented directly by the workspace.
  const variables: VarRow[] = [];
  for (const env of resources.filter((r) => r._type === 'environment' && str(r.parentId) === workspaceId)) {
    for (const [key, value] of Object.entries(object(env.data) ?? {})) {
      const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : insomniaTemplate(value);
      variables.push({ key, value: text, enabled: true });
    }
  }

  return {
    title: str(workspace?.name).trim() || 'Imported Insomnia Workspace',
    items: build(workspaceId, new Set()),
    variables,
  };
}

// ---------- cURL (text file with one or more commands) ----------

export function parseCurlFile(text: string): ParsedPostmanCollection {
  // A command starts at a line beginning with `curl`; `\`-continued lines stay with it.
  const commands = text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^curl\s/i.test(l));
  if (commands.length === 0) throw new Error(t('import.err.noCurl'));
  const items = commands.map((c) => {
    const request = parseCurl(c);
    let path = request.url;
    try {
      path = new URL(request.url).pathname;
    } catch {
      path = request.url.split(/[?#]/)[0];
    }
    return makeNode(`${request.method} ${path}`, request, paramsFromUrl(request.url));
  });
  return { title: 'cURL import', items, variables: [] };
}
