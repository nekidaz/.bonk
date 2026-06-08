import { describe, it, expect } from 'vitest';
import { buildUrl, paramsFromUrl, syncUrlWithParams } from '../src/lib/domain/http';
import type { Param } from '../src/lib/domain/types';

function p(key: string, value: string, enabled = true): Param {
  return { key, value, description: '', enabled };
}

describe('buildUrl', () => {
  it('returns the url unchanged when there are no params', () => {
    expect(buildUrl('https://api.example.com/users', undefined)).toBe('https://api.example.com/users');
    expect(buildUrl('https://api.example.com/users', [])).toBe('https://api.example.com/users');
  });

  it('appends params with ? when the url has no query string', () => {
    expect(buildUrl('https://api.example.com', [p('a', '1'), p('b', '2')])).toBe(
      'https://api.example.com?a=1&b=2',
    );
  });

  it('lets params own an existing query string so sends do not duplicate rows', () => {
    expect(buildUrl('https://api.example.com?a=1', [p('b', '2')])).toBe(
      'https://api.example.com?b=2',
    );
  });

  it('skips disabled rows and rows with an empty (or whitespace) key', () => {
    const params = [p('a', '1'), p('b', '2', false), p('', 'ignored'), p('   ', 'ignored')];
    expect(buildUrl('https://api.example.com', params)).toBe('https://api.example.com?a=1');
  });

  it('returns the url unchanged when every param row is filtered out', () => {
    expect(buildUrl('https://api.example.com', [p('x', '1', false)])).toBe('https://api.example.com');
  });

  it('percent-encodes keys and values (spaces, &, unicode)', () => {
    const params = [
      p('full name', 'John Doe'),
      p('q', 'a&b=c'),
      p('city', 'München'),
    ];
    expect(buildUrl('https://api.example.com', params)).toBe(
      'https://api.example.com?full%20name=John%20Doe&q=a%26b%3Dc&city=M%C3%BCnchen',
    );
  });

  it('trims the key before encoding but preserves the value as-is', () => {
    expect(buildUrl('https://api.example.com', [p('  token  ', '  abc  ')])).toBe(
      'https://api.example.com?token=%20%20abc%20%20',
    );
  });

  it('preserves hash fragments while syncing params', () => {
    expect(syncUrlWithParams('https://api.example.com/path?old=1#frag', [p('a', '1')])).toBe(
      'https://api.example.com/path?a=1#frag',
    );
  });

  it('parses url query params for the Params table', () => {
    expect(paramsFromUrl('https://api.example.com?a=1&full+name=John+Doe#top')).toEqual([
      p('a', '1'),
      p('full name', 'John Doe'),
    ]);
  });
});
