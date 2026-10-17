import { buildSchema, introspectionFromSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '$shared/model';
import {
  endpointKey,
  INTROSPECTION_QUERY,
  isFetchableUrl,
  schemaFromFile,
  schemaFromIntrospection,
  typeCount,
} from './graphqlSchema';

const SDL = 'type Query { a: Int }';
const intro = introspectionFromSchema(buildSchema(SDL));

function res(status: number, body: string): HttpResponse {
  return { status, headers: {}, body, final_url: '', elapsed_ms: 0, size_bytes: body.length };
}

describe('endpointKey', () => {
  it('drops query, hash and surrounding spaces', () => {
    expect(endpointKey('https://x.io/graphql?op=1#h ')).toBe('https://x.io/graphql');
    expect(endpointKey(' https://x.io/graphql#h?x ')).toBe('https://x.io/graphql');
  });
});

describe('isFetchableUrl', () => {
  it('wants http(s) and a host', () => {
    expect(isFetchableUrl('https://x.io/graphql')).toBe(true);
    for (const u of ['', 'https://', '{{base}}/graphql', 'x.io/graphql']) expect(isFetchableUrl(u)).toBe(false);
  });
});

describe('schemaFromIntrospection', () => {
  it('builds a schema from {data}', () => {
    const schema = schemaFromIntrospection(res(200, JSON.stringify({ data: intro })));
    expect(typeCount(schema)).toBeGreaterThan(0);
    expect(schema.getQueryType()?.name).toBe('Query');
  });

  it('turns failures into short messages', () => {
    const msg = (r: HttpResponse) => () => schemaFromIntrospection(r);
    expect(msg(res(200, '{"errors":[{"message":"GraphQL introspection is not allowed"}]}'))).toThrow(
      'GraphQL introspection is not allowed',
    );
    expect(msg(res(401, ''))).toThrow('HTTP 401');
    // The status wins even when the body is a GraphQL error.
    expect(msg(res(500, '{"errors":[{"message":"boom"}]}'))).toThrow('HTTP 500');
    expect(msg(res(200, '<html>'))).toThrow('response is not JSON');
    expect(msg(res(200, '{"data":{}}'))).toThrow('no __schema in the response');
  });
});

describe('schemaFromFile', () => {
  it('reads SDL', () => {
    expect(schemaFromFile('s.graphql', SDL).getQueryType()?.name).toBe('Query');
    expect(() => schemaFromFile('s.graphql', 'type {')).toThrow();
  });

  it('reads introspection JSON, bare or wrapped in data', () => {
    const bare = JSON.stringify({ __schema: intro.__schema });
    const wrapped = JSON.stringify({ data: intro });
    expect(schemaFromFile('i.json', bare).getQueryType()?.name).toBe('Query');
    expect(schemaFromFile('i.json', wrapped).getQueryType()?.name).toBe('Query');
  });
});

it('INTROSPECTION_QUERY is the standard query', () => {
  expect(INTROSPECTION_QUERY).toContain('__schema');
});
