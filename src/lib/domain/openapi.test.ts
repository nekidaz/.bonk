import { describe, it, expect } from 'vitest';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { parseOpenApi, buildOpenApi, serializeSpec, exampleFromSchema, type ExportFolder } from './openapi';
import type { RequestNode } from './types';

// A small OAS3 spec: a GET with a query param + path param, and a POST with a
// $ref JSON body guarded by bearer security.
const oas3 = {
  openapi: '3.0.3',
  info: { title: 'Demo API', version: '1.0.0' },
  servers: [{ url: 'https://api.demo.test/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: {
      NewUser: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'Ada' },
          age: { type: 'integer' },
          admin: { type: 'boolean' },
        },
      },
    },
  },
  paths: {
    '/users/{id}': {
      get: {
        summary: 'Get user',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'verbose', in: 'query', schema: { type: 'string', default: 'true' } },
        ],
      },
    },
    '/users': {
      post: {
        operationId: 'createUser',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NewUser' } },
          },
        },
      },
    },
  },
};

describe('parseOpenApi — OpenAPI 3', () => {
  const spec = parseOpenApi(JSON.stringify(oas3), 'demo.json');

  it('parses title and base URL from servers', () => {
    expect(spec.title).toBe('Demo API');
    expect(spec.baseUrl).toBe('https://api.demo.test/v1');
  });

  it('imports one request per path+method', () => {
    const all = spec.folders.flatMap((f) => f.requests);
    expect(all).toHaveLength(2);
  });

  it('templates path params to {{var}} and keeps query params as rows', () => {
    const all = spec.folders.flatMap((f) => f.requests);
    const get = all.find((r) => r.request.method === 'GET')!;
    expect(get.name).toBe('Get user');
    expect(get.request.url).toBe('{{baseUrl}}/users/{{id}}');
    expect(get.params).toEqual([{ key: 'verbose', value: 'true', description: '', enabled: true }]);
  });

  it('generates a JSON body from a $ref schema and sets Content-Type', () => {
    const all = spec.folders.flatMap((f) => f.requests);
    const post = all.find((r) => r.request.method === 'POST')!;
    expect(post.request.bodyMode).toBe('raw');
    expect(post.request.rawBodyFormat).toBe('JSON');
    expect(post.request.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(post.request.body!)).toEqual({ name: 'Ada', age: 0, admin: false });
  });

  it('resolves bearer security into auth', () => {
    const all = spec.folders.flatMap((f) => f.requests);
    const post = all.find((r) => r.request.method === 'POST')!;
    expect(post.request.auth).toEqual({ type: 'bearer', bearerToken: '' });
  });
});

describe('parseOpenApi — YAML input', () => {
  it('parses YAML equivalently to JSON', () => {
    const fromJson = parseOpenApi(JSON.stringify(oas3), 'demo.json');
    const fromYaml = parseOpenApi(stringifyYaml(oas3), 'demo.yaml');
    expect(fromYaml.title).toBe(fromJson.title);
    expect(fromYaml.baseUrl).toBe(fromJson.baseUrl);
    expect(fromYaml.folders.flatMap((f) => f.requests)).toEqual(fromJson.folders.flatMap((f) => f.requests));
  });
});

const swagger2 = {
  swagger: '2.0',
  info: { title: 'Legacy', version: '1.0' },
  host: 'legacy.test',
  basePath: '/api',
  schemes: ['https'],
  securityDefinitions: {
    apiKeyAuth: { type: 'apiKey', name: 'X-Token', in: 'header' },
  },
  security: [{ apiKeyAuth: [] }],
  definitions: {
    Widget: { type: 'object', properties: { label: { type: 'string' } } },
  },
  paths: {
    '/widgets': {
      post: {
        summary: 'Create widget',
        consumes: ['application/json'],
        parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Widget' } }],
      },
    },
  },
};

describe('parseOpenApi — Swagger 2.0', () => {
  const spec = parseOpenApi(JSON.stringify(swagger2), 'legacy.json');

  it('derives base URL from scheme+host+basePath', () => {
    expect(spec.baseUrl).toBe('https://legacy.test/api');
  });

  it('turns an in:body schema into a JSON body', () => {
    const post = spec.folders.flatMap((f) => f.requests)[0];
    expect(post.request.bodyMode).toBe('raw');
    expect(post.request.rawBodyFormat).toBe('JSON');
    expect(post.request.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(post.request.body!)).toEqual({ label: '' });
  });

  it('resolves an apiKey security definition', () => {
    const post = spec.folders.flatMap((f) => f.requests)[0];
    expect(post.request.auth).toEqual({
      type: 'apiKey',
      apiKeyName: 'X-Token',
      apiKeyIn: 'header',
      apiKeyValue: '',
    });
  });
});

describe('exampleFromSchema', () => {
  const doc = {
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            next: { $ref: '#/components/schemas/Node' }, // self-reference
          },
        },
      },
    },
  };

  it('builds objects, arrays, and picks enum first', () => {
    expect(exampleFromSchema({ type: 'object', properties: { n: { type: 'integer' } } }, {})).toEqual({ n: 0 });
    expect(exampleFromSchema({ type: 'array', items: { type: 'string' } }, {})).toEqual(['']);
    expect(exampleFromSchema({ enum: ['a', 'b'] }, {})).toBe('a');
  });

  it('guards $ref cycles instead of recursing forever', () => {
    const out = exampleFromSchema({ $ref: '#/components/schemas/Node' }, doc) as {
      id: string;
      next: unknown;
    };
    expect(out.id).toBe('');
    expect(out.next).toBeNull(); // cycle broken
  });
});

describe('buildOpenApi + serializeSpec', () => {
  const node = (over: Partial<RequestNode> & { name: string }): RequestNode => ({
    kind: 'request',
    id: '',
    protocol: 'http',
    request: { method: 'GET', url: '', headers: {} },
    ...over,
  });

  const folders: ExportFolder[] = [
    {
      tag: 'Users',
      requests: [
        node({
          name: 'Get user',
          request: {
            method: 'GET',
            url: '{{baseUrl}}/users/{{id}}',
            headers: { 'X-Trace': 'abc' },
          },
          params: [{ key: 'verbose', value: 'true', description: 'noisy', enabled: true }],
        }),
        node({
          name: 'Create user',
          request: {
            method: 'POST',
            url: '{{baseUrl}}/users',
            headers: { 'Content-Type': 'application/json' },
            body: '{"name":"Ada"}',
            bodyMode: 'raw',
            rawBodyFormat: 'JSON',
            auth: { type: 'bearer', bearerToken: '' },
          },
        }),
      ],
    },
  ];

  const doc = buildOpenApi('My Collection', folders, { baseUrl: 'https://api.demo.test/v1' }) as {
    openapi: string;
    info: { title: string };
    servers: { url: string }[];
    paths: Record<string, Record<string, unknown>>;
    components?: { securitySchemes: Record<string, unknown> };
  };

  it('emits correct paths, methods, and strips {{baseUrl}} to {var}', () => {
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBe('My Collection');
    expect(doc.servers).toEqual([{ url: 'https://api.demo.test/v1' }]);
    expect(Object.keys(doc.paths).sort()).toEqual(['/users', '/users/{id}']);
    expect(doc.paths['/users/{id}'].get).toBeDefined();
    expect(doc.paths['/users'].post).toBeDefined();
  });

  it('emits path, query, and header parameters', () => {
    const get = doc.paths['/users/{id}'].get as { parameters: Record<string, unknown>[] };
    expect(get.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'verbose', in: 'query', schema: { type: 'string' }, example: 'true', description: 'noisy' },
      { name: 'X-Trace', in: 'header', schema: { type: 'string' }, example: 'abc' },
    ]);
  });

  it('emits a requestBody and a referenced security scheme', () => {
    const post = doc.paths['/users'].post as {
      requestBody: { content: Record<string, { example: unknown }> };
      security: unknown[];
    };
    expect(post.requestBody.content['application/json'].example).toEqual({ name: 'Ada' });
    expect(post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components!.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' });
  });

  it('round-trips paths/methods when the input has no baseUrl env (common prefix)', () => {
    const derived = buildOpenApi('C', folders) as {
      servers: { url: string }[];
      paths: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(derived.paths).sort()).toEqual(['/users', '/users/{id}']);
    // The only common prefix is the {{baseUrl}} template, which stays intact.
    expect(derived.servers?.[0]?.url).toBe('{{baseUrl}}');
  });

  it('serializes to parseable JSON and YAML', () => {
    const json = serializeSpec(doc, 'json');
    const yaml = serializeSpec(doc, 'yaml');
    expect(JSON.parse(json).openapi).toBe('3.0.3');
    expect(parseYaml(yaml).openapi).toBe('3.0.3');
  });
});
