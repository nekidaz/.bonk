import { get } from 'svelte/store';
import { t } from '$shared/i18n';
import {
  paramsFromUrl,
  syncUrlWithParams,
  type AuthConfig,
  type BodyParam,
  type HttpRequest,
  type Param,
  type RequestNode,
  type TreeNode,
  type VarRow,
} from '$shared/model';

type RecordValue = Record<string, unknown>;

export interface ImportedPostmanFolder {
  kind: 'folder';
  name: string;
  items: ImportedPostmanItem[];
}

export interface ImportedPostmanRequest {
  kind: 'request';
  node: RequestNode;
}

export type ImportedPostmanItem = ImportedPostmanFolder | ImportedPostmanRequest;

export interface ParsedPostmanCollection {
  title: string;
  items: ImportedPostmanItem[];
  variables: VarRow[];
}

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function rows(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.flatMap((item) => (object(item) ? [item as RecordValue] : [])) : [];
}

function script(events: unknown, listen: 'prerequest' | 'test'): string {
  return rows(events)
    .filter((event) => event.listen === listen)
    .map((event) => {
      const exec = object(event.script)?.exec;
      return Array.isArray(exec) ? exec.map(str).join('\n') : str(exec);
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Join inherited collection → folder → request scripts. Postman runs each in
 * its own scope, so when there is more than one, each part gets an IIFE: no
 * `const` clashes, and an early `return` ends only its own part.
 */
function joinScripts(parts: string[]): string {
  const present = parts.filter(Boolean);
  return present.length > 1 ? present.map((code) => `(function () {\n${code}\n})();`).join('\n') : (present[0] ?? '');
}

function auth(value: unknown): AuthConfig | undefined {
  const source = object(value);
  if (!source) return undefined;
  const type = str(source.type).toLowerCase();
  const field = (name: string, key: string): string =>
    str(rows(source[name]).find((entry) => entry.key === key)?.value);
  if (type === 'noauth') return { type: 'none' };
  if (type === 'bearer') return { type: 'bearer', bearerToken: field('bearer', 'token') };
  if (type === 'basic') {
    return {
      type: 'basic',
      basicUsername: field('basic', 'username'),
      basicPassword: field('basic', 'password'),
    };
  }
  if (type === 'apikey') {
    return {
      type: 'apiKey',
      apiKeyName: field('apikey', 'key'),
      apiKeyValue: field('apikey', 'value'),
      apiKeyIn: field('apikey', 'in') === 'query' ? 'query' : 'header',
    };
  }
  return undefined;
}

function urlAndParams(value: unknown): { url: string; params: Param[] } {
  if (typeof value === 'string') return { url: value, params: paramsFromUrl(value) };
  const source = object(value);
  if (!source) return { url: '', params: [] };
  let raw = str(source.raw);
  if (!raw) {
    const protocol = str(source.protocol) || 'https';
    const host = Array.isArray(source.host) ? source.host.map(str).join('.') : str(source.host);
    const path = Array.isArray(source.path) ? source.path.map(str).join('/') : str(source.path);
    raw = host ? `${protocol}://${host}${path ? '/' + path : ''}` : '';
  }
  if (!Array.isArray(source.query)) return { url: raw, params: paramsFromUrl(raw) };
  const params: Param[] = rows(source.query).map((entry) => ({
    key: str(entry.key),
    value: str(entry.value),
    description: str(entry.description),
    enabled: entry.disabled !== true,
  }));
  return { url: syncUrlWithParams(raw, params), params };
}

function applyBody(request: HttpRequest, value: unknown): void {
  const body = object(value);
  if (!body) return;
  const mode = str(body.mode);
  if (mode === 'raw') {
    request.bodyMode = 'raw';
    request.body = str(body.raw);
    const rawOptions = object(object(body.options)?.raw);
    const language = str(rawOptions?.language).toLowerCase();
    request.rawBodyFormat =
      language === 'json'
        ? 'JSON'
        : language === 'html'
          ? 'HTML'
          : language === 'xml'
            ? 'XML'
            : language === 'javascript'
              ? 'JavaScript'
              : 'Text';
  } else if (mode === 'urlencoded' || mode === 'formdata') {
    request.bodyMode = mode === 'formdata' ? 'form-data' : 'urlencoded';
    const key = mode === 'formdata' ? 'formdata' : 'urlencoded';
    const bodyParams: BodyParam[] = rows(body[key]).map((entry) => ({
      key: str(entry.key),
      value: str(entry.value),
      description: str(entry.description),
      enabled: entry.disabled !== true,
      // File paths from an imported collection are never trusted: a crafted
      // `src` could point at any local file and upload it on send. Re-pick it.
      kind: entry.type === 'file' ? 'file' : 'text',
    }));
    request.bodyParams = bodyParams;
  } else if (mode === 'graphql') {
    request.bodyMode = 'graphql';
    const graphql = object(body.graphql);
    request.body = str(graphql?.query);
    request.graphqlVariables = str(graphql?.variables);
  } else if (mode === 'file') {
    // The file itself is not imported (see form-data above): the user re-picks it.
    request.bodyMode = 'binary';
  }
}

function parseRequest(
  item: RecordValue,
  inheritedAuth: AuthConfig | undefined,
  pre: string[],
  post: string[],
): ImportedPostmanRequest | null {
  const source = object(item.request);
  if (!source) return null;
  const method = (str(source.method) || 'GET').toUpperCase();
  const { url, params } = urlAndParams(source.url);
  const headers: Record<string, string> = {};
  for (const header of rows(source.header)) {
    if (header.disabled === true || !str(header.key).trim()) continue;
    headers[str(header.key)] = str(header.value);
  }
  const request: HttpRequest = { method, url, headers };
  const appliedAuth = source.auth === undefined ? inheritedAuth : auth(source.auth);
  if (appliedAuth) request.auth = appliedAuth;
  applyBody(request, source.body);
  const preRequestScript = joinScripts([...pre, script(item.event, 'prerequest')]);
  const testScript = joinScripts([...post, script(item.event, 'test')]);
  if (preRequestScript) request.preRequestScript = preRequestScript;
  if (testScript) request.testScript = testScript;
  return {
    kind: 'request',
    node: {
      kind: 'request',
      id: '',
      name: str(item.name) || `${method} ${url}`,
      protocol: 'http',
      request,
      ...(params.length > 0 ? { params } : {}),
    },
  };
}

function parseItems(
  items: unknown,
  inheritedAuth: AuthConfig | undefined,
  pre: string[],
  post: string[],
): ImportedPostmanItem[] {
  const result: ImportedPostmanItem[] = [];
  for (const item of rows(items)) {
    const nextAuth = item.auth === undefined ? inheritedAuth : auth(item.auth);
    const nextPre = [...pre, script(item.event, 'prerequest')];
    const nextPost = [...post, script(item.event, 'test')];
    if (Array.isArray(item.item)) {
      result.push({
        kind: 'folder',
        name: str(item.name) || 'Folder',
        items: parseItems(item.item, nextAuth, nextPre, nextPost),
      });
    } else {
      const request = parseRequest(item, nextAuth, pre, post);
      if (request) result.push(request);
    }
  }
  return result;
}

/** Parse a Postman Collection v2.x JSON export into Bonk's local request tree. */
export function parsePostmanCollection(text: string): ParsedPostmanCollection {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(get(t)('import.err.postmanJson'));
  }
  const document = object(value);
  const info = object(document?.info);
  if (!document || !info || !Array.isArray(document.item)) {
    throw new Error(get(t)('import.err.postmanShape'));
  }
  const title = str(info.name).trim() || 'Imported Postman Collection';
  return {
    title,
    items: parseItems(
      document.item,
      auth(document.auth),
      [script(document.event, 'prerequest')],
      [script(document.event, 'test')],
    ),
    variables: rows(document.variable)
      .filter((entry) => str(entry.key).trim())
      .map((entry) => ({ key: str(entry.key), value: str(entry.value), enabled: entry.disabled !== true })),
  };
}

/** Cheap format check for the shared Import dialog; the parser validates details. */
export function isPostmanCollection(text: string): boolean {
  try {
    const doc = object(JSON.parse(text));
    return !!(object(doc?.info) && Array.isArray(doc?.item));
  } catch {
    return false;
  }
}

// ---------- Export: Postman Collection v2.1 ----------

type Json = Record<string, unknown>;

const scriptBody = (code: string) => ({ type: 'text/javascript', exec: code.split('\n') });

function events(pre?: string, test?: string): Json[] {
  return [
    ['prerequest', pre],
    ['test', test],
  ].flatMap(([listen, code]) => (code ? [{ listen, script: scriptBody(code) }] : []));
}

function exportAuth(a: AuthConfig | undefined): Json | undefined {
  const kv = (pairs: [string, string | undefined][]) =>
    pairs.map(([key, value]) => ({ key, value: value ?? '', type: 'string' }));
  switch (a?.type) {
    case 'none':
      return { type: 'noauth' };
    case 'bearer':
      return { type: 'bearer', bearer: kv([['token', a.bearerToken]]) };
    case 'basic':
      return {
        type: 'basic',
        basic: kv([
          ['username', a.basicUsername],
          ['password', a.basicPassword],
        ]),
      };
    case 'apiKey':
      return {
        type: 'apikey',
        apikey: kv([
          ['key', a.apiKeyName],
          ['value', a.apiKeyValue],
          ['in', a.apiKeyIn ?? 'header'],
        ]),
      };
    default:
      return undefined; // inherit / absent: let Postman inherit
  }
}

function exportBody(r: HttpRequest): Json | undefined {
  const params = () =>
    (r.bodyParams ?? []).map((p) => ({
      key: p.key,
      value: p.kind === 'file' ? '' : p.value,
      type: p.kind === 'file' ? 'file' : 'text',
      ...(p.description ? { description: p.description } : {}),
      ...(p.enabled ? {} : { disabled: true }),
    }));
  switch (r.bodyMode) {
    case 'raw': {
      const language = { JSON: 'json', HTML: 'html', XML: 'xml', JavaScript: 'javascript', Text: 'text' }[
        r.rawBodyFormat ?? 'Text'
      ];
      return { mode: 'raw', raw: r.body ?? '', options: { raw: { language } } };
    }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: params() };
    case 'form-data':
      return { mode: 'formdata', formdata: params() };
    case 'graphql':
      return { mode: 'graphql', graphql: { query: r.body ?? '', variables: r.graphqlVariables ?? '' } };
    case 'binary':
      return { mode: 'file' };
    default:
      return undefined;
  }
}

function exportRequest(n: RequestNode): Json {
  const r = n.request;
  const off = new Set(r.disabledHeaders ?? []);
  const keys = [...new Set([...Object.keys(r.headers), ...off])];
  const header = keys.map((key) => ({
    key,
    value: r.headers[key] ?? '',
    ...(r.headerNotes?.[key] ? { description: r.headerNotes[key] } : {}),
    ...(off.has(key) ? { disabled: true } : {}),
  }));
  const query = (n.params ?? []).map((p) => ({
    key: p.key,
    value: p.value,
    ...(p.description ? { description: p.description } : {}),
    ...(p.enabled ? {} : { disabled: true }),
  }));
  const auth = exportAuth(r.auth);
  const body = exportBody(r);
  const event = events(r.preRequestScript, r.testScript);
  return {
    name: n.name,
    request: {
      method: r.method,
      header,
      url: query.length ? { raw: r.url, query } : { raw: r.url },
      ...(body ? { body } : {}),
      ...(auth ? { auth } : {}),
    },
    ...(event.length ? { event } : {}),
  };
}

function exportItems(nodes: TreeNode[]): Json[] {
  return nodes.flatMap((n): Json[] => {
    if (n.kind === 'request') return n.protocol === 'http' ? [exportRequest(n)] : []; // Postman v2.1 has no gRPC
    const auth = exportAuth(n.auth);
    return [{ name: n.name, ...(auth ? { auth } : {}), item: exportItems(n.children) }];
  });
}

/** Postman Collection v2.1 JSON of the HTTP requests in the tree (gRPC is skipped); globals become collection variables. */
export function buildPostmanCollection(
  name: string,
  collections: TreeNode[],
  globals: VarRow[],
  includeSecrets: boolean,
): string {
  return JSON.stringify(
    {
      info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: exportItems(collections),
      variable: globals.map((v) => ({
        key: v.key,
        value: v.secret && !includeSecrets ? '' : v.value,
        ...(v.enabled ? {} : { disabled: true }),
      })),
    },
    null,
    2,
  );
}
