import { themesList } from '$shared/ipc';

/** Colour tokens a theme sets: the Pencil variable names from Flow · Themes. */
export const THEME_TOKENS = [
  'color-app',
  'color-panel',
  'color-raised',
  'color-field',
  'color-sidebar',
  'color-text',
  'color-text-secondary',
  'color-text-muted',
  'color-border',
  'color-border-subtle',
  'color-action',
  'color-action-hover',
  'color-action-press',
  'color-on-action',
  'color-selected',
  'color-hover',
  'color-hover-strong',
  'color-canvas',
  'color-inverse',
  'color-on-inverse',
  'color-focus',
  'color-success',
  'color-success-soft',
  'color-warning',
  'color-warning-soft',
  'color-danger',
  'color-danger-soft',
  'color-var',
  'color-var-soft',
  'method-get',
  'method-post',
  'method-put',
  'method-patch',
  'method-delete',
  'method-query',
  'method-grpc',
  'syntax-key',
  'syntax-string',
  'syntax-number',
  'syntax-punct',
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeColors = Partial<Record<ThemeToken, string>>;

/** A user theme from ~/.bonk/themes/<slug>.json. Tokens it lacks come from Bonk Dark / Bonk Light. */
export interface CustomTheme {
  slug: string;
  name: string;
  dark: boolean;
  colors: ThemeColors;
}

// Only hex colours get through: the values are written into a <style> element.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
const SLUG = /^[a-z0-9-]{1,64}$/;

/** A saved theme file, or null when it isn't one. Unknown tokens and non-hex values are dropped. */
export function parseCustomTheme(slug: string, text: string): CustomTheme | null {
  try {
    const raw = JSON.parse(text) as { name?: unknown; appearance?: unknown; colors?: Record<string, unknown> };
    if (!SLUG.test(slug) || typeof raw.name !== 'string' || !raw.colors || typeof raw.colors !== 'object') return null;
    const colors: ThemeColors = {};
    for (const token of THEME_TOKENS) {
      const v = raw.colors[token];
      if (isHexColor(v)) colors[token] = v;
    }
    return { slug, name: raw.name.slice(0, 80), dark: raw.appearance !== 'light', colors };
  } catch {
    return null;
  }
}

/** The file format of ~/.bonk/themes: readable, and shareable as is. */
export function serializeCustomTheme(t: CustomTheme): string {
  return JSON.stringify({ name: t.name, appearance: t.dark ? 'dark' : 'light', colors: t.colors }, null, 2) + '\n';
}

// tokens.css names each token feeds (the same mapping the built-in palettes use).
const CSS_VARS: Record<ThemeToken, string[]> = {
  'color-app': ['bg', 'tb'],
  'color-panel': ['surface', 'canvas'],
  'color-raised': ['surface-solid', 's1'],
  'color-field': ['inset'],
  'color-sidebar': ['side', 'response'],
  'color-text': ['text'],
  'color-text-secondary': ['text2', 't2'],
  'color-text-muted': ['t3'],
  'color-border': ['sep', 'border', 's3'],
  'color-border-subtle': ['sepsoft', 'border2'],
  'color-action': ['accent', 'primary'],
  'color-action-hover': ['primary-hover'],
  'color-action-press': ['accent-press', 'primary-press'],
  'color-on-action': ['primary-text', 'on-accent'],
  'color-selected': ['accentsoft', 's2'],
  'color-hover': ['hover'],
  'color-hover-strong': ['hover-strong'],
  'color-canvas': ['canvas-app', 'sdim'],
  'color-inverse': ['inverse'],
  'color-on-inverse': ['on-inverse'],
  'color-focus': ['color-focus'],
  'color-success': ['green', 'success'],
  'color-success-soft': ['success-soft'],
  'color-warning': ['orange', 'warning'],
  'color-warning-soft': ['warning-soft'],
  'color-danger': ['red', 'error', 'danger'],
  'color-danger-soft': ['danger-soft', 'error-c'],
  'color-var': ['var'],
  'color-var-soft': ['var-soft'],
  'method-get': ['method-get'],
  'method-post': ['method-post'],
  'method-put': ['method-put'],
  'method-patch': ['method-patch', 'purple'],
  'method-delete': ['method-delete'],
  'method-query': ['method-query'],
  'method-grpc': ['method-grpc'],
  'syntax-key': ['sk', 'sb'],
  'syntax-string': ['ss'],
  'syntax-number': ['sn'],
  'syntax-punct': ['syntax-punct', 'sp'],
};

/** `--name:value;…` for a theme's colours, as an inline style or the body of a CSS rule. */
export function themeCssText(colors: ThemeColors): string {
  const out: string[] = [];
  for (const token of THEME_TOKENS) {
    const v = colors[token];
    if (!isHexColor(v)) continue;
    for (const name of CSS_VARS[token]) out.push(`--${name}:${v}`);
    if (token === 'color-focus') out.push(`--focus-ring:0 0 0 3px ${v}`);
  }
  return out.join(';');
}

/** The user themes (`customThemes.list`). Cached in localStorage so main.ts can apply one before the
 *  disk read (`loadCustomThemes`) finishes, without a flash. */
class CustomThemes {
  #list = $state.raw<CustomTheme[]>(readCache());

  get list(): CustomTheme[] {
    return this.#list;
  }

  set list(v: CustomTheme[]) {
    this.#list = v;
    try {
      globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(v));
    } catch {
      /* no storage — ignore */
    }
  }

  /** Add or replace (same slug). */
  put(t: CustomTheme): void {
    this.list = [...this.#list.filter((x) => x.slug !== t.slug), t].sort((a, b) => a.slug.localeCompare(b.slug));
  }
}

const CACHE_KEY = 'bonk.customThemes';
function readCache(): CustomTheme[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? '[]') as CustomTheme[];
    return Array.isArray(raw) ? raw.flatMap((t) => parseCustomTheme(t?.slug, serializeCustomTheme(t)) ?? []) : [];
  } catch {
    return [];
  }
}

export const customThemes = new CustomThemes();

/** Read ~/.bonk/themes. Files that aren't themes are skipped. */
export async function loadCustomThemes(): Promise<void> {
  const files = await themesList();
  customThemes.list = files.flatMap((f) => parseCustomTheme(f.slug, f.text) ?? []);
}
