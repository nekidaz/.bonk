import { untrack } from 'svelte';
import type { GraphQLSchema } from 'graphql';
import { introspectHttp } from '$entities/request';
import { currentVarScope } from '$entities/environment';
import { graphqlSchemaPick, graphqlSchemaRead, type ImportFile } from '$shared/ipc';
import { resolveVars, type Tab } from '$shared/model';
import { persisted } from '$shared/persist';
import {
  endpointKey,
  INTROSPECTION_QUERY,
  isFetchableUrl,
  schemaFromFile,
  schemaFromIntrospection,
  typeCount,
} from './graphqlSchema';

/** The schema of one endpoint (the cache key) in this session. */
export type SchemaEntry =
  | { status: 'loading' }
  | { status: 'ready'; schema: GraphQLSchema; types: number; source: 'server'; at: number }
  | { status: 'ready'; schema: GraphQLSchema; types: number; source: 'file'; at: number; path: string; name: string }
  | { status: 'error'; message: string; source: 'server' | 'file'; path?: string };

/** Endpoint URL template (no query) → path of the schema file the user picked for it. */
export const graphqlSchemaFiles = persisted<Record<string, string>>('graphqlSchemaFiles', {});
/** The schema explorer panel next to the GraphQL body (Task 6 draws it). */
export const graphqlExplorerOpen = persisted('graphqlExplorerOpen', false);

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * In-memory schemas by endpoint, shared by every tab with that endpoint. Nothing here retries on
 * its own: an entry, once made (loading, ready or error), stays until `refresh` / `loadFile` /
 * `useServer` replaces it, so `ensure` from an effect can never loop.
 */
class GraphqlSchemas {
  entries = $state.raw<Record<string, SchemaEntry>>({});

  /** Cache key (resolved URL) and file-binding key (URL template); null while the URL is unfinished. */
  keysOf(tab: Tab): { cache: string; file: string } | null {
    const url = resolveVars(tab.request.url, currentVarScope());
    if (!isFetchableUrl(url)) return null;
    return { cache: endpointKey(url), file: endpointKey(tab.request.url) };
  }

  entryFor(tab: Tab): SchemaEntry | undefined {
    const keys = this.keysOf(tab);
    return keys ? this.entries[keys.cache] : undefined;
  }

  /** Auto: the bound file, else introspection that fails instead of asking for inputs. No-op once an entry exists. */
  ensure(tab: Tab): void {
    const keys = this.keysOf(tab);
    if (!keys || untrack(() => this.entries[keys.cache])) return;
    void this.#load(tab, keys, 'fail');
  }

  /** Manual: introspection that may ask for inputs, or a re-read of the bound file. */
  async refresh(tab: Tab): Promise<void> {
    const keys = this.keysOf(tab);
    if (keys) await this.#load(tab, keys, 'wait');
  }

  /** The file dialog; the picked file is bound to the endpoint and parsed. */
  async loadFile(tab: Tab): Promise<void> {
    const keys = this.keysOf(tab);
    if (!keys) return;
    let entry: SchemaEntry;
    try {
      const file = await graphqlSchemaPick();
      if (!file) return;
      graphqlSchemaFiles.current = { ...untrack(() => graphqlSchemaFiles.current), [keys.file]: file.path };
      entry = fileEntry(file);
    } catch (e) {
      entry = { status: 'error', message: message(e), source: 'file' };
    }
    this.#set(keys.cache, entry);
  }

  /** Forget the bound file and introspect. */
  async useServer(tab: Tab): Promise<void> {
    const keys = this.keysOf(tab);
    if (!keys) return;
    const files = { ...untrack(() => graphqlSchemaFiles.current) };
    delete files[keys.file];
    graphqlSchemaFiles.current = files;
    await this.#load(tab, keys, 'wait');
  }

  async #load(tab: Tab, keys: { cache: string; file: string }, inputMode: 'wait' | 'fail'): Promise<void> {
    const token = this.#start(keys.cache);
    await graphqlSchemaFiles.ready; // a binding is known only once state.json is read
    const path = untrack(() => graphqlSchemaFiles.current[keys.file]);
    let entry: SchemaEntry;
    if (path) {
      try {
        entry = fileEntry(await graphqlSchemaRead(path));
      } catch (e) {
        entry = { status: 'error', message: message(e), source: 'file', path };
      }
    } else {
      try {
        const schema = schemaFromIntrospection(await introspectHttp(tab, INTROSPECTION_QUERY, inputMode));
        entry = { status: 'ready', schema, types: typeCount(schema), source: 'server', at: Date.now() };
      } catch (e) {
        entry = { status: 'error', message: message(e), source: 'server' };
      }
    }
    this.#finish(keys.cache, token, entry);
  }

  // Each load puts its own `loading` object under the key it was started for (computed before any
  // await) and writes its result only if that object is still there: a newer load or file wins.
  #start(key: string): SchemaEntry {
    const token: SchemaEntry = { status: 'loading' };
    this.#set(key, token);
    return token;
  }

  #finish(key: string, token: SchemaEntry, entry: SchemaEntry): void {
    if (untrack(() => this.entries[key]) === token) this.#set(key, entry);
  }

  #set(key: string, entry: SchemaEntry): void {
    this.entries = { ...untrack(() => this.entries), [key]: entry };
  }
}

function fileEntry(file: ImportFile): SchemaEntry {
  try {
    const schema = schemaFromFile(file.name, file.text);
    return {
      status: 'ready',
      schema,
      types: typeCount(schema),
      source: 'file',
      at: Date.now(),
      path: file.path,
      name: file.name,
    };
  } catch (e) {
    return { status: 'error', message: message(e), source: 'file', path: file.path };
  }
}

export const graphqlSchemas = new GraphqlSchemas();
