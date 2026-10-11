/** Flow · Темы TH3: a Zed theme family or a VS Code colour theme → bonk's colour tokens. Each token takes
 *  the first key the theme has; a few more are computed from those (hover, soft tints…); the rest stay
 *  Bonk Dark / Light (the theme's base). */
import { isHexColor, THEME_TOKENS, type ThemeColors, type ThemeToken } from '$shared/settings';

export type ThemeSource = 'zed' | 'vscode';
/** One token of the mapping table; `key` null = computed from other tokens. */
export interface ImportRow {
  token: ThemeToken;
  key: string | null;
  color: string;
}
export interface ImportedVariant {
  name: string;
  dark: boolean;
  colors: ThemeColors;
  rows: ImportRow[];
  /** Tokens left to the base theme. */
  missing: ThemeToken[];
}
export interface ImportedThemeFile {
  source: ThemeSource;
  variants: ImportedVariant[];
}
/** Thrown with `code` 'json' (not JSON) or 'format' (neither Zed nor VS Code). */
export class ThemeImportError extends Error {
  constructor(readonly code: 'json' | 'format') {
    super(code);
  }
}

type Keys = Partial<Record<ThemeToken, string[]>>;
// Zed: style keys; `syntax.x` is style.syntax.x.color.
const ZED: Keys = {
  'color-app': ['background'],
  'color-panel': ['editor.background', 'surface.background'],
  'color-raised': ['elevated_surface.background', 'surface.background'],
  'color-field': ['element.background'],
  'color-sidebar': ['panel.background', 'surface.background'],
  'color-text': ['text', 'editor.foreground'],
  'color-text-muted': ['text.muted'],
  'color-border': ['border'],
  'color-border-subtle': ['border.variant'],
  'color-action': ['text.accent', 'icon.accent'],
  'color-selected': ['element.selected', 'ghost_element.selected'],
  'color-hover': ['element.hover', 'ghost_element.hover'],
  'color-hover-strong': ['element.active'],
  'color-success': ['created', 'success'],
  'color-warning': ['warning', 'modified'],
  'color-danger': ['error', 'deleted'],
  'color-var': ['syntax.constant', 'terminal.ansi.cyan'],
  'method-get': ['terminal.ansi.blue'],
  'method-post': ['terminal.ansi.green'],
  'method-put': ['terminal.ansi.yellow'],
  'method-patch': ['terminal.ansi.magenta'],
  'method-delete': ['terminal.ansi.red'],
  'method-query': ['terminal.ansi.cyan'],
  'method-grpc': ['syntax.keyword', 'terminal.ansi.bright_magenta'],
  'syntax-key': ['syntax.property'],
  'syntax-string': ['syntax.string'],
  'syntax-number': ['syntax.number', 'syntax.constant'],
  'syntax-punct': ['syntax.punctuation'],
};
// VS Code: `colors` keys; `scope:x` is the tokenColors rule for TextMate scope x.
const VSCODE: Keys = {
  'color-app': ['titleBar.activeBackground', 'activityBar.background', 'sideBar.background', 'editor.background'],
  'color-panel': ['editor.background'],
  'color-raised': ['editorWidget.background', 'dropdown.background', 'menu.background'],
  'color-field': ['input.background'],
  'color-sidebar': ['sideBar.background'],
  'color-text': ['editor.foreground', 'foreground'],
  'color-text-secondary': ['descriptionForeground', 'sideBar.foreground'],
  'color-text-muted': ['editorLineNumber.foreground', 'disabledForeground'],
  'color-border': ['panel.border', 'editorGroup.border', 'sideBar.border', 'contrastBorder'],
  'color-border-subtle': ['editorIndentGuide.background', 'editorIndentGuide.background1'],
  'color-action': ['button.background', 'focusBorder', 'textLink.foreground'],
  'color-action-hover': ['button.hoverBackground'],
  'color-on-action': ['button.foreground'],
  'color-selected': ['list.activeSelectionBackground', 'list.inactiveSelectionBackground'],
  'color-hover': ['list.hoverBackground'],
  'color-success': ['gitDecoration.addedResourceForeground', 'terminal.ansiGreen'],
  'color-warning': ['editorWarning.foreground', 'list.warningForeground'],
  'color-danger': ['editorError.foreground', 'errorForeground'],
  'color-var': ['scope:variable', 'terminal.ansiCyan'],
  'method-get': ['terminal.ansiBlue'],
  'method-post': ['terminal.ansiGreen'],
  'method-put': ['terminal.ansiYellow'],
  'method-patch': ['terminal.ansiMagenta'],
  'method-delete': ['terminal.ansiRed'],
  'method-query': ['terminal.ansiCyan'],
  'method-grpc': ['scope:keyword', 'terminal.ansiBrightMagenta'],
  'syntax-key': ['scope:support.type.property-name', 'scope:variable.other.property', 'scope:entity.name.tag'],
  'syntax-string': ['scope:string'],
  'syntax-number': ['scope:constant.numeric'],
  'syntax-punct': ['scope:punctuation'],
};

// ---- colour math on #rrggbb (alpha dropped where a solid colour is needed) ----
function rgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** `a` moved towards `b` by `w` (0…1). */
const mix = (a: string, b: string, w: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * w));
};
/** `c` at alpha `aa` (two hex digits). */
const alpha = (c: string, aa: string) => toHex(rgb(c)) + aa;
const luminance = (c: string) => {
  const [r, g, b] = rgb(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

type Derive = (c: ThemeColors, dark: boolean) => string | undefined;
const all = (...v: (string | undefined)[]): boolean => v.every(Boolean);
// In order: later rules may use tokens earlier ones computed.
const DERIVED: [ThemeToken, Derive][] = [
  [
    'color-text-muted',
    (c) => (all(c['color-text'], c['color-panel']) ? mix(c['color-text']!, c['color-panel']!, 0.45) : undefined),
  ],
  [
    'color-text-secondary',
    (c) =>
      all(c['color-text'], c['color-text-muted']) ? mix(c['color-text']!, c['color-text-muted']!, 0.5) : undefined,
  ],
  ['color-app', (c) => c['color-panel']],
  ['color-sidebar', (c) => c['color-panel']],
  ['color-field', (c) => c['color-app']],
  [
    'color-raised',
    (c) => (all(c['color-panel'], c['color-text']) ? mix(c['color-panel']!, c['color-text']!, 0.06) : undefined),
  ],
  [
    'color-border-subtle',
    (c) => (all(c['color-border'], c['color-panel']) ? mix(c['color-border']!, c['color-panel']!, 0.5) : undefined),
  ],
  [
    'color-action-hover',
    (c) => (all(c['color-action'], c['color-text']) ? mix(c['color-action']!, c['color-text']!, 0.15) : undefined),
  ],
  [
    'color-action-press',
    (c) => (all(c['color-action'], c['color-app']) ? mix(c['color-action']!, c['color-app']!, 0.15) : undefined),
  ],
  [
    'color-on-action',
    (c) => {
      const [a, bg, fg] = [c['color-action'], c['color-app'], c['color-text']];
      if (!all(a, bg, fg)) return undefined;
      const l = luminance(a!);
      return Math.abs(l - luminance(bg!)) > Math.abs(l - luminance(fg!)) ? toHex(rgb(bg!)) : toHex(rgb(fg!));
    },
  ],
  [
    'color-selected',
    (c) => (all(c['color-panel'], c['color-text']) ? mix(c['color-panel']!, c['color-text']!, 0.1) : undefined),
  ],
  ['color-hover', (c) => c['color-text'] && alpha(c['color-text'], '12')],
  ['color-hover-strong', (c) => c['color-text'] && alpha(c['color-text'], '21')],
  ['color-canvas', (c, dark) => c['color-app'] && mix(c['color-app'], '#000000', dark ? 0.3 : 0.05)],
  ['color-inverse', (c) => c['color-text']],
  ['color-on-inverse', (c) => c['color-panel']],
  ['color-focus', (c) => c['color-action'] && alpha(c['color-action'], '40')],
  ['color-success-soft', (c) => c['color-success'] && alpha(c['color-success'], '22')],
  ['color-warning-soft', (c) => c['color-warning'] && alpha(c['color-warning'], '22')],
  ['color-danger-soft', (c) => c['color-danger'] && alpha(c['color-danger'], '22')],
  ['color-var-soft', (c) => c['color-var'] && alpha(c['color-var'], '22')],
];

function mapColors(keys: Keys, lookup: (key: string) => unknown, dark?: boolean): ImportedVariant {
  const colors: ThemeColors = {};
  const rows: ImportRow[] = [];
  for (const token of THEME_TOKENS) {
    for (const key of keys[token] ?? []) {
      const v = lookup(key);
      if (isHexColor(v)) {
        colors[token] = v;
        rows.push({ token, key, color: v });
        break;
      }
    }
  }
  const isDark = dark ?? (colors['color-panel'] ? luminance(colors['color-panel']) < 0.5 : true);
  for (const [token, derive] of DERIVED) {
    if (colors[token]) continue;
    const v = derive(colors, isDark);
    if (v) {
      colors[token] = v;
      rows.push({ token, key: null, color: v });
    }
  }
  rows.sort((a, b) => THEME_TOKENS.indexOf(a.token) - THEME_TOKENS.indexOf(b.token));
  return { name: '', dark: isDark, colors, rows, missing: THEME_TOKENS.filter((t) => !colors[t]) };
}

/** JSON with // and /* comments and trailing commas, as VS Code themes are often written. */
function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to the lenient pass */
  }
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += ch;
  }
  // ponytail: a ", }" inside a string value would lose its comma; no theme has one.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function zedVariant(t: Obj): ImportedVariant | null {
  const style = t.style;
  if (!isObj(style)) return null;
  const syntax = isObj(style.syntax) ? style.syntax : {};
  const lookup = (key: string) => {
    if (!key.startsWith('syntax.')) return style[key];
    const s = syntax[key.slice('syntax.'.length)];
    return isObj(s) ? s.color : undefined;
  };
  const appearance = t.appearance === 'light' ? false : t.appearance === 'dark' ? true : undefined;
  return { ...mapColors(ZED, lookup, appearance), name: typeof t.name === 'string' ? t.name : 'Zed theme' };
}

function vscodeVariant(raw: Obj, fileName: string): ImportedVariant {
  const colors = isObj(raw.colors) ? raw.colors : {};
  const rules = Array.isArray(raw.tokenColors) ? raw.tokenColors.filter(isObj) : [];
  const scopeColor = (scope: string) => {
    for (const r of rules) {
      const scopes = (Array.isArray(r.scope) ? r.scope : String(r.scope ?? '').split(',')).map((s) => String(s).trim());
      const fg = isObj(r.settings) ? r.settings.foreground : undefined;
      if (fg && scopes.some((s) => s === scope || s.startsWith(scope + '.'))) return fg;
    }
    return undefined;
  };
  const lookup = (key: string) => (key.startsWith('scope:') ? scopeColor(key.slice('scope:'.length)) : colors[key]);
  const type = typeof raw.type === 'string' ? raw.type : '';
  const dark = type ? !type.includes('light') : undefined;
  const name = typeof raw.name === 'string' && raw.name ? raw.name : fileName.replace(/(-color-theme)?\.jsonc?$/i, '');
  return { ...mapColors(VSCODE, lookup, dark), name };
}

/** Parse a theme file. Throws ThemeImportError. */
export function parseThemeFile(text: string, fileName: string): ImportedThemeFile {
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch {
    throw new ThemeImportError('json');
  }
  if (isObj(raw) && Array.isArray(raw.themes)) {
    const variants = raw.themes.filter(isObj).flatMap((t) => zedVariant(t) ?? []);
    if (variants.length) return { source: 'zed', variants };
  } else if (isObj(raw) && (isObj(raw.colors) || Array.isArray(raw.tokenColors))) {
    const v = vscodeVariant(raw, fileName);
    if (v.rows.length) return { source: 'vscode', variants: [v] };
  }
  throw new ThemeImportError('format');
}

/** File name for a theme: «Rosé Pine Moon» → rose-pine-moon. */
export function themeSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug || 'theme';
}
