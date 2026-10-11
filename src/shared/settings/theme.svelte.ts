/** Themes (Flow · Темы): a palette from tokens.css plus the shape and UI font it uses by default.
 *  Shape and font are separate layers: each follows the theme until the user picks one. */
export type Shape = 'soft' | 'sharp' | 'square';
export type UiFont = 'sans' | 'mono';

export const THEMES = [
  { id: 'smooth-dark', name: 'Bonk Dark', dark: true, shape: 'soft', font: 'sans' },
  { id: 'smooth-light', name: 'Bonk Light', dark: false, shape: 'soft', font: 'sans' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', dark: true, shape: 'square', font: 'mono' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', dark: true, shape: 'soft', font: 'sans' },
  { id: 'nord', name: 'Nord', dark: true, shape: 'sharp', font: 'sans' },
  { id: 'solarized-light', name: 'Solarized Light', dark: false, shape: 'sharp', font: 'sans' },
] as const satisfies readonly { id: string; name: string; dark: boolean; shape: Shape; font: UiFont }[];
export type Theme = (typeof THEMES)[number]['id'];
export type ThemeInfo = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'smooth-light';
export const SHAPES: readonly Shape[] = ['soft', 'sharp', 'square'];
export const UI_FONTS: readonly UiFont[] = ['sans', 'mono'];
// Palettes removed earlier; a stored one keeps its light/dark intent.
const LEGACY_DARK = ['postman-dark', 'dark', 'tokyo-night', 'ayu-mirage', 'rose-pine'];

export const isTheme = (v: unknown): v is Theme => THEMES.some((x) => x.id === v);
export const themeInfo = (t: Theme): ThemeInfo => THEMES.find((x) => x.id === t) ?? THEMES[1];
export const isDarkTheme = (t: Theme): boolean => themeInfo(t).dark;

function read(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, v: string): void {
  try {
    globalThis.localStorage?.setItem(key, v);
  } catch {
    /* no storage (tests / SSR) — ignore */
  }
}

function oneOf<T extends string>(v: string, list: readonly T[]): T | undefined {
  return list.find((x) => x === v);
}

function readTheme(): Theme {
  const v = read('bonk.theme');
  if (isTheme(v)) return v;
  return LEGACY_DARK.includes(v) ? 'smooth-dark' : DEFAULT_THEME;
}

/** A setting kept in localStorage (not state.json) so main.ts can apply it before mount, without a flash.
 *  Every assignment is saved and applied to <html>. */
class Stored<T extends string> {
  #value = $state() as T;

  constructor(
    readonly key: string,
    value: T,
  ) {
    this.#value = value;
    // A legacy or invalid stored value is rewritten right away.
    write(key, value);
  }

  get current(): T {
    return this.#value;
  }

  set current(v: T) {
    this.#value = v;
    write(this.key, v);
    applyAppearance();
  }
}

/** The palette in use (`theme.current`). */
export const theme = new Stored<Theme>('bonk.theme', readTheme());
/** 'theme' = the shape / UI font the theme comes with. */
export const shapePref = new Stored<Shape | 'theme'>('bonk.shape', oneOf(read('bonk.shape'), SHAPES) ?? 'theme');
export const fontPref = new Stored<UiFont | 'theme'>('bonk.font', oneOf(read('bonk.font'), UI_FONTS) ?? 'theme');

export const shapeOf = (t: Theme): Shape => (shapePref.current === 'theme' ? themeInfo(t).shape : shapePref.current);
export const fontOf = (t: Theme): UiFont => (fontPref.current === 'theme' ? themeInfo(t).font : fontPref.current);

/** Put a theme on <html>: palette (data-theme + the Tailwind `dark` class), shape and UI font.
 *  `t` other than theme.current is a preview (⌘K → Тема) that is not saved. */
export function applyAppearance(t: Theme = theme.current): void {
  try {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    root.classList.toggle('dark', isDarkTheme(t));
    root.dataset.theme = t;
    root.dataset.shape = shapeOf(t);
    root.dataset.font = fontOf(t);
  } catch {
    /* no DOM (tests) — ignore */
  }
}

export function setTheme(t: Theme): void {
  theme.current = t;
}

/** Apply the persisted appearance to the DOM. Call before mount to avoid a flash. */
export const applyStoredTheme = (): void => applyAppearance();
