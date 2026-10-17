import { buildClientSchema, buildSchema, getIntrospectionQuery, type GraphQLSchema } from 'graphql';
import type { HttpResponse } from '$shared/model';

/** The standard introspection query, default options, no variables. */
export const INTROSPECTION_QUERY = getIntrospectionQuery();

/** Cache key of a schema: the URL without `?query` and `#hash`. */
export function endpointKey(url: string): string {
  const u = url.trim();
  const cut = u.search(/[?#]/);
  return cut < 0 ? u : u.slice(0, cut);
}

/** `http(s)://` plus a host: the URL looks finished enough to ask the server for a schema. */
export function isFetchableUrl(url: string): boolean {
  return /^https?:\/\/[^/\s{}?#]+/i.test(url.trim());
}

/** Number of user types (introspection's own `__` types are not counted). */
export function typeCount(schema: GraphQLSchema): number {
  return Object.keys(schema.getTypeMap()).filter((n) => !n.startsWith('__')).length;
}

/** Introspection result `{__schema}` or `{data:{__schema}}` to a schema. Throws Error(message) shown in the chip. */
function fromIntrospectionJson(json: unknown, missing: string): GraphQLSchema {
  const obj = (json ?? {}) as { data?: { __schema?: unknown }; __schema?: unknown; errors?: { message?: unknown }[] };
  const data = obj.data && typeof obj.data === 'object' ? obj.data : obj;
  if (data.__schema) return buildClientSchema(data as Parameters<typeof buildClientSchema>[0]);
  const first = Array.isArray(obj.errors) ? obj.errors[0]?.message : undefined;
  throw new Error(typeof first === 'string' && first ? first : missing);
}

/** The response to the introspection request to a schema. Throws Error(message). */
export function schemaFromIntrospection(res: HttpResponse): GraphQLSchema {
  if (res.status < 200 || res.status > 299) throw new Error(`HTTP ${res.status}`);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error('response is not JSON');
  }
  return fromIntrospectionJson(json, 'no __schema in the response');
}

/** A schema file: `.json` is an introspection result, anything else is SDL. Throws on bad input. */
export function schemaFromFile(name: string, text: string): GraphQLSchema {
  if (!name.toLowerCase().endsWith('.json')) return buildSchema(text);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('file is not JSON');
  }
  return fromIntrospectionJson(json, 'no __schema in the file');
}
