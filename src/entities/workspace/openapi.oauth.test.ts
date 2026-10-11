import { describe, expect, it } from 'vitest';
import { buildOpenApi, parseOpenApi } from './openapi';
import type { RequestNode } from '$shared/model';

const spec = (securitySchemes: Record<string, unknown>, security: Record<string, string[]>[]) =>
  JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Pay', version: '1' },
    security,
    components: { securitySchemes },
    paths: { '/payments': { get: { responses: { '200': { description: 'ok' } } } } },
  });

describe('OpenAPI oauth2', () => {
  it('imports the code flow as OAuth on the collection', () => {
    const doc = spec(
      {
        fp: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://auth.test/authorize',
              tokenUrl: 'https://auth.test/token',
              scopes: { 'payments:read': '', 'payments:write': '' },
            },
            clientCredentials: { tokenUrl: 'https://auth.test/cc', scopes: {} },
          },
        },
      },
      [{ fp: ['payments:read'] }],
    );
    expect(parseOpenApi(doc, 'pay.json').collectionAuth).toEqual({
      scheme: 'fp',
      auth: {
        type: 'oauth2',
        oauth: {
          grant: 'authorization_code',
          authUrl: 'https://auth.test/authorize',
          tokenUrl: 'https://auth.test/token',
          clientId: '{{client_id}}',
          scope: 'payments:read payments:write',
        },
      },
    });
  });

  it('imports Swagger 2 client credentials, and keeps implicit as a Bearer', () => {
    const swagger = (flow: Record<string, unknown>) =>
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'S', version: '1' },
        securityDefinitions: { o: { type: 'oauth2', ...flow } },
        security: [{ o: [] }],
        paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
      });
    const cc = parseOpenApi(swagger({ flow: 'application', tokenUrl: 'https://t', scopes: { a: '' } }), 's.json');
    expect(cc.collectionAuth?.auth.oauth).toMatchObject({
      grant: 'client_credentials',
      tokenUrl: 'https://t',
      clientSecret: '{{client_secret}}',
      scope: 'a',
    });
    const implicit = parseOpenApi(swagger({ flow: 'implicit', authorizationUrl: 'https://a' }), 's.json');
    expect(implicit.collectionAuth?.auth).toEqual({ type: 'bearer', bearerToken: '{{token}}' });
  });

  it('exports OAuth as an oauth2 scheme with the request scopes', () => {
    const node: RequestNode = {
      kind: 'request',
      id: 'fs:p',
      name: 'List',
      protocol: 'http',
      request: {
        method: 'GET',
        url: '{{baseUrl}}/payments',
        headers: {},
        auth: {
          type: 'oauth2',
          oauth: { grant: 'client_credentials', tokenUrl: 'https://auth.test/token', scope: 'a b' },
        },
      },
    };
    const doc = buildOpenApi('C', [{ tag: null, requests: [node] }], { baseUrl: 'https://api.test' }) as {
      paths: Record<string, Record<string, { security: unknown }>>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.paths['/payments'].get.security).toEqual([{ oauth2: ['a', 'b'] }]);
    expect(doc.components.securitySchemes.oauth2).toEqual({
      type: 'oauth2',
      flows: { clientCredentials: { tokenUrl: 'https://auth.test/token', scopes: { a: '', b: '' } } },
    });
  });
});
