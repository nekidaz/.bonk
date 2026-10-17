import { getNamedType, isLeafType, isNonNullType, isObjectType, type GraphQLField, type GraphQLSchema } from 'graphql';

export type RootKind = 'query' | 'mutation' | 'subscription';

function rootType(schema: GraphQLSchema, root: RootKind) {
  if (root === 'query') return schema.getQueryType();
  if (root === 'mutation') return schema.getMutationType();
  return schema.getSubscriptionType();
}

/** `addUser` -> `AddUser`, `get_user` -> `GetUser`. */
function pascal(name: string): string {
  return name.replace(/(^|_+)([a-zA-Z0-9])/g, (_, __, c: string) => c.toUpperCase());
}

/** Selection set body: object types get scalar/enum fields without args; interfaces, unions and the rest get `__typename`. */
function subFields(field: GraphQLField<unknown, unknown>): string[] {
  const t = getNamedType(field.type);
  if (isLeafType(t)) return [];
  if (isObjectType(t)) {
    const leaves = Object.values(t.getFields())
      .filter((f) => f.args.length === 0 && isLeafType(getNamedType(f.type)))
      .map((f) => f.name);
    if (leaves.length) return leaves;
  }
  return ['__typename'];
}

/** A starter operation for one root field: required args become variables, sub-fields are the leaf ones. */
export function buildOperation(
  schema: GraphQLSchema,
  root: RootKind,
  field: string,
  name = pascal(field),
): { text: string; variables: string[] } {
  const f = rootType(schema, root)?.getFields()[field];
  if (!f) throw new Error(`No ${root} field "${field}"`);
  const required = f.args.filter((a) => isNonNullType(a.type) && a.defaultValue === undefined);
  const decl = required.length ? `(${required.map((a) => `$${a.name}: ${String(a.type)}`).join(', ')})` : '';
  const call = required.length ? `(${required.map((a) => `${a.name}: $${a.name}`).join(', ')})` : '';
  const sub = subFields(f);
  const body = sub.length ? ` {\n${sub.map((n) => `    ${n}`).join('\n')}\n  }` : '';
  return {
    text: `${root} ${name}${decl} {\n  ${field}${call}${body}\n}`,
    variables: required.map((a) => a.name),
  };
}

/** Adds the operation after the existing Query and its new variables (as null) to the Variables JSON. */
export function appendOperation(
  query: string,
  variablesJson: string,
  schema: GraphQLSchema,
  root: RootKind,
  field: string,
): { query: string; variables: string } {
  const taken = new Set(
    [...query.matchAll(/\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g)].map((m) => m[1]),
  );
  const base = pascal(field);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
  const op = buildOperation(schema, root, field, name);
  const nextQuery = query.trim() ? `${query.trimEnd()}\n\n${op.text}` : op.text;
  if (!op.variables.length) return { query: nextQuery, variables: variablesJson };
  let obj: Record<string, unknown> = {};
  if (variablesJson.trim()) {
    try {
      const parsed: unknown = JSON.parse(variablesJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { query: nextQuery, variables: variablesJson };
      obj = parsed as Record<string, unknown>;
    } catch {
      return { query: nextQuery, variables: variablesJson };
    }
  }
  for (const name of op.variables) if (!(name in obj)) obj[name] = null;
  return { query: nextQuery, variables: JSON.stringify(obj, null, 2) };
}
