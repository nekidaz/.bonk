import { describe, it, expect } from 'vitest';
import {
  jsonLineCol,
  jsonErrorMessage,
  repairLooseJson,
  parseJsonForBeautify,
  maybeInsertCommaBeforeJsonValue,
  bodyPlaceholder,
} from '../src/lib/domain/jsonEditor';
import type { Tab } from '../src/lib/domain/types';

function tab(overrides: Partial<Tab['request']> = {}): Tab {
  return {
    id: 't1',
    protocol: 'http',
    title: 'T',
    request: { method: 'POST', url: 'https://api.example.com', headers: {}, ...overrides },
  };
}

describe('jsonLineCol', () => {
  it('maps position 0 to line 1, column 1', () => {
    expect(jsonLineCol('abc', 0)).toBe('line 1, column 1');
  });
  it('counts newlines for the line and the trailing segment for the column', () => {
    // position 12 lands at the start of the third line ("XX").
    expect(jsonLineCol('line0\nline1\nXX', 12)).toBe('line 3, column 1');
    // mid-line column (5th char of the first line).
    expect(jsonLineCol('hello\nworld', 4)).toBe('line 1, column 5');
  });
  it('clamps negative positions to the start', () => {
    expect(jsonLineCol('abc', -10)).toBe('line 1, column 1');
  });
});

describe('jsonErrorMessage', () => {
  it('formats an explicit line/column from the engine message', () => {
    expect(jsonErrorMessage('x', new Error('Unexpected token at line 3 column 5'))).toBe(
      'Invalid JSON at line 3, column 5.',
    );
  });
  it('resolves a reported position back to a line/column in the source', () => {
    expect(jsonErrorMessage('ab\ncd\nef', new Error('Unexpected token at position 4'))).toBe(
      'Invalid JSON at line 2, column 2.',
    );
  });
  it('falls back to the raw message when no position is present', () => {
    expect(jsonErrorMessage('x', new Error('boom'))).toBe('Invalid JSON: boom');
  });
  it('stringifies non-Error throwables', () => {
    expect(jsonErrorMessage('x', 'nope')).toBe('Invalid JSON: nope');
  });
});

describe('repairLooseJson', () => {
  it('drops trailing commas in objects and arrays', () => {
    expect(repairLooseJson('{"a":1,}')).toBe('{"a":1}');
    expect(repairLooseJson('[1,2,]')).toBe('[1,2]');
  });
  it('quotes unquoted object keys', () => {
    expect(repairLooseJson('{a: 1, b_2: 2}')).toBe('{"a": 1, "b_2": 2}');
  });
  it('inserts a missing comma between values on separate lines', () => {
    expect(repairLooseJson('{\n  "a": 1\n  "b": 2\n}')).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });
  it('leaves already-valid JSON structurally intact (after trim)', () => {
    expect(repairLooseJson('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe('parseJsonForBeautify', () => {
  it('parses already-valid JSON', () => {
    expect(parseJsonForBeautify('{"a": 1}')).toEqual({ a: 1 });
  });
  it('treats empty/whitespace input as an empty object', () => {
    expect(parseJsonForBeautify('   ')).toEqual({});
  });
  it('repairs trailing commas and unquoted keys before parsing', () => {
    expect(parseJsonForBeautify('{a: 1, b: 2,}')).toEqual({ a: 1, b: 2 });
  });
  it('throws the original strict error when even the repair cannot parse', () => {
    // Single quotes are not repaired, so this still fails to parse.
    expect(() => parseJsonForBeautify("{'a': 1}")).toThrow();
  });
});

describe('maybeInsertCommaBeforeJsonValue', () => {
  it('inserts a comma after the previous complete value when on a fresh blank line', () => {
    const value = '{\n  "a": 1\n  \n}';
    const cursor = value.indexOf('\n  \n') + 3; // start of the blank line
    expect(maybeInsertCommaBeforeJsonValue(value, cursor)).toEqual({
      value: '{\n  "a": 1,\n  \n}',
      cursor: cursor + 1,
    });
  });
  it('is a no-op when the previous line ends with an opening brace', () => {
    const value = '{\n  \n}';
    expect(maybeInsertCommaBeforeJsonValue(value, 4)).toEqual({ value, cursor: 4 });
  });
  it('is a no-op when the cursor is not at the start of a line', () => {
    const value = '{\n  "a"';
    expect(maybeInsertCommaBeforeJsonValue(value, value.length)).toEqual({
      value,
      cursor: value.length,
    });
  });
  it('is a no-op when the previous line already ends with a comma', () => {
    const value = '{\n  "a": 1,\n  \n}';
    const cursor = value.indexOf('\n  \n') + 3;
    expect(maybeInsertCommaBeforeJsonValue(value, cursor)).toEqual({ value, cursor });
  });
});

describe('bodyPlaceholder', () => {
  it('returns a GraphQL query stub for graphql mode', () => {
    expect(bodyPlaceholder(tab({ bodyMode: 'graphql' }))).toContain('query GetUser');
  });
  it('returns binary guidance for binary mode', () => {
    expect(bodyPlaceholder(tab({ bodyMode: 'binary' }))).toBe('Paste binary-safe text payload');
  });
  it('returns a JSON stub when the (raw) format resolves to JSON', () => {
    expect(bodyPlaceholder(tab({ bodyMode: 'raw', rawBodyFormat: 'JSON' }))).toBe('{\n  "hello": "world"\n}');
    // default mode is raw and empty body sniffs to JSON
    expect(bodyPlaceholder(tab())).toBe('{\n  "hello": "world"\n}');
  });
  it('returns the generic prompt for non-JSON raw formats', () => {
    expect(bodyPlaceholder(tab({ bodyMode: 'raw', rawBodyFormat: 'Text' }))).toBe('Request body');
  });
});
