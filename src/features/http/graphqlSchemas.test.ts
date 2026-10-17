import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSchema, introspectionFromSchema } from 'graphql';
import type { HttpResponse, Tab } from '$shared/model';

const scope = vi.hoisted((): Record<string, string> => ({}));
const introspectHttp = vi.hoisted(() => vi.fn());
const graphqlSchemaRead = vi.hoisted(() => vi.fn());
const graphqlSchemaPick = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) })); // state.json behind `persisted`
vi.mock('$entities/request', () => ({ introspectHttp }));
vi.mock('$shared/ipc', () => ({ graphqlSchemaRead, graphqlSchemaPick }));
vi.mock('$entities/environment', () => ({ currentVarScope: () => scope }));

import { INTROSPECTION_QUERY } from './graphqlSchema';
import { graphqlSchemaFiles, graphqlSchemas } from './graphqlSchemas.svelte';

const tabOf = (url: string) => ({ id: 't1', request: { url } }) as unknown as Tab;
const okResponse = (): HttpResponse =>
  ({
    status: 200,
    body: JSON.stringify({ data: introspectionFromSchema(buildSchema('type Query { a: Int }')) }),
  }) as HttpResponse;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await graphqlSchemaFiles.ready;
  graphqlSchemaFiles.current = {};
  graphqlSchemas.entries = {};
  for (const k of Object.keys(scope)) delete scope[k];
  scope.base = 'https://a.io';
  introspectHttp.mockReset();
  graphqlSchemaRead.mockReset();
  graphqlSchemaPick.mockReset();
});

describe('graphqlSchemas', () => {
  it('ensure dedupes and never retries a failure', async () => {
    introspectHttp.mockRejectedValue(new Error('introspection is disabled'));
    const tab = tabOf('{{base}}/graphql');
    graphqlSchemas.ensure(tab);
    graphqlSchemas.ensure(tab);
    graphqlSchemas.ensure(tab);
    await settle();
    expect(introspectHttp).toHaveBeenCalledTimes(1);
    expect(graphqlSchemas.entryFor(tab)).toMatchObject({ status: 'error', message: 'introspection is disabled' });

    graphqlSchemas.ensure(tab);
    await settle();
    expect(introspectHttp).toHaveBeenCalledTimes(1);

    await graphqlSchemas.refresh(tab);
    expect(introspectHttp).toHaveBeenCalledTimes(2);
  });

  it('a late result lands under the key it was fetched for', async () => {
    let resolve!: (r: HttpResponse) => void;
    introspectHttp.mockReturnValue(new Promise<HttpResponse>((r) => (resolve = r)));
    const tab = tabOf('{{base}}/graphql');
    graphqlSchemas.ensure(tab);
    await settle();
    scope.base = 'https://b.io';
    expect(graphqlSchemas.keysOf(tab)?.cache).toBe('https://b.io/graphql');

    resolve(okResponse());
    await settle();
    expect(graphqlSchemas.entries['https://a.io/graphql']?.status).toBe('ready');
    expect(graphqlSchemas.entryFor(tab)).toBeUndefined();
  });

  it('auto fetch fails on inputs, refresh asks', async () => {
    introspectHttp.mockResolvedValue(okResponse());
    const tab = tabOf('https://a.io/graphql?x=1');
    graphqlSchemas.ensure(tab);
    await settle();
    expect(introspectHttp).toHaveBeenLastCalledWith(tab, INTROSPECTION_QUERY, 'fail');
    expect(graphqlSchemas.entryFor(tab)).toMatchObject({ status: 'ready', source: 'server', types: 4 });

    await graphqlSchemas.refresh(tab);
    expect(introspectHttp).toHaveBeenLastCalledWith(tab, INTROSPECTION_QUERY, 'wait');
  });

  it('a missing schema file is an error and keeps the binding', async () => {
    const tab = tabOf('{{base}}/graphql?x=1');
    const fileKey = graphqlSchemas.keysOf(tab)!.file;
    expect(fileKey).toBe('{{base}}/graphql');
    graphqlSchemaFiles.current = { [fileKey]: '/x/s.graphql' };
    graphqlSchemaRead.mockRejectedValue('file not found');

    graphqlSchemas.ensure(tab);
    await settle();
    expect(graphqlSchemaRead).toHaveBeenCalledWith('/x/s.graphql');
    expect(graphqlSchemas.entryFor(tab)).toMatchObject({ status: 'error', source: 'file', message: 'file not found' });
    expect(graphqlSchemaFiles.current[fileKey]).toBe('/x/s.graphql');
    expect(introspectHttp).not.toHaveBeenCalled();
  });

  it('useServer forgets the file', async () => {
    const tab = tabOf('{{base}}/graphql');
    graphqlSchemaFiles.current = { '{{base}}/graphql': '/x/s.graphql', other: '/y.graphql' };
    introspectHttp.mockResolvedValue(okResponse());

    await graphqlSchemas.useServer(tab);
    expect(graphqlSchemaFiles.current).toEqual({ other: '/y.graphql' });
    expect(introspectHttp).toHaveBeenCalledTimes(1);
    expect(graphqlSchemas.entryFor(tab)).toMatchObject({ status: 'ready', source: 'server' });
  });

  it('loadFile binds the picked file and parses it', async () => {
    const tab = tabOf('{{base}}/graphql');
    graphqlSchemaPick.mockResolvedValue({
      name: 's.graphql',
      path: '/x/s.graphql',
      size: 20,
      text: 'type Query { a: Int }',
    });

    await graphqlSchemas.loadFile(tab);
    expect(graphqlSchemaFiles.current).toEqual({ '{{base}}/graphql': '/x/s.graphql' });
    expect(graphqlSchemas.entryFor(tab)).toMatchObject({ status: 'ready', source: 'file', name: 's.graphql' });
  });

  it('keysOf is null for an unresolved URL', () => {
    delete scope.base;
    expect(graphqlSchemas.keysOf(tabOf('{{base}}/graphql'))).toBeNull();
  });
});
