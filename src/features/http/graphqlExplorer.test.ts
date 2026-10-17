import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { rootKindOf, searchSchema, userTypes } from './graphqlExplorer';

const s = buildSchema(`
  type Query { user(id: ID!, lang: String): User  search(q: String!): [Result!]!  ping: Boolean }
  type User { id: ID! name: String role: Role friends: [User] }
  enum Role { A B }
  union Result = User
  type Mutation { addUser(name: String!): User }
`);

describe('searchSchema', () => {
  it('matches type and field names case-insensitively, types first, no introspection types', () => {
    const hits = searchSchema(s, 'USE');
    expect(hits).toContainEqual({ type: 'User' });
    expect(hits).toContainEqual({ type: 'Query', field: 'user' });
    const lastType = hits.findLastIndex((h) => !h.field);
    const firstField = hits.findIndex((h) => h.field);
    expect(lastType).toBeLessThan(firstField);
    expect(hits.some((h) => h.type.startsWith('__'))).toBe(false);
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchSchema(s, '')).toEqual([]);
    expect(searchSchema(s, 'a', 2).length).toBe(2);
  });
});

describe('rootKindOf', () => {
  it('names the root a type is', () => {
    expect(rootKindOf(s, 'Mutation')).toBe('mutation');
    expect(rootKindOf(s, 'Query')).toBe('query');
    expect(rootKindOf(s, 'User')).toBeNull();
  });
});

describe('userTypes', () => {
  it('skips __ types and sorts by name', () => {
    const names = userTypes(s).map((t) => t.name);
    expect(names).not.toContain('__Type');
    expect(names).toEqual([...names].sort());
  });
});
