import { describe, it, expect } from 'vitest';
import { applyFilter } from './jsonFilter';

describe('applyFilter', () => {
  const src = { body: '{"results":[{"s":"ok"},{"s":"failed"},{"s":"failed"}]}' };
  it('returns matches pretty-printed with a count', () => {
    const r = applyFilter(src, "$.results[?(@.s == 'failed')]");
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.matches).toBe(2);
      expect(JSON.parse(r.text)).toEqual([{ s: 'failed' }, { s: 'failed' }]);
    }
  });
  it('empty path = no filter; bad path and non-JSON report errors', () => {
    expect(applyFilter(src, '  ').kind).toBe('none');
    expect(applyFilter(src, '$.[').kind).toBe('error');
    expect(applyFilter({ body: 'plain text' }, '$.a').kind).toBe('error');
  });
});
