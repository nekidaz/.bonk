import { t } from '$shared/i18n';
/**
 * Pure OpenAPI / Swagger import + export. This module is a leaf: it imports only
 * `types` and the `yaml` codec, never stores/ipc/tauri, so it stays fully
 * unit-testable and the import graph stays acyclic. The import window
 * (features/import) turns the parsed operations into a preview and saves them.
 *
 * Import parses an OpenAPI 3.0/3.1 or Swagger 2.0 document (JSON or YAML) into
 * operations (one `RequestNode` each), servers, the collection-wide security
 * scheme and non-fatal warnings. Export walks saved requests back into a minimal
 * OpenAPI 3.0.3 document. Round-tripping a bonk-authored spec preserves path +
 * method; it is intentionally lossy on everything the client doesn't model
 * (schemas, responses, examples beyond a single one).
 */
import {
  oauthGrant,
  oauthScopes,
  type AuthConfig,
  type BodyParam,
  type OAuthGrant,
  type Param,
  type RequestNode,
  type RawBodyFormat,
} from '$shared/model';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ---------- Import ----------

/** A tag-grouped set of imported requests. `name === null` = ungrouped (no tag). */
export interface ImportedFolder {
  name: string | null;
  requests: RequestNode[];
}

/** How operations become requests (the preview's switches, IM4). */
export interface OpenApiOptions {
  /** Request bodies from the schema's example/default; off = empty body. */
  bodies: boolean;
  /** `/payments/{id}` → `/payments/{{id}}`; off keeps `{id}`. */
  pathVars: boolean;
  /** Requests using the collection's scheme inherit it from the collection folder. */
  collectionAuth: boolean;
}

export const OPENAPI_DEFAULTS: OpenApiOptions = { bodies: true, pathVars: true, collectionAuth: true };

/** One operation = one request. `key` links it across re-imports: operationId, else `METHOD path`. */
export interface SpecOperation {
  key: string;
  method: string;
  path: string;
  tag: string | null;
  node: RequestNode;
  /** The body schema is a oneOf/anyOf with this many variants (the first one was used). */
  variants?: number;
  /** A `$ref` in the body schema doesn't resolve, so the example is incomplete. */
  missingRef?: boolean;
}

/** Non-fatal problems: the import goes on, the preview lists them (IM5). */
export type SpecWarning =
  | { kind: 'ref'; ref: string; ops: string[] }
  | { kind: 'variants'; schema: string; count: number; ops: string[] }
  | { kind: 'server'; variable: string; server: string; value: string };

export interface SpecServer {
  url: string;
  description: string;
}

/** The result of parsing a spec. */
export interface ParsedSpec {
  title: string;
  /** `info.version` of the API (e.g. `1.4.2`), '' when absent. */
  version: string;
  /** `OpenAPI 3.1` / `Swagger 2.0`. */
  format: string;
  /** First server; `{{baseUrl}}` resolves to it. */
  baseUrl: string;
  servers: SpecServer[];
  /** Operations grouped by first tag (kept for callers that don't regroup). */
  folders: ImportedFolder[];
  ops: SpecOperation[];
  /** The scheme most requests use; with `collectionAuth` it moves to the collection folder. */
  collectionAuth: { scheme: string; auth: AuthConfig } | null;
  tags: number;
  schemas: number;
  schemeNames: string[];
  warnings: SpecWarning[];
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
      throw new Error(t('import.err.notDoc'));
    }
  }
  if (!isObject(doc)) throw new Error(t('import.err.notObject'));
  return doc;
}

/** True for an OpenAPI 3.x or Swagger 2.0 document. */
export function isOpenApiDoc(doc: Doc): boolean {
  return (typeof doc.openapi === 'string' && doc.openapi.startsWith('3.')) || doc.swagger === '2.0';
}

/** 'oas3' for OpenAPI 3.x, 'swagger2' for Swagger 2.0; throws on anything else. */
function detectVersion(doc: Doc): 'oas3' | 'swagger2' {
  if (typeof doc.openapi === 'string' && doc.openapi.startsWith('3.')) return 'oas3';
  if (doc.swagger === '2.0') return 'swagger2';
  throw new Error(t('import.err.unsupported'));
}

/**
 * Substitute `{var}` templating in an OAS3 server URL using its `variables` defaults.
 * A variable with a real choice (enum) or no default is reported to `warn`.
 */
function resolveServerUrl(server: Obj, warn?: (w: SpecWarning) => void): string {
  const url = typeof server.url === 'string' ? server.url : '';
  const variables = isObject(server.variables) ? server.variables : {};
  const resolved = url.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const v = variables[name];
    return isObject(v) && v.default != null ? String(v.default) : match;
  });
  for (const [name, v] of Object.entries(variables)) {
    if (!url.includes(`{${name}}`) || !isObject(v)) continue;
    const choices = Array.isArray(v.enum) ? v.enum.length : 0;
    if (v.default == null || choices > 1)
      warn?.({ kind: 'server', variable: name, server: resolved, value: String(v.default ?? '') });
  }
  return resolved;
}

/** Servers of either spec flavor (Swagger 2: scheme+host+basePath). */
function specServers(doc: Doc, version: 'oas3' | 'swagger2', warn: (w: SpecWarning) => void): SpecServer[] {
  if (version === 'oas3') {
    const servers = Array.isArray(doc.servers) ? doc.servers : [];
    return servers.filter(isObject).map((s) => ({
      url: resolveServerUrl(s, warn),
      description: typeof s.description === 'string' ? s.description : '',
    }));
  }
  const host = typeof doc.host === 'string' ? doc.host : '';
  if (!host) return [];
  const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
  const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
  const scheme = typeof schemes[0] === 'string' ? schemes[0] : 'https';
  return [{ url: `${scheme}://${host}${basePath}`, description: '' }];
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

/** What building an example ran into: unresolved refs and oneOf/anyOf choices. */
export interface ExampleNotes {
  missing: Set<string>;
  variants: { schema: string; count: number }[];
}

/**
 * Build a representative example value for `schema`, resolving `$ref`s with a
 * cycle guard (`seen` of ref strings) and a depth cap. Priority: explicit
 * `example` → `default` → first `enum` → shape by `type`. `allOf` merges object
 * results; `oneOf`/`anyOf` take the first. A missing `type` with `properties`
 * is treated as an object. `notes` collects what had to be skipped or chosen.
 */
export function exampleFromSchema(
  schema: unknown,
  doc: Doc,
  seen: Set<string> = new Set(),
  depth = 0,
  notes?: ExampleNotes,
): unknown {
  if (depth > 6 || !isObject(schema)) return null;

  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return null; // cycle
    const target = resolveRef(schema.$ref, doc);
    if (!target) {
      notes?.missing.add(schema.$ref);
      return null;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(schema.$ref);
    return exampleFromSchema(target, doc, nextSeen, depth + 1, notes);
  }

  if ('example' in schema && schema.example !== undefined) return schema.example;
  if ('default' in schema && schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    const merged: Obj = {};
    for (const part of schema.allOf) {
      const partExample = exampleFromSchema(part, doc, seen, depth + 1, notes);
      if (isObject(partExample)) Object.assign(merged, partExample);
    }
    return merged;
  }
  const combo = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(combo) && combo.length > 0) {
    if (combo.length > 1 && notes) {
      // Name the choice after the schema holding it (the last ref we followed).
      const holder = [...seen].at(-1)?.split('/').at(-1) ?? (typeof schema.title === 'string' ? schema.title : 'body');
      notes.variants.push({ schema: holder, count: combo.length });
    }
    return exampleFromSchema(combo[0], doc, seen, depth + 1, notes);
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'object' || (type === undefined && isObject(schema.properties))) {
    const out: Obj = {};
    const props = isObject(schema.properties) ? schema.properties : {};
    for (const [key, propSchema] of Object.entries(props)) {
      out[key] = exampleFromSchema(propSchema, doc, seen, depth + 1, notes);
    }
    return out;
  }
  if (type === 'array') {
    const item = exampleFromSchema(schema.items, doc, seen, depth + 1, notes);
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

/** All security schemes of either spec flavor, by name. */
function securitySchemes(doc: Doc): Obj {
  if (isObject(doc.components) && isObject(doc.components.securitySchemes)) return doc.components.securitySchemes;
  return isObject(doc.securityDefinitions) ? doc.securityDefinitions : {};
}

/** A bonk AuthConfig for a security scheme; secrets are `{{vars}}`, never values. */
function schemeAuth(scheme: Obj): AuthConfig | undefined {
  const type = typeof scheme.type === 'string' ? scheme.type : '';
  const flavor = typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : '';
  if ((type === 'http' && flavor === 'basic') || type === 'basic') {
    return { type: 'basic', basicUsername: '{{username}}', basicPassword: '{{password}}' };
  }
  if (type === 'oauth2') return oauthSchemeAuth(scheme);
  if (type === 'http' || type === 'openIdConnect') return { type: 'bearer', bearerToken: '{{token}}' };
  if (type === 'apiKey') {
    return {
      type: 'apiKey',
      apiKeyName: typeof scheme.name === 'string' ? scheme.name : '',
      apiKeyIn: scheme.in === 'query' ? 'query' : 'header',
      apiKeyValue: '{{apiKey}}',
    };
  }
  return undefined;
}

/**
 * An `oauth2` scheme as OAuth on the collection: URLs and scopes from its flow (OpenAPI 3
 * `flows`, Swagger 2 `flow`), the client as `{{client_id}}` / `{{client_secret}}`. The
 * implicit flow has no token endpoint bonk could use: it stays a Bearer `{{token}}`.
 */
function oauthSchemeAuth(scheme: Obj): AuthConfig {
  const text = (o: Obj | undefined, key: string) => (o && typeof o[key] === 'string' ? (o[key] as string) : '');
  const flows = isObject(scheme.flows) ? scheme.flows : undefined;
  const v2: Record<string, OAuthGrant> = {
    accessCode: 'authorization_code',
    application: 'client_credentials',
    password: 'password',
  };
  const pick: [OAuthGrant, Obj | undefined][] = flows
    ? [
        ['authorization_code', isObject(flows.authorizationCode) ? flows.authorizationCode : undefined],
        ['client_credentials', isObject(flows.clientCredentials) ? flows.clientCredentials : undefined],
        ['password', isObject(flows.password) ? flows.password : undefined],
      ]
    : [[v2[text(scheme, 'flow')], v2[text(scheme, 'flow')] ? scheme : undefined]];
  const found = pick.find(([, flow]) => flow);
  if (!found) return { type: 'bearer', bearerToken: '{{token}}' };
  const [grant, flow] = found as [OAuthGrant, Obj];
  const scopes = isObject(flow.scopes) ? Object.keys(flow.scopes) : [];
  return {
    type: 'oauth2',
    oauth: {
      grant,
      ...(grant === 'authorization_code' ? { authUrl: text(flow, 'authorizationUrl') } : {}),
      tokenUrl: text(flow, 'tokenUrl'),
      clientId: '{{client_id}}',
      ...(grant === 'authorization_code' ? {} : { clientSecret: '{{client_secret}}' }),
      ...(grant === 'password' ? { username: '{{username}}', password: '{{password}}' } : {}),
      scope: scopes.join(' '),
    },
  };
}

/**
 * The scheme an operation uses: the first resolvable one of its (or the document's)
 * requirements. `null` = explicitly none (`security: []`), undefined = not specified.
 */
function operationScheme(operation: Obj, doc: Doc): { name: string; auth: AuthConfig } | null | undefined {
  const security = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(doc.security)
      ? doc.security
      : undefined;
  if (!security) return undefined;
  const schemes = securitySchemes(doc);
  for (const requirement of security) {
    if (!isObject(requirement)) continue;
    for (const name of Object.keys(requirement)) {
      const scheme = schemes[name];
      const auth = isObject(scheme) ? schemeAuth(scheme) : undefined;
      if (auth) return { name, auth };
    }
  }
  return security.length === 0 ? null : undefined;
}

/** Build the OAS3 requestBody (JSON preferred) into request fields; mutates `headers`. */
function applyOas3Body(
  requestBody: unknown,
  doc: Doc,
  headers: Record<string, string>,
  notes: ExampleNotes,
): { body?: string; bodyMode?: 'raw'; rawBodyFormat?: RawBodyFormat } {
  if (isObject(requestBody)) requestBody = deref(requestBody, doc);
  if (!isObject(requestBody) || !isObject(requestBody.content)) return {};
  const content = requestBody.content;
  const json = content['application/json'];
  if (isObject(json)) {
    const example =
      json.example !== undefined ? json.example : exampleFromSchema(json.schema, doc, new Set(), 0, notes);
    headers['Content-Type'] = 'application/json';
    return {
      body: JSON.stringify(example ?? {}, null, 2),
      bodyMode: 'raw',
      rawBodyFormat: 'JSON',
    };
  }
  const firstType = Object.keys(content)[0];
  if (firstType && isObject(content[firstType])) {
    const example = exampleFromSchema((content[firstType] as Obj).schema, doc, new Set(), 0, notes);
    headers['Content-Type'] = firstType;
    return {
      body: typeof example === 'string' ? example : example == null ? '' : JSON.stringify(example, null, 2),
      bodyMode: 'raw',
      rawBodyFormat: 'Text',
    };
  }
  return {};
}

/** Parse a full spec text (JSON or YAML) into operations, servers and warnings. */
export function parseOpenApi(text: string, fileName: string, opts: OpenApiOptions = OPENAPI_DEFAULTS): ParsedSpec {
  return readOpenApi(parseDocument(text), fileName, opts);
}

/** Read an already-parsed spec document into operations, servers and warnings. */
export function readOpenApi(doc: Doc, fileName: string, opts: OpenApiOptions = OPENAPI_DEFAULTS): ParsedSpec {
  const version = detectVersion(doc);
  const warnings: SpecWarning[] = [];

  const info = isObject(doc.info) ? doc.info : {};
  const title =
    (typeof info.title === 'string' && info.title.trim()) || fileName.replace(/\.(json|ya?ml)$/i, '') || 'Imported API';
  const servers = specServers(doc, version, (w) => warnings.push(w));
  const schemes = securitySchemes(doc);

  // The collection's scheme: the document-wide one, else the one most operations name.
  const ops: SpecOperation[] = [];
  const opSchemes: ({ name: string; auth: AuthConfig } | null | undefined)[] = [];
  const missingRefs = new Map<string, string[]>();
  const variantSchemas = new Map<string, { count: number; ops: string[] }>();

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
      const key = (typeof operation.operationId === 'string' && operation.operationId) || `${upper} ${path}`;

      const headers: Record<string, string> = {};
      const params: Param[] = [];
      const parameters = mergeParameters(pathItem.parameters, operation.parameters, doc);
      const notes: ExampleNotes = { missing: new Set(), variants: [] };

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
        const applied = applyOas3Body(operation.requestBody, doc, headers, notes);
        body = applied.body;
        bodyMode = applied.bodyMode;
        rawBodyFormat = applied.rawBodyFormat;
      } else if (swaggerBodySchema !== undefined) {
        const example = exampleFromSchema(swaggerBodySchema, doc, new Set(), 0, notes);
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
      if (!opts.bodies && body !== undefined) body = '';

      const scheme = operationScheme(operation, doc);
      opSchemes.push(scheme);
      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : null;

      const node: RequestNode = {
        kind: 'request',
        id: '',
        name,
        protocol: 'http',
        request: {
          method: upper,
          url: '{{baseUrl}}' + (opts.pathVars ? templatePath(path) : path),
          headers,
          ...(body !== undefined ? { body } : {}),
          ...(bodyMode ? { bodyMode } : {}),
          ...(rawBodyFormat ? { rawBodyFormat } : {}),
          ...(outBodyParams ? { bodyParams: outBodyParams } : {}),
        },
        ...(params.length > 0 ? { params } : {}),
      };
      const op: SpecOperation = { key, method: upper, path, tag, node };
      for (const ref of notes.missing) {
        missingRefs.set(ref, [...(missingRefs.get(ref) ?? []), key]);
        op.missingRef = true;
      }
      const variant = notes.variants[0];
      if (variant) {
        op.variants = variant.count;
        const seen = variantSchemas.get(variant.schema);
        variantSchemas.set(variant.schema, { count: variant.count, ops: [...(seen?.ops ?? []), key] });
      }
      ops.push(op);
    }
  }

  const collectionAuth = pickCollectionScheme(doc, opSchemes);
  ops.forEach((op, i) => {
    const scheme = opSchemes[i];
    if (scheme === null) op.node.request.auth = { type: 'none' };
    else if (scheme && !(opts.collectionAuth && scheme.name === collectionAuth?.scheme))
      op.node.request.auth = scheme.auth;
  });

  for (const [ref, keys] of missingRefs) warnings.push({ kind: 'ref', ref, ops: keys });
  for (const [schema, v] of variantSchemas) warnings.push({ kind: 'variants', schema, count: v.count, ops: v.ops });

  // Folders keyed by tag; a null key holds ungrouped requests. Insertion order is
  // preserved so the output tree is stable.
  const folders = new Map<string | null, ImportedFolder>();
  for (const op of ops) {
    const f = folders.get(op.tag) ?? { name: op.tag, requests: [] };
    f.requests.push(op.node);
    folders.set(op.tag, f);
  }

  const components = isObject(doc.components) ? doc.components : {};
  const schemaDefs = isObject(components.schemas)
    ? components.schemas
    : isObject(doc.definitions)
      ? doc.definitions
      : {};
  const tagNames = new Set(ops.map((o) => o.tag).filter(Boolean));
  return {
    title,
    version: typeof info.version === 'string' || typeof info.version === 'number' ? String(info.version) : '',
    format: version === 'oas3' ? `OpenAPI ${String(doc.openapi).split('.').slice(0, 2).join('.')}` : 'Swagger 2.0',
    baseUrl: servers[0]?.url ?? '',
    servers,
    folders: [...folders.values()],
    ops,
    collectionAuth,
    tags: tagNames.size,
    schemas: Object.keys(schemaDefs).length,
    schemeNames: Object.keys(schemes),
    warnings,
  };
}

/** The document-wide scheme, else the one most operations use. */
function pickCollectionScheme(
  doc: Doc,
  opSchemes: ({ name: string; auth: AuthConfig } | null | undefined)[],
): { scheme: string; auth: AuthConfig } | null {
  const global = operationScheme({}, doc);
  if (global) return { scheme: global.name, auth: global.auth };
  const counts = new Map<string, { n: number; auth: AuthConfig }>();
  for (const s of opSchemes) if (s) counts.set(s.name, { n: (counts.get(s.name)?.n ?? 0) + 1, auth: s.auth });
  const top = [...counts].sort((a, b) => b[1].n - a[1].n)[0];
  return top ? { scheme: top[0], auth: top[1].auth } : null;
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

type SecuritySchemeName = 'bearerAuth' | 'basicAuth' | 'apiKeyAuth' | 'oauth2';

/** The securityScheme definition + requirement key for an AuthConfig, or null. */
function authToScheme(auth: AuthConfig): { name: SecuritySchemeName; scheme: Obj } | null {
  if (auth.type === 'bearer') return { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer' } };
  if (auth.type === 'basic') return { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } };
  if (auth.type === 'oauth2') {
    const o = auth.oauth ?? {};
    const grant = oauthGrant(o);
    const key = {
      authorization_code: 'authorizationCode',
      client_credentials: 'clientCredentials',
      password: 'password',
    }[grant];
    const scopes = Object.fromEntries(oauthScopes(o).map((s) => [s, '']));
    const flow = {
      ...(grant === 'authorization_code' ? { authorizationUrl: o.authUrl ?? '' } : {}),
      tokenUrl: o.tokenUrl ?? '',
      scopes,
    };
    return { name: 'oauth2', scheme: { type: 'oauth2', flows: { [key]: flow } } };
  }
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
        security = [{ [mapped.name]: mapped.name === 'oauth2' ? oauthScopes(req.auth.oauth) : [] }];
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
