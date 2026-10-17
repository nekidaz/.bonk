/** Pure helpers of the schema explorer panel (GraphqlExplorer.svelte): search, root kind, type list. */
import { isInputObjectType, isInterfaceType, isObjectType, type GraphQLNamedType, type GraphQLSchema } from 'graphql';
import type { RootKind } from './graphqlOperation';

/** A place in the schema: a type, or one field of it. */
export interface ExplorerHit {
  type: string;
  field?: string;
}

/** Every named type except the introspection ones (`__Schema`, `__Type`…), sorted by name. */
export function userTypes(schema: GraphQLSchema): GraphQLNamedType[] {
  return Object.values(schema.getTypeMap())
    .filter((t) => !t.name.startsWith('__'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Types whose name contains `q` (any case), then fields of object/interface/input types; at most `limit`. */
export function searchSchema(schema: GraphQLSchema, q: string, limit = 50): ExplorerHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const types = userTypes(schema);
  const hits: ExplorerHit[] = types.filter((t) => t.name.toLowerCase().includes(needle)).map((t) => ({ type: t.name }));
  for (const t of types) {
    if (hits.length >= limit) break;
    if (!isObjectType(t) && !isInterfaceType(t) && !isInputObjectType(t)) continue;
    for (const f of Object.keys(t.getFields()))
      if (f.toLowerCase().includes(needle)) hits.push({ type: t.name, field: f });
  }
  return hits.slice(0, limit);
}

/** `query` / `mutation` / `subscription` when `typeName` is that root type of the schema, else null. */
export function rootKindOf(schema: GraphQLSchema, typeName: string): RootKind | null {
  if (schema.getQueryType()?.name === typeName) return 'query';
  if (schema.getMutationType()?.name === typeName) return 'mutation';
  if (schema.getSubscriptionType()?.name === typeName) return 'subscription';
  return null;
}
