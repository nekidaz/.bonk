import { describe, expect, it } from 'vitest';
import { parseCsv, parseJson, parseDataFile } from './runnerData';

describe('parseCsv', () => {
  it('maps the header row onto each data row', () => {
    expect(parseCsv('name,age\nAda,36\nGrace,44')).toEqual([
      { name: 'Ada', age: '36' },
      { name: 'Grace', age: '44' },
    ]);
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const csv = 'name,note\n"Doe, John","line1\nline2"';
    expect(parseCsv(csv)).toEqual([{ name: 'Doe, John', note: 'line1\nline2' }]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsv('msg\n"she said ""hi"""')).toEqual([{ msg: 'she said "hi"' }]);
  });

  it('accepts CRLF line endings and drops a trailing empty line', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('returns no rows for a header-only file', () => {
    expect(parseCsv('a,b')).toEqual([]);
  });
});

describe('parseJson', () => {
  it('coerces every value to a string', () => {
    const json = JSON.stringify([{ id: 1, active: true, ratio: 1.5, missing: null }]);
    expect(parseJson(json)).toEqual([{ id: '1', active: 'true', ratio: '1.5', missing: 'null' }]);
  });

  it('stringifies nested objects and arrays', () => {
    const json = JSON.stringify([{ tags: ['a', 'b'], meta: { k: 1 } }]);
    expect(parseJson(json)).toEqual([{ tags: '["a","b"]', meta: '{"k":1}' }]);
  });

  it('throws when the top level is not an array', () => {
    expect(() => parseJson('{"name":"x"}')).toThrow(/array of objects/);
  });

  it('throws when a row is not an object', () => {
    expect(() => parseJson('[{"a":1}, 42]')).toThrow(/row 2 must be an object/);
  });

  it('throws a clear error on malformed JSON', () => {
    expect(() => parseJson('[{')).toThrow(/not valid JSON/);
  });
});

describe('parseDataFile', () => {
  it('dispatches by extension (case-insensitive)', () => {
    expect(parseDataFile('rows.CSV', 'a\n1')).toEqual([{ a: '1' }]);
    expect(parseDataFile('rows.json', '[{"a":"1"}]')).toEqual([{ a: '1' }]);
  });

  it('throws on an unsupported extension', () => {
    expect(() => parseDataFile('rows.txt', 'a\n1')).toThrow(/Unsupported data file type/);
  });
});
