import { get } from 'svelte/store';
import { t } from '../i18n';
/**
 * Pure OpenAPI / Swagger import + export. This module is a leaf: it imports only
 * `types` and the `yaml` codec, never stores/api/tauri, so it stays fully
 * unit-testable and the import graph stays acyclic. Store orchestration
 * (picking files, creating folders/environments, native save) lives in
 * `stores/openapi.ts`.
 *
 * Import parses an OpenAPI 3.0/3.1 or Swagger 2.0 document (JSON or YAML) into a
 * set of folders of `RequestNode`s plus a base URL. Export walks saved requests
 * back into a minimal OpenAPI 3.0.3 document. Round-tripping a bonk-authored
 * spec preserves path + method; it is intentionally lossy on everything the
 * client doesn't model (schemas, responses, examples beyond a single one).
 */
import type { AuthConfig, BodyParam, Param, RequestNode, RawBodyFormat } from './types';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ---------- Import ----------

/** A tag-grouped set of imported requests. `name === null` = ungrouped (no tag). */
export interface ImportedFolder {
  name: string | null;
  requests: RequestNode[];
}

/** The result of parsing a spec: the collection title, its base URL, and folders. */
export interface ParsedSpec {
  title: string;
  baseUrl: string;
  folders: ImportedFolder[];
}

/** Loosely-typed spec document; we probe fields defensively rather than model the whole schema. */
type Doc = Record<string, unknown>;
type Obj = Record<string, unknown>;

/** The HTTP methods we import, in a stable order. */
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `text` as JSON, falling back to YAML; throws if neither yields an object. */
function parseDocument(text: string): Doc {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = parseYaml(text);
    } catch {
      throw new Error(get(t)('import.err.notDoc'));
    }
  }
  if (!isObject(doc)) throw new Error(get(t)('import.err.notObject'));
  return doc;
}

/** 'oas3' for OpenAPI 3.x, 'swagger2' for Swagger 2.0; throws on anything else. */
function detectVersion(doc: Doc): 'oas3' | 'swagger2' {
  if (typeof doc.openapi === 'string' && doc.openapi.startsWith('3.')) return 'oas3';
  if (doc.swagger === '2.0') return 'swagger2';
  throw new Error(get(t)('import.err.unsupported'));
}

/** Substitute `{var}` templating in an OAS3 server URL using its `variables` defaults. */
function resolveServerUrl(server: Obj): string {
  const url = typeof server.url === 'string' ? server.url : '';
  const variables = isObject(server.variables) ? server.variables : {};
  return url.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const v = variables[name];
    if (isObject(v) && v.default != null) return String(v.default);
    return match;
  });
}

/** Compute the base URL for either spec flavor (empty string when undeterminable). */
function specBaseUrl(doc: Doc, version: 'oas3' | 'swagger2'): string {
  if (version === 'oas3') {
    const servers = Array.isArray(doc.servers) ? doc.servers : [];
    const first = servers[0];
    return isObject(first) ? resolveServerUrl(first) : '';
  }
  const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
  const scheme = typeof schemes[0] === 'string' ? schemes[0] : 'https';
  const host = typeof doc.host === 'string' ? doc.host : '';
  if (!host) return '';
  const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
  return `${scheme}://${host}${basePath}`;
}

/** Resolve a local `$ref` pointer (`#/a/b/c`) against `doc`; returns null if unresolvable. */
function resolveRef(ref: string, doc: Doc): Obj | null {
  if (!ref.startsWith('#/')) return null;
  let cur: unknown = doc;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(cur)) return null;
    cur = cur[part];
  }
  return isObject(cur) ? cur : null;
}

/** Follow a `$ref` on an object one level (parameters/schemas); returns the object unchanged if it has none. */
function deref(node: Obj, doc: Doc): Obj {
  if (typeof node.$ref === 'string') {
    const target = resolveRef(node.$ref, doc);
    if (target) return target;
  }
  return node;
}

/**
 * Build a representative example value for `schema`, resolving `$ref`s with a
 * cycle guard (`seen` of ref strings) and a depth cap. Priority: explicit
 * `example` → `default` → first `enum` → shape by `type`. `allOf` merges object
 * results; `oneOf`/`anyOf` take the first. A missing `type` with `properties`
 * is treated as an object.
 */
export function exampleFromSchema(schema: unknown, doc: Doc, seen: Set<string> = new Set(), depth = 0): unknown {
  if (depth > 6 || !isObject(schema)) return null;

  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return null; // cycle
    const target = resolveRef(schema.$ref, doc);
    if (!target) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(schema.$ref);
    return exampleFromSchema(target, doc, nextSeen, depth + 1);
  }

  if ('example' in schema && schema.example !== undefined) return schema.example;
  if ('default' in schema && schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    const merged: Obj = {};
    for (const part of schema.allOf) {
      const partExample = exampleFromSchema(part, doc, seen, depth + 1);
      if (isObject(partExample)) Object.assign(merged, partExample);
    }
    return merged;
  }
  const combo = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(combo) && combo.length > 0) {
    return exampleFromSchema(combo[0], doc, seen, depth + 1);
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'object' || (type === undefined && isObject(schema.properties))) {
    const out: Obj = {};
    const props = isObject(schema.properties) ? schema.properties : {};
    for (const [key, propSchema] of Object.entries(props)) {
      out[key] = exampleFromSchema(propSchema, doc, seen, depth + 1);
    }
    return out;
  }
  if (type === 'array') {
    const item = exampleFromSchema(schema.items, doc, seen, depth + 1);
    return item === null ? [] : [item];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') return '';
  return null;
}

/** A single resolved parameter object (already `$ref`-followed). */
type ParamObj = Obj;

/**
 * Merge path-item-level and operation-level parameter lists, resolving `$ref`s,
 * with operation params winning on a `name`+`in` collision (later wins).
 */
function mergeParameters(pathParams: unknown, opParams: unknown, doc: Doc): ParamObj[] {
  const byKey = new Map<string, ParamObj>();
  const add = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!isObject(raw)) continue;
      const p = deref(raw, doc);
      const name = typeof p.name === 'string' ? p.name : '';
      const location = typeof p.in === 'string' ? p.in : '';
      byKey.set(`${location}:${name}`, p);
    }
  };
  add(pathParams);
  add(opParams);
  return [...byKey.values()];
}

/** Best-effort string form of a parameter's example/default (via its schema). */
function paramExampleString(p: ParamObj): string {
  if (p.example !== undefined && p.example !== null) return String(p.example);
  if (isObject(p.schema)) {
    const s = p.schema;
    if (s.example !== undefined && s.example !== null) return String(s.example);
    if (s.default !== undefined && s.default !== null) return String(s.default);
  }
  // Swagger2 keeps type/default directly on the parameter.
  if (p.default !== undefined && p.default !== null) return String(p.default);
  return '';
}

/** Turn `{param}` path templates into `{{param}}` for bonk's URL bar. */
function templatePath(path: string): string {
  return path.replace(/\{([^{}]+)\}/g, '{{$1}}');
}

/** Look up a security scheme by name across both spec flavors. */
function findSecurityScheme(doc: Doc, name: string): Obj | null {
  const oas3 =
    isObject(doc.components) && isObject(doc.components.securitySchemes) ? doc.components.securitySchemes : undefined;
  if (oas3 && isObject(oas3[name])) return oas3[name] as Obj;
  const sw2 = isObject(doc.securityDefinitions) ? doc.securityDefinitions : undefined;
  if (sw2 && isObject(sw2[name])) return sw2[name] as Obj;
  return null;
}

/** Map the first resolvable security requirement to a bonk AuthConfig, or undefined. */
function resolveAuth(operation: Obj, doc: Doc): AuthConfig | undefined {
  const security = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(doc.security)
      ? doc.security
      : undefined;
  if (!security) return undefined;
  for (const requirement of security) {
    if (!isObject(requirement)) continue;
    for (const schemeName of Object.keys(requirement)) {
      const scheme = findSecurityScheme(doc, schemeName);
      if (!scheme) continue;
      const type = typeof scheme.type === 'string' ? scheme.type : '';
      const flavor = typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : '';
      if (type === 'http' && flavor === 'basic') return { type: 'basic' };
      if (type === 'http' || type === 'oauth2') return { type: 'bearer', bearerToken: '' };
      if (type === 'basic') return { type: 'basic' }; // Swagger2
      if (type === 'apiKey') {
        return {
          type: 'apiKey',
          apiKeyName: typeof scheme.name === 'string' ? scheme.name : '',
          apiKeyIn: scheme.in === 'query' ? 'query' : 'header',
          apiKeyValue: '',
        };
      }
    }
  }
  return undefined;
}

/** Build the OAS3 requestBody (JSON preferred) into request fields; mutates `req`/`headers`. */
function applyOas3Body(
  requestBody: unknown,
  doc: Doc,
  headers: Record<string, string>,
): { body?: string; bodyMode?: 'raw'; rawBodyFormat?: RawBodyFormat } {
  if (!isObject(requestBody) || !isObject(requestBody.content)) return {};
  const content = requestBody.content;
  const json = content['application/json'];
  if (isObject(json)) {
    const example = exampleFromSchema(json.schema, doc);
    headers['Content-Type'] = 'application/json';
    return {
      body: JSON.stringify(example ?? {}, null, 2),
      bodyMode: 'raw',
      rawBodyFormat: 'JSON',
    };
  }
  const firstType = Object.keys(content)[0];
  if (firstType && isObject(content[firstType])) {
    const example = exampleFromSchema((content[firstType] as Obj).schema, doc);
    headers['Content-Type'] = firstType;
    return {
      body: typeof example === 'string' ? example : example == null ? '' : JSON.stringify(example, null, 2),
      bodyMode: 'raw',
      rawBodyFormat: 'Text',
    };
  }
  return {};
}

/** Parse a full spec document into folders of RequestNodes + a base URL. */
export function parseOpenApi(text: string, fileName: string): ParsedSpec {
  const doc = parseDocument(text);
  const version = detectVersion(doc);

  const info = isObject(doc.info) ? doc.info : {};
  const title =
    (typeof info.title === 'string' && info.title.trim()) || fileName.replace(/\.(json|ya?ml)$/i, '') || 'Imported API';
  const baseUrl = specBaseUrl(doc, version);

  // Folders keyed by tag; a null key holds ungrouped requests. Insertion order is
  // preserved so the output tree is stable.
  const folders = new Map<string | null, ImportedFolder>();
  const folderFor = (tag: string | null): ImportedFolder => {
    let f = folders.get(tag);
    if (!f) {
      f = { name: tag, requests: [] };
      folders.set(tag, f);
    }
    return f;
  };

  const paths = isObject(doc.paths) ? doc.paths : {};
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (!isObject(pathItemRaw)) continue;
    const pathItem = pathItemRaw;
    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method];
      if (!isObject(opRaw)) continue;
      const operation = opRaw;

      const upper = method.toUpperCase();
      const name =
        (typeof operation.summary === 'string' && operation.summary) ||
        (typeof operation.operationId === 'string' && operation.operationId) ||
        `${upper} ${path}`;

      const headers: Record<string, string> = {};
      const params: Param[] = [];
      const parameters = mergeParameters(pathItem.parameters, operation.parameters, doc);

      // Swagger2 carries the body + form fields inside `parameters`; collect them.
      const bodyParams: BodyParam[] = [];
      let swaggerBodySchema: unknown;

      for (const p of parameters) {
        const location = typeof p.in === 'string' ? p.in : '';
        const pName = typeof p.name === 'string' ? p.name : '';
        if (!pName && location !== 'body') continue;
        if (location === 'query') {
          params.push({
            key: pName,
            value: paramExampleString(p),
            description: typeof p.description === 'string' ? p.description : '',
            enabled: true,
          });
        } else if (location === 'header') {
          headers[pName] = paramExampleString(p);
        } else if (location === 'body') {
          swaggerBodySchema = p.schema;
        } else if (location === 'formData') {
          bodyParams.push({
            key: pName,
            value: '',
            description: typeof p.description === 'string' ? p.description : '',
            enabled: true,
            kind: 'text',
          });
        }
        // in:path is already emitted as {{param}} in the URL below.
      }

      // Body: OAS3 requestBody, or Swagger2 body/formData parameters.
      let body: string | undefined;
      let bodyMode: RequestNode['request']['bodyMode'];
      let rawBodyFormat: RawBodyFormat | undefined;
      let outBodyParams: BodyParam[] | undefined;

      if (version === 'oas3') {
        const applied = applyOas3Body(operation.requestBody, doc, headers);
        body = applied.body;
        bodyMode = applied.bodyMode;
        rawBodyFormat = applied.rawBodyFormat;
      } else if (swaggerBodySchema !== undefined) {
        const example = exampleFromSchema(swaggerBodySchema, doc);
        const consumes = Array.isArray(operation.consumes) ? operation.consumes : [];
        const contentType = typeof consumes[0] === 'string' ? consumes[0] : 'application/json';
        headers['Content-Type'] = contentType;
        body = JSON.stringify(example ?? {}, null, 2);
        bodyMode = 'raw';
        rawBodyFormat = 'JSON';
      } else if (bodyParams.length > 0) {
        bodyMode = 'urlencoded';
        outBodyParams = bodyParams;
      }

      const auth = resolveAuth(operation, doc);
      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : null;

      const node: RequestNode = {
        kind: 'request',
        id: '',
        name,
        protocol: 'http',
        request: {
          method: upper,
          url: '{{baseUrl}}' + templatePath(path),
          headers,
          ...(body !== undefined ? { body } : {}),
          ...(bodyMode ? { bodyMode } : {}),
          ...(rawBodyFormat ? { rawBodyFormat } : {}),
          ...(outBodyParams ? { bodyParams: outBodyParams } : {}),
          ...(auth ? { auth } : {}),
        },
        ...(params.length > 0 ? { params } : {}),
      };
      folderFor(tag).requests.push(node);
    }
  }

  return { title, baseUrl, folders: [...folders.values()] };
}

// ---------- Export ----------

/** A tag-grouped set of requests to export (http only; caller filters grpc). */
export interface ExportFolder {
  tag: string | null;
  requests: RequestNode[];
}

export interface BuildOptions {
  /** When set, used as the single server URL and stripped as a `{{baseUrl}}` prefix. */
  baseUrl?: string;
}

/** Slugify a request name into an operationId (`Get user` → `getUser`). */
function slugify(name: string): string {
  const parts = name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'operation';
  return parts
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/** Longest common URL prefix across `urls`, trimmed at the last `/` so it's a clean base. */
function commonPrefix(urls: string[]): string {
  if (urls.length === 0) return '';
  let prefix = urls[0];
  for (const u of urls.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < u.length && prefix[i] === u[i]) i++;
    prefix = prefix.slice(0, i);
  }
  // Don't cut mid-segment: back up to the last '/' (but keep a scheme's "://").
  const lastSlash = prefix.lastIndexOf('/');
  if (lastSlash > prefix.indexOf('://') + 2) prefix = prefix.slice(0, lastSlash);
  return prefix.replace(/\/$/, '');
}

/** Strip `base` off the front of `url`; convert `{{var}}` → `{var}`; ensure a leading '/'. */
function toSpecPath(url: string, base: string): string {
  let path = url;
  if (base && path.startsWith(base)) path = path.slice(base.length);
  path = path.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, '{$1}');
  // Drop any query string; OpenAPI carries query as parameters, not in the path.
  const q = path.indexOf('?');
  if (q !== -1) path = path.slice(0, q);
  if (!path.startsWith('/')) path = '/' + path;
  return path === '/' ? '/' : path.replace(/\/$/, '') || '/';
}

/** All `{var}` names in a spec path, in order. */
function pathVarNames(path: string): string[] {
  return [...path.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}

type SecuritySchemeName = 'bearerAuth' | 'basicAuth' | 'apiKeyAuth';

/** The securityScheme definition + requirement key for an AuthConfig, or null. */
function authToScheme(auth: AuthConfig): { name: SecuritySchemeName; scheme: Obj } | null {
  if (auth.type === 'bearer') return { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer' } };
  if (auth.type === 'basic') return { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } };
  if (auth.type === 'apiKey') {
    return {
      name: 'apiKeyAuth',
      scheme: {
        type: 'apiKey',
        in: auth.apiKeyIn === 'query' ? 'query' : 'header',
        name: auth.apiKeyName || 'X-API-Key',
      },
    };
  }
  return null;
}

/**
 * Build a minimal OpenAPI 3.0.3 document from tag-grouped requests. `opts.baseUrl`
 * (when provided by the caller, e.g. the env's `baseUrl`) becomes the single
 * server and is stripped from each path; otherwise a common URL prefix is derived.
 */
export function buildOpenApi(collectionName: string, folders: ExportFolder[], opts: BuildOptions = {}): object {
  const all = folders.flatMap((f) => f.requests.map((r) => ({ tag: f.tag, node: r })));

  // Determine the server URL + the prefix to strip from each request URL.
  let serverUrl = opts.baseUrl ?? '';
  let stripPrefix = '';
  if (opts.baseUrl) {
    stripPrefix = '{{baseUrl}}';
  } else {
    serverUrl = commonPrefix(all.map((r) => r.node.request.url));
    stripPrefix = serverUrl;
  }

  const paths: Record<string, Record<string, unknown>> = {};
  const usedSchemes = new Map<SecuritySchemeName, Obj>();

  for (const { tag, node } of all) {
    const req = node.request;
    const specPath = toSpecPath(req.url, stripPrefix);
    const method = req.method.toLowerCase();

    const parameters: Obj[] = [];
    for (const varName of pathVarNames(specPath)) {
      parameters.push({ name: varName, in: 'path', required: true, schema: { type: 'string' } });
    }
    for (const p of node.params ?? []) {
      if (!p.enabled || !p.key) continue;
      parameters.push({
        name: p.key,
        in: 'query',
        schema: { type: 'string' },
        ...(p.value ? { example: p.value } : {}),
        ...(p.description ? { description: p.description } : {}),
      });
    }
    for (const [key, value] of Object.entries(req.headers ?? {})) {
      if (key.toLowerCase() === 'content-type') continue;
      parameters.push({
        name: key,
        in: 'header',
        schema: { type: 'string' },
        ...(value ? { example: value } : {}),
      });
    }

    // Request body.
    let requestBody: Obj | undefined;
    if (req.bodyMode === 'raw' && req.body != null && req.body !== '') {
      const contentType = req.headers?.['Content-Type'] ?? req.headers?.['content-type'] ?? 'application/json';
      let example: unknown = req.body;
      try {
        example = JSON.parse(req.body);
      } catch {
        example = req.body;
      }
      requestBody = { content: { [contentType]: { example } } };
    } else if (req.bodyMode === 'urlencoded' || req.bodyMode === 'form-data') {
      const properties: Record<string, Obj> = {};
      for (const bp of req.bodyParams ?? []) {
        if (bp.key) properties[bp.key] = { type: 'string' };
      }
      const mime = req.bodyMode === 'urlencoded' ? 'application/x-www-form-urlencoded' : 'multipart/form-data';
      requestBody = { content: { [mime]: { schema: { type: 'object', properties } } } };
    }

    // Auth → security requirement + shared scheme.
    let security: Obj[] | undefined;
    if (req.auth && req.auth.type !== 'none') {
      const mapped = authToScheme(req.auth);
      if (mapped) {
        usedSchemes.set(mapped.name, mapped.scheme);
        security = [{ [mapped.name]: [] }];
      }
    }

    const operation: Obj = {
      summary: node.name,
      ...(tag ? { tags: [tag] } : {}),
      operationId: slugify(node.name),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      ...(security ? { security } : {}),
      responses: { '200': { description: 'OK' } },
    };

    (paths[specPath] ??= {})[method] = operation;
  }

  const doc: Obj = {
    openapi: '3.0.3',
    info: { title: collectionName, version: '1.0.0' },
    ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
    paths,
  };
  if (usedSchemes.size > 0) {
    doc.components = { securitySchemes: Object.fromEntries(usedSchemes) };
  }
  return doc;
}

/** Serialize a spec document to a JSON or YAML string. */
export function serializeSpec(doc: object, format: 'json' | 'yaml'): string {
  return format === 'yaml' ? stringifyYaml(doc) : JSON.stringify(doc, null, 2);
}
