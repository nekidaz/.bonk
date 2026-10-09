import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';
import { matchCount } from './findPanel';

const doc = '{"amount": 1, "Amount": 2, "amounts": 3}';

describe('matchCount', () => {
  it('counts matches and finds the one under the selection', () => {
    const at = doc.indexOf('Amount');
    const state = EditorState.create({ doc, selection: EditorSelection.single(at, at + 6) });
    expect(matchCount(state, new SearchQuery({ search: 'amount' }))).toEqual({ current: 2, total: 3, capped: false });
  });

  it('honours match case and whole word', () => {
    const state = EditorState.create({ doc });
    expect(matchCount(state, new SearchQuery({ search: 'amount', caseSensitive: true })).total).toBe(2);
    expect(matchCount(state, new SearchQuery({ search: 'amount', wholeWord: true })).total).toBe(2);
    expect(matchCount(state, new SearchQuery({ search: 'amount', caseSensitive: true })).current).toBe(0);
  });

  it('stops at the cap', () => {
    const state = EditorState.create({ doc: 'a'.repeat(12_000) });
    expect(matchCount(state, new SearchQuery({ search: 'a' }))).toMatchObject({ total: 10_000, capped: true });
  });
});
