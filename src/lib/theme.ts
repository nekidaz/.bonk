import { writable } from 'svelte/store';

/** Bonk palettes. Persisted theme ids remain supported across visual updates. */
export type Theme = 'smooth-light' | 'smooth-dark' | 'postman-light' | 'postman-dark' | 'light' | 'dark' | 'nord' | 'tokyo-night' | 'ayu-mirage' | 'rose-pine';

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
  { value: 'smooth-light', label: 'Bonk Light', scheme: 'light', preview: { chrome: '#f0f0f0', canvas: '#ffffff', accent: '#202020' } },
  { value: 'smooth-dark', label: 'Bonk Dark', scheme: 'dark', preview: { chrome: '#111111', canvas: '#1b1b1b', accent: '#eeeeee' } },
  { value: 'postman-light', label: 'Postman Light', scheme: 'light', preview: { chrome: '#f8f8f8', canvas: '#ffffff', accent: '#ff6c37' } },
  { value: 'postman-dark', label: 'Postman Dark', scheme: 'dark', preview: { chrome: '#252525', canvas: '#212121', accent: '#ff6c37' } },
  { value: 'light', label: 'Zed Light', scheme: 'light', preview: { chrome: '#e7e7e5', canvas: '#f7f7f5', accent: '#4d76b6' } },
  { value: 'dark', label: 'Zed Dark', scheme: 'dark', preview: { chrome: '#1f2329', canvas: '#282c34', accent: '#6f9bd6' } },
  { value: 'nord', label: 'Nord', scheme: 'dark', preview: { chrome: '#20242d', canvas: '#2e3440', accent: '#88c0d0' } },
  { value: 'tokyo-night', label: 'Tokyo Night', scheme: 'dark', preview: { chrome: '#13131a', canvas: '#1a1b26', accent: '#7aa2f7' } },
  { value: 'ayu-mirage', label: 'Ayu Mirage', scheme: 'dark', preview: { chrome: '#141820', canvas: '#1f2430', accent: '#ffcc66' } },
  { value: 'rose-pine', label: 'Rosé Pine', scheme: 'dark', preview: { chrome: '#12101a', canvas: '#191724', accent: '#c4a7e7' } },
];

export const DEFAULT_THEME: Theme = 'smooth-light';
const STORAGE_KEY = 'bonk.theme';
const THEME_VERSION_KEY = 'bonk.theme.version';
// '4': dev builds persisted postman-* under '3'; move them onto Bonk Mono once more.
const THEME_VERSION = '4';

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
    // Upgrade the former default palettes once, preserving light/dark intent.
    // Subsequent explicit legacy selections must survive a restart unchanged.
    if (globalThis.localStorage?.getItem(THEME_VERSION_KEY) !== THEME_VERSION) {
      if (v === 'light' || v === 'postman-light') return 'smooth-light';
      if (v === 'dark' || v === 'postman-dark') return 'smooth-dark';
    }
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function persist(t: Theme): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, t);
    globalThis.localStorage?.setItem(THEME_VERSION_KEY, THEME_VERSION);
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
