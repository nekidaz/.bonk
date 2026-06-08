import { writable } from 'svelte/store';

/** Colour themes. `light` = Big Sur light (default), `dark` = Big Sur dark. */
export type Theme = 'light' | 'dark';

export const DEFAULT_THEME: Theme = 'light';
const STORAGE_KEY = 'bonk.theme';

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

export function nextTheme(t: Theme): Theme {
  return t === 'light' ? 'dark' : 'light';
}

/** Read the persisted theme. Falls back to the default outside a browser. */
function readStored(): Theme {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function persist(t: Theme): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, t);
  } catch {
    /* no storage (tests / SSR) — ignore */
  }
}

/** Toggle the `.dark` class on <html> (Tailwind darkMode: 'class'). */
export function applyTheme(t: Theme): void {
  try {
    globalThis.document?.documentElement?.classList.toggle('dark', t === 'dark');
  } catch {
    /* no DOM (tests) — ignore */
  }
}

export const theme = writable<Theme>(readStored());

export function setTheme(t: Theme): void {
  theme.set(t);
}

export function toggleTheme(): void {
  theme.update(nextTheme);
}

// Persist + apply on every change (fires immediately with the initial value).
theme.subscribe((t) => {
  persist(t);
  applyTheme(t);
});

/** Apply the persisted theme to the DOM. Call before mount to avoid a flash. */
export function applyStoredTheme(): void {
  applyTheme(readStored());
}
