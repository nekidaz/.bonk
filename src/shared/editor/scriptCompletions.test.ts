import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { scriptCompletionSource } from './scriptCompletions';

function complete(doc: string, explicit = false) {
  const state = EditorState.create({ doc });
  const result = scriptCompletionSource(new CompletionContext(state, doc.length, explicit));
  return result && { from: result.from, labels: result.options.map((o) => o.label) };
}

describe('scriptCompletionSource', () => {
  it('lists the members of the object left of the dot', () => {
    expect(complete('pm.environment.')).toEqual({ from: 15, labels: ['get', 'set', 'unset', 'has', 'toObject'] });
    expect(complete('  pm.req')?.labels).toContain('request');
    expect(complete('pm.request.headers.a')?.labels).toContain('add');
  });

  it('completes matchers after pm.expect(…) and pm.response.to', () => {
    expect(complete('pm.expect(data.items).to.be.')?.labels).toContain('below');
    expect(complete('pm.response.to.have.')?.labels).toContain('status');
  });

  it('offers globals for a bare word and nothing for unknown owners', () => {
    expect(complete('p')?.labels).toEqual(['pm', 'console', 'JSON']);
    expect(complete('foo.')).toBeNull();
    expect(complete('')).toBeNull();
  });
});
