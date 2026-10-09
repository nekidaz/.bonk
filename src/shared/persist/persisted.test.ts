import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { flushPendingSaves } from './persist';
import { persisted } from './persisted.svelte';

const saved = () => invoke.mock.calls.filter(([cmd]) => cmd === 'app_state_set').map(([, args]) => args);

describe('persisted', () => {
  it('restores the stored value, never saves before that, then saves each assignment', async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === 'app_state_load' ? { size: 14, kind: 'x' } : null));
    const size = persisted('size', 13);
    const wrongType = persisted('kind', 0);

    size.current = 99; // before the load: not written, and the stored value wins
    await flushPendingSaves();
    expect(saved()).toEqual([]);
    await size.ready;
    await wrongType.ready;
    expect(size.current).toBe(14);
    expect(wrongType.current).toBe(0); // a stored value of another type is ignored

    size.current = 12;
    await flushPendingSaves();
    expect(saved()).toContainEqual({ key: 'size', value: 12 });

    invoke.mockClear();
    size.current = 12; // unchanged primitive: no write
    await flushPendingSaves();
    expect(saved()).toEqual([]);
  });
});
