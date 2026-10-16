import { setting } from '$shared/persist';
import { customThemes, themeCssText, type CustomTheme, type ThemeColors } from './customThemes.svelte';

/** Themes (Flow · Themes): a palette from tokens.css plus the shape and UI font it uses by default.
 *  Shape and font are separate layers: each follows the theme until the user picks one.
 *  User themes (`custom:<slug>`, customThemes.svelte.ts) sit on top of Bonk Dark / Bonk Light. */
export type Shape = 'soft' | 'sharp' | 'square';
export type UiFont = 'sans' | 'mono';

const BUILTIN = [
  { id: 'smooth-dark', name: 'Bonk Dark', dark: true, shape: 'soft', font: 'sans' },
  { id: 'smooth-light', name: 'Bonk Light', dark: false, shape: 'soft', font: 'sans' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', dark: true, shape: 'square', font: 'mono' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', dark: true, shape: 'soft', font: 'sans' },
  { id: 'nord', name: 'Nord', dark: true, shape: 'sharp', font: 'sans' },
  { id: 'solarized-light', name: 'Solarized Light', dark: false, shape: 'sharp', font: 'sans' },
] as const satisfies readonly { id: string; name: string; dark: boolean; shape: Shape; font: UiFont }[];
export type BuiltinTheme = (typeof BUILTIN)[number]['id'];
export type Theme = BuiltinTheme | `custom:${string}`;

export interface ThemeInfo {
  id: Theme;
  name: string;
  dark: boolean;
  shape: Shape;
  font: UiFont;
  /** The tokens.css palette under it: itself, or Bonk Dark / Light for a user theme. */
  base: BuiltinTheme;
  /** A user theme's colours, laid over `base`. */
  colors?: ThemeColors;
}

export const THEMES: readonly ThemeInfo[] = BUILTIN.map((x) => ({ ...x, base: x.id }));
const customInfo = (c: CustomTheme): ThemeInfo => ({
  id: `custom:${c.slug}`,
  name: c.name,
  dark: c.dark,
  shape: 'soft',
  font: 'sans',
  base: c.dark ? 'smooth-dark' : 'smooth-light',
  colors: c.colors,
});
/** Built-in themes, then the user's (reactive: reads customThemes.list). */
export const allThemes = (): ThemeInfo[] => [...THEMES, ...customThemes.list.map(customInfo)];

export const DEFAULT_THEME: Theme = 'smooth-light';
export const SHAPES: readonly Shape[] = ['soft', 'sharp', 'square'];
export const UI_FONTS: readonly UiFont[] = ['sans', 'mono'];
// Palettes removed earlier; a stored one keeps its light/dark intent.
const LEGACY_DARK = ['postman-dark', 'dark', 'tokyo-night', 'ayu-mirage', 'rose-pine'];

const find = (t: unknown): ThemeInfo | undefined => allThemes().find((x) => x.id === t);
export const isTheme = (v: unknown): v is Theme => !!find(v);
/** A user theme whose file is gone falls back to Bonk Light. */
export const themeInfo = (t: Theme): ThemeInfo => find(t) ?? THEMES[1];
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

const isShapePref = (v: unknown): v is Shape | 'theme' => v === 'theme' || SHAPES.includes(v as Shape);
const isFontPref = (v: unknown): v is UiFont | 'theme' => v === 'theme' || UI_FONTS.includes(v as UiFont);

// Appearance lives in settings.json like every setting; localStorage keeps a copy (watchAppearance)
// that is the value until the file is read, so main.ts paints the saved theme before mount, without a flash.
/** The palette in use (`theme.current`). */
export const theme = setting<Theme>('ui.theme', 'theme', DEFAULT_THEME, isTheme, readTheme());
/** 'theme' = the shape / UI font the theme comes with. */
export const shapePref = setting<Shape | 'theme'>(
  'ui.shape',
  'uiShape',
  'theme',
  isShapePref,
  oneOf(read('bonk.shape'), SHAPES) ?? 'theme',
);
export const fontPref = setting<UiFont | 'theme'>(
  'ui.font',
  'uiFont',
  'theme',
  isFontPref,
  oneOf(read('bonk.font'), UI_FONTS) ?? 'theme',
);

/** Keep <html> and the localStorage copy in step with the appearance settings (an edit of
 *  settings.json included). Started once by the app; returns a stop function. */
export function watchAppearance(): () => void {
  return $effect.root(() => {
    $effect(() => {
      applyAppearance();
      write('bonk.theme', theme.current);
      write('bonk.shape', shapePref.current);
      write('bonk.font', fontPref.current);
    });
  });
}

export const shapeOf = (t: Theme): Shape => (shapePref.current === 'theme' ? themeInfo(t).shape : shapePref.current);
export const fontOf = (t: Theme): UiFont => (fontPref.current === 'theme' ? themeInfo(t).font : fontPref.current);

/** Put a theme on <html>: palette (data-theme + the Tailwind `dark` class), shape and UI font.
 *  `t` other than theme.current is a preview (⌘K → Theme) that is not saved. */
export function applyAppearance(t: Theme = theme.current): void {
  try {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    const info = themeInfo(t);
    root.classList.toggle('dark', info.dark);
    root.dataset.theme = info.base;
    applyColors(root, info.colors);
    root.dataset.shape = shapeOf(t);
    root.dataset.font = fontOf(t);
  } catch {
    /* no DOM (tests) — ignore */
  }
}

/** A user theme's colours go into one <style> rule that outranks the base palette on <html> and .bs
 *  (tokens.css repeats each palette on .bs, so inline vars on <html> alone would lose there). */
function applyColors(root: HTMLElement, colors: ThemeColors | undefined): void {
  let style = document.getElementById('bonk-custom-theme');
  root.toggleAttribute('data-custom', !!colors);
  if (!style && !colors) return;
  if (!style) {
    style = document.createElement('style');
    style.id = 'bonk-custom-theme';
    document.head.append(style);
  }
  style.textContent = colors ? `:root[data-custom],:root[data-custom] .bs{${themeCssText(colors)}}` : '';
}

export function setTheme(t: Theme): void {
  theme.current = t;
}

/** Apply the persisted appearance to the DOM. Call before mount to avoid a flash. */
export const applyStoredTheme = (): void => applyAppearance();
