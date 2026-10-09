import { persisted } from '$shared/persist';
import { effectiveBindings, isOverrides } from './hotkeys';

/** User overrides of the default shortcuts (Settings → Хоткеи): command id → binding ('' = cleared). Self-persisting. */
export const hotkeyOverrides = persisted<Record<string, string>>('hotkeys', {}, isOverrides);

/** Effective bindings, defaults + overrides: `hotkeys.current[commandId]`. */
class Hotkeys {
  current = $derived(effectiveBindings(hotkeyOverrides.current));
}
export const hotkeys = new Hotkeys();

export const setBinding = (id: string, binding: string): void => {
  hotkeyOverrides.current = { ...hotkeyOverrides.current, [id]: binding };
};
export const resetBinding = (id: string): void => {
  const { [id]: _, ...rest } = hotkeyOverrides.current;
  hotkeyOverrides.current = rest;
};
export const resetAllBindings = (): void => {
  hotkeyOverrides.current = {};
};
