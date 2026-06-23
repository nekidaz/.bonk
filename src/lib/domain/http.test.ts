import { describe, it, expect } from 'vitest';
import { encodeQueryPart, syncUrlWithParams, paramsFromUrl, buildUrl, mergeParamsFromUrl } from './http';
import type { Param } from './types';

const p = (key: string, value: string, enabled = true): Param => ({
  key,
  value,
  description: '',
  enabled,
});

describe('encodeQueryPart', () => {
  it('encodes normal characters', () => {
    expect(encodeQueryPart('a b&c')).toBe('a%20b%26c');
  });

  it('leaves {{var}} placeholders untouched', () => {
    expect(encodeQueryPart('{{token}}')).toBe('{{token}}');
    expect(encodeQueryPart('pre {{a}} post')).toBe('pre%20{{a}}%20post');
    expect(encodeQueryPart('{{base}}/x y')).toBe('{{base}}%2Fx%20y');
  });
});

describe('syncUrlWithParams', () => {
  it('rebuilds the query from enabled rows and preserves {{var}}', () => {
    const url = syncUrlWithParams('https://api.example.com/x', [
      p('token', '{{authToken}}'),
      p('q', 'a b'),
    ]);
    expect(url).toBe('https://api.example.com/x?token={{authToken}}&q=a%20b');
  });

  it('drops disabled and empty-key rows', () => {
    const url = syncUrlWithParams('https://h/x', [p('a', '1'), p('b', '2', false), p('', 'x')]);
    expect(url).toBe('https://h/x?a=1');
  });

  it('keeps the fragment and clears the query when no rows remain', () => {
    expect(syncUrlWithParams('https://h/x?old=1#frag', [])).toBe('https://h/x?old=1#frag'); // empty params = untouched
    expect(syncUrlWithParams('https://h/x?old=1#frag', [p('a', '1')])).toBe('https://h/x?a=1#frag');
    expect(syncUrlWithParams('https://h/x#frag', [p('', '')])).toBe('https://h/x#frag');
  });
});

describe('paramsFromUrl', () => {
  it('parses params and decodes values', () => {
    const rows = paramsFromUrl('https://h/x?a=1&b=hello%20world');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['a', '1'],
      ['b', 'hello world'],
    ]);
  });

  it('keeps {{var}} readable after a URL round-trip', () => {
    const rows = paramsFromUrl('https://h/x?token={{authToken}}');
    expect(rows[0].value).toBe('{{authToken}}');
    expect(buildUrl('https://h/x', rows)).toBe('https://h/x?token={{authToken}}');
  });
});

describe('mergeParamsFromUrl', () => {
  it('preserves the description of a matching key when the URL is edited', () => {
    const prev: Param[] = [{ key: 'a', value: '1', description: 'first', enabled: true }];
    const rows = mergeParamsFromUrl('https://h/x?a=2&b=3', prev);
    expect(rows.find((r) => r.key === 'a')).toMatchObject({ value: '2', description: 'first' });
    expect(rows.find((r) => r.key === 'b')).toMatchObject({ value: '3', description: '' });
  });

  it('keeps disabled rows that the URL cannot represent', () => {
    const rows = mergeParamsFromUrl('https://h/x?a=1', [p('a', '1'), p('hidden', 'x', false)]);
    expect(rows.map((r) => [r.key, r.enabled])).toEqual([
      ['a', true],
      ['hidden', false],
    ]);
  });

  it('drops enabled params removed from the URL', () => {
    const rows = mergeParamsFromUrl('https://h/x?a=1', [p('a', '1'), p('b', '2')]);
    expect(rows.map((r) => r.key)).toEqual(['a']);
  });
});
