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

describe('buildOperation on an interface', () => {
  it('selects only __typename', () => {
    const n = buildSchema(
      'interface Node { id: ID! } type User implements Node { id: ID! name: String } type Query { node(id: ID!): Node }',
    );
    const text = buildOperation(n, 'query', 'node').text;
    expect(text).toContain('node(id: $id) {\n    __typename\n  }');
    expect(text).not.toContain('    id\n');
  });
});

describe('appendOperation', () => {
  it('suffixes the operation name when it is already taken', () => {
    const once = appendOperation('', '', s, 'query', 'user');
    const twice = appendOperation(once.query, once.variables, s, 'query', 'user');
    expect(twice.query).toContain('query User2($id: ID!)');
    expect(JSON.parse(twice.variables)).toEqual({ id: null });
    expect(appendOperation(twice.query, twice.variables, s, 'query', 'user').query).toContain('query User3(');
  });

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
