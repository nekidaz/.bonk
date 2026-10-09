import { describe, expect, it } from 'vitest';
import { buildRequestForSend } from './httpBody';
import { buildUrl } from './http';
import { resolveRequestVars } from './vars';
import type { RequestNode, Tab } from './types';

function graphqlTab(variables: string): Tab {
  return {
    id: 'graphql',
    protocol: 'http',
    title: 'GraphQL request',
    request: {
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: {},
      bodyMode: 'graphql',
      body: 'query User($id: ID!) { user(id: $id) { name } }',
      graphqlVariables: variables,
    },
  };
}

describe('GraphQL HTTP body', () => {
  it('sends a JSON envelope and resolves variables without breaking JSON escaping', () => {
    const built = buildRequestForSend(
      graphqlTab('{"id":"{{userId}}","filter":{"names":["{{name}}"]}}'),
      'https://example.com/graphql',
    );
    const sent = resolveRequestVars(built, { userId: '42', name: 'Ada "Lovelace"' });
    expect(sent.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(sent.body ?? '')).toEqual({
      query: 'query User($id: ID!) { user(id: $id) { name } }',
      variables: { id: '42', filter: { names: ['Ada "Lovelace"'] } },
    });
  });

  it('reports malformed variable JSON before sending', () => {
    const built = buildRequestForSend(graphqlTab('{id: }'), 'https://example.com/graphql');
    expect(() => resolveRequestVars(built, {})).toThrow('Переменные GraphQL должны быть корректным JSON.');
  });

  it('prepares saved runner requests with the same body, auth and params as interactive send', () => {
    const tab = graphqlTab('{"id":"{{userId}}"}');
    tab.request.auth = { type: 'bearer', bearerToken: '{{token}}' };
    tab.params = [{ key: 'operation', value: 'User', description: '', enabled: true }];
    const node: RequestNode = {
      kind: 'request',
      id: 'fs:users.bonk.json',
      name: 'User',
      protocol: 'http',
      request: tab.request,
      params: tab.params,
    };
    const scope = { userId: '42', token: 'secret' };
    const interactive = resolveRequestVars(buildRequestForSend(tab, buildUrl(tab.request.url, tab.params)), scope);
    const runner = resolveRequestVars(buildRequestForSend(node, buildUrl(node.request.url, node.params)), scope);
    expect(runner).toEqual(interactive);
    expect(runner.url).toBe('https://example.com/graphql?operation=User');
    expect(runner.headers.Authorization).toBe('Bearer secret');
  });
});
