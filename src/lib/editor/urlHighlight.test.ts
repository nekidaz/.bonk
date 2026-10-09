import { describe, expect, it } from 'vitest';
import { urlQueryTokens } from './urlHighlight';

describe('urlQueryTokens', () => {
  it('splits the query into punctuation, keys and values', () => {
    const url = '{{baseUrl}}/p?limit=50&flag&x=';
    const parts = urlQueryTokens(url).map((t) => `${t.kind}:${url.slice(t.from, t.to)}`);
    expect(parts).toEqual([
      'punct:?',
      'key:limit',
      'punct:=',
      'value:50',
      'punct:&',
      'key:flag',
      'punct:&',
      'key:x',
      'punct:=',
    ]);
  });
  it('ignores URLs without a query', () => {
    expect(urlQueryTokens('https://x.io/a')).toEqual([]);
  });
});
