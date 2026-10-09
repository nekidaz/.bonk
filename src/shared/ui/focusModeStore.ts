import { writable } from 'svelte/store';
import type { FocusMode } from './focusMode';

/** Expanded editor / response (E3, E6 · ⌥⌘F). Transient: not persisted, reset on tab switch by App. */
export const focusMode = writable<FocusMode>(null);
