import { describe, it, expect } from 'vitest';
import { parseScriptResult } from './scripts';

describe('parseScriptResult returnValue', () => {
  it('passes through the script return value untouched', () => {
    const out = parseScriptResult(
      JSON.stringify({ logs: [], tests: [], returnValue: { token: 'abc', n: 2 } }),
    );
    expect(out.returnValue).toEqual({ token: 'abc', n: 2 });
  });

  it('leaves returnValue undefined when the script returned nothing', () => {
    const out = parseScriptResult(JSON.stringify({ logs: ['hi'], tests: [] }));
    expect(out.returnValue).toBeUndefined();
    expect(out.logs).toEqual(['hi']);
  });
});
