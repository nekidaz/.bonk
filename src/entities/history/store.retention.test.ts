import { beforeEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import type { HistoryEntry } from '$shared/model';
import { settingsFile } from '$shared/persist';
import { history, addHistory } from './store.svelte';
import { historyDays, watchHistoryRetention } from './dataPrefs.svelte';

function entry(id: string, at = Date.now()): HistoryEntry {
  return {
    id,
    protocol: 'http',
    request: { method: 'GET', url: `https://example.com/${id}`, headers: {} },
    status: 200,
    at,
  };
}
const ids = () => history.list.map((e) => e.id);

describe('history retention', () => {
  beforeEach(() => {
    history.list = [];
    history.limit = 500;
    history.paused = false;
  });

  it('records entries newest-first when not paused', () => {
    addHistory(entry('a'));
    addHistory(entry('b'));
    expect(ids()).toEqual(['b', 'a']);
  });

  it('is a no-op while paused', () => {
    history.paused = true;
    addHistory(entry('a'));
    expect(history.list).toEqual([]);

    history.paused = false;
    addHistory(entry('b'));
    expect(ids()).toEqual(['b']);
  });

  it('caps stored entries at the limit, keeping the newest', () => {
    history.limit = 2;
    addHistory(entry('a'));
    addHistory(entry('b'));
    addHistory(entry('c'));
    expect(ids()).toEqual(['c', 'b']);
  });

  it('treats limit 0 as unlimited', () => {
    history.limit = 0;
    for (const id of ['a', 'b', 'c', 'd', 'e']) addHistory(entry(id));
    expect(ids()).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('truncates existing entries when the limit is lowered', () => {
    history.limit = 0;
    for (const id of ['a', 'b', 'c', 'd', 'e']) addHistory(entry(id));
    expect(history.list).toHaveLength(5);

    history.limit = 2;
    expect(ids()).toEqual(['e', 'd']);
  });

  it('drops entries older than historyDays once that setting has loaded', async () => {
    const stop = watchHistoryRetention();
    await settingsFile.load();
    historyDays.current = 1;
    history.list = [entry('new'), entry('old', Date.now() - 3 * 86_400_000)];
    await tick();
    expect(ids()).toEqual(['new']);
    stop();
  });
});
