/** Bonk Mono palettes (S32.5): light and dark. «Как в системе» picks one of them (app/lifecycle.svelte.ts). */
export type Theme = 'smooth-light' | 'smooth-dark';

export const DEFAULT_THEME: Theme = 'smooth-light';
const STORAGE_KEY = 'bonk.theme';
// Palettes removed in favour of the two from the design; a stored one keeps its light/dark intent.
const LEGACY_DARK = ['postman-dark', 'dark', 'nord', 'tokyo-night', 'ayu-mirage', 'rose-pine'];

export function isDarkTheme(t: Theme): boolean {
  return t === 'smooth-dark';
}

/** Read the persisted theme. Falls back to the default outside a browser. */
function readStored(): Theme {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY) ?? '';
    return v === 'smooth-dark' || LEGACY_DARK.includes(v) ? 'smooth-dark' : DEFAULT_THEME;
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

/** The palette in use (`theme.current`). Every assignment is saved to localStorage and applied to the DOM. */
class ThemeState {
  #value = $state<Theme>(readStored());

  constructor() {
    // A legacy stored name is rewritten as its replacement right away.
    persist(this.#value);
    applyTheme(this.#value);
  }

  get current(): Theme {
    return this.#value;
  }

  set current(t: Theme) {
    this.#value = t;
    persist(t);
    applyTheme(t);
  }
}
export const theme = new ThemeState();

export function setTheme(t: Theme): void {
  theme.current = t;
}

/** Apply the persisted theme to the DOM. Call before mount to avoid a flash. */
export function applyStoredTheme(): void {
  applyTheme(readStored());
}
