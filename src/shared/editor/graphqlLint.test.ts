import { describe, expect, it } from 'vitest';
import { buildSchema } from 'graphql';
import { graphqlProblems, maskTemplateVars } from './graphqlLint';

const schema = buildSchema('type Query { user(id: ID!): User } type User { id: ID! name: String }');

describe('maskTemplateVars', () => {
  it('masks {{vars}} outside strings with same-length null', () => {
    const m = maskTemplateVars('{ user(id: {{userId}}) { id } }');
    expect(m.text).toBe('{ user(id: null      ) { id } }');
    expect(m.masks).toEqual([[11, 21]]);
  });

  it('leaves {{vars}} inside string literals alone', () => {
    expect(maskTemplateVars('{ user(id: "{{id}}") { id } }').masks).toEqual([]);
  });

  it('leaves {{vars}} inside block strings and comments alone', () => {
    expect(maskTemplateVars('{ a(x: """{{id}}""") }').masks).toEqual([]);
    expect(maskTemplateVars('# "{{id}}\n{ a(x: {{v}}) }').masks).toHaveLength(1);
  });
});

describe('graphqlProblems', () => {
  it('reports a syntax error without a schema', () => {
    const [p] = graphqlProblems('{ user(id: 1) { id }');
    expect(p.message).toMatch(/Syntax Error/);
  });

  it('reports an unknown field against the schema at its position', () => {
    const q = '{ user(id: "1") { nope } }';
    const [p] = graphqlProblems(q, schema);
    expect(q.slice(p.from, p.to)).toBe('nope');
  });

  it('never flags a {{var}}', () => {
    expect(graphqlProblems('{ user(id: {{userId}}) { id } }', schema)).toEqual([]);
    expect(graphqlProblems('{ user(id: "{{userId}}") { id } }', schema)).toEqual([]);
  });

  it('is empty for an empty query', () => {
    expect(graphqlProblems('   ', schema)).toEqual([]);
  });
});
