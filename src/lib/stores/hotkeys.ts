import { derived } from 'svelte/store';
import { persisted } from '../persist';
import { effectiveBindings, isOverrides } from '../domain/hotkeys';

/** User overrides of the default shortcuts (Settings → Хоткеи): command id → binding ('' = cleared). Self-persisting. */
export const hotkeyOverrides = persisted<Record<string, string>>('hotkeys', {}, isOverrides);
export const hotkeys = derived(hotkeyOverrides, effectiveBindings);

export const setBinding = (id: string, binding: string): void => hotkeyOverrides.update((o) => ({ ...o, [id]: binding }));
export const resetBinding = (id: string): void => hotkeyOverrides.update(({ [id]: _, ...rest }) => rest);
export const resetAllBindings = (): void => hotkeyOverrides.set({});
