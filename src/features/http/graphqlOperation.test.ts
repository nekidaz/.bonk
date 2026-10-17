import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { appendOperation, buildOperation } from './graphqlOperation';

const s = buildSchema(`
  type Query { user(id: ID!, lang: String): User  search(q: String!): [Result!]!  ping: Boolean }
  type User { id: ID! name: String role: Role friends: [User] }
  enum Role { A B }
  union Result = User
  type Mutation { addUser(name: String!): User }
`);

const USER_OP = 'query User($id: ID!) {\n  user(id: $id) {\n    id\n    name\n    role\n  }\n}';

describe('buildOperation', () => {
  it('uses required args, scalar/enum sub-fields only', () => {
    const op = buildOperation(s, 'query', 'user');
    expect(op.text).toBe(USER_OP);
    expect(op.variables).toEqual(['id']);
  });

  it('falls back to __typename for a union', () => {
    const op = buildOperation(s, 'query', 'search');
    expect(op.text).toContain('search(q: $q) {\n    __typename\n  }');
    expect(op.text).toContain('$q: String!');
  });

  it('has no selection set for a scalar', () => {
    expect(buildOperation(s, 'query', 'ping')).toEqual({ text: 'query Ping {\n  ping\n}', variables: [] });
  });

  it('works for mutations', () => {
    expect(buildOperation(s, 'mutation', 'addUser').text.startsWith('mutation AddUser($name: String!)')).toBe(true);
  });

  it('throws on an unknown field', () => {
    expect(() => buildOperation(s, 'query', 'nope')).toThrow();
    expect(() => buildOperation(s, 'subscription', 'x')).toThrow();
  });
});

describe('appendOperation', () => {
  it('replaces an empty query and seeds variables', () => {
    const r = appendOperation('  \n', '', s, 'query', 'user');
    expect(r.query).toBe(USER_OP);
    expect(JSON.parse(r.variables)).toEqual({ id: null });
    expect(r.variables).toBe(JSON.stringify({ id: null }, null, 2));
  });

  it('appends after an existing query and keeps existing variable keys', () => {
    const r = appendOperation('query A { ping }', '{"x":1}', s, 'query', 'user');
    expect(r.query).toBe('query A { ping }\n\n' + USER_OP);
    expect(JSON.parse(r.variables)).toEqual({ x: 1, id: null });
    expect(JSON.parse(appendOperation('', '{"id":"7"}', s, 'query', 'user').variables)).toEqual({ id: '7' });
  });

  it('leaves invalid variables JSON untouched', () => {
    expect(appendOperation('query A { ping }', '{bad', s, 'query', 'user').variables).toBe('{bad');
  });

  it('leaves variables untouched when the operation needs none', () => {
    expect(appendOperation('', '{"x":1}', s, 'query', 'ping').variables).toBe('{"x":1}');
  });
});
