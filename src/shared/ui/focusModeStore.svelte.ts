import type { FocusMode } from './focusMode';

/** Expanded editor / response (E3, E6 · ⌥⌘F): `focusMode.current`. Transient: not persisted, reset on tab switch by App. */
class FocusModeState {
  current = $state<FocusMode>(null);
}
export const focusMode = new FocusModeState();
