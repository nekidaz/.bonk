import { writable } from 'svelte/store';

/** Editor-inspired colour themes. Existing light/dark ids stay migration-safe. */
export type Theme = 'light' | 'dark' | 'nord' | 'tokyo-night' | 'ayu-mirage' | 'rose-pine';

export interface ThemeOption {
  value: Theme;
  label: string;
  scheme: 'light' | 'dark';
  preview: {
    chrome: string;
    canvas: string;
    accent: string;
  };
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'Zed Light', scheme: 'light', preview: { chrome: '#e7e7e5', canvas: '#f7f7f5', accent: '#4d76b6' } },
  { value: 'dark', label: 'Zed Dark', scheme: 'dark', preview: { chrome: '#1f2329', canvas: '#282c34', accent: '#6f9bd6' } },
  { value: 'nord', label: 'Nord', scheme: 'dark', preview: { chrome: '#20242d', canvas: '#2e3440', accent: '#88c0d0' } },
  { value: 'tokyo-night', label: 'Tokyo Night', scheme: 'dark', preview: { chrome: '#13131a', canvas: '#1a1b26', accent: '#7aa2f7' } },
  { value: 'ayu-mirage', label: 'Ayu Mirage', scheme: 'dark', preview: { chrome: '#141820', canvas: '#1f2430', accent: '#ffcc66' } },
  { value: 'rose-pine', label: 'Rosé Pine', scheme: 'dark', preview: { chrome: '#12101a', canvas: '#191724', accent: '#c4a7e7' } },
];

export const DEFAULT_THEME: Theme = 'light';
const STORAGE_KEY = 'bonk.theme';

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && THEME_OPTIONS.some((theme) => theme.value === v);
}

export function nextTheme(t: Theme): Theme {
  const index = THEME_OPTIONS.findIndex((theme) => theme.value === t);
  return THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].value;
}

export function themeLabel(t: Theme): string {
  return THEME_OPTIONS.find((theme) => theme.value === t)?.label ?? t;
}

export function isDarkTheme(t: Theme): boolean {
  return THEME_OPTIONS.find((theme) => theme.value === t)?.scheme === 'dark';
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

/** Apply both the Tailwind colour scheme and the palette-specific selector. */
export function applyTheme(t: Theme): void {
  try {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    root.classList.toggle('dark', isDarkTheme(t));
    root.dataset.theme = t;
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
