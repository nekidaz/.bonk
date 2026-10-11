import { describe, expect, it } from 'vitest';
import { parseThemeFile, themeSlug, ThemeImportError } from './themeImport';

const zed = JSON.stringify({
  name: 'Rosé Pine',
  themes: [
    {
      name: 'Rosé Pine',
      appearance: 'dark',
      style: {
        background: '#191724',
        'editor.background': '#1f1d2e',
        text: '#e0def4',
        'text.muted': '#6e6a86',
        'text.accent': '#c4a7e7',
        border: '#403d52',
        error: '#eb6f92',
        'terminal.ansi.blue': '#9ccfd8',
        syntax: { property: { color: '#9ccfd8' }, string: { color: '#f6c177' } },
      },
    },
    { name: 'Rosé Pine Dawn', appearance: 'light', style: { background: '#faf4ed', text: '#575279' } },
    { name: 'broken' },
  ],
});

describe('parseThemeFile', () => {
  it('maps a Zed family, one variant per theme, and computes what it can', () => {
    const f = parseThemeFile(zed, 'rose-pine.json');
    expect(f.source).toBe('zed');
    expect(f.variants.map((v) => [v.name, v.dark])).toEqual([
      ['Rosé Pine', true],
      ['Rosé Pine Dawn', false],
    ]);
    const v = f.variants[0];
    const row = (token: string) => v.rows.find((r) => r.token === token);
    expect(row('color-app')).toEqual({ token: 'color-app', key: 'background', color: '#191724' });
    expect(row('syntax-key')).toEqual({ token: 'syntax-key', key: 'syntax.property', color: '#9ccfd8' });
    expect(row('color-text-secondary')).toEqual({ token: 'color-text-secondary', key: null, color: '#a7a4bd' });
    expect(v.colors['color-focus']).toBe('#c4a7e740');
    expect(v.colors['color-danger-soft']).toBe('#eb6f9222');
    // A light accent gets the dark background as its text.
    expect(v.colors['color-on-action']).toBe('#191724');
    expect(v.missing).toContain('method-post');
    expect(v.missing).not.toContain('color-app');
  });

  it('reads a VS Code theme written as JSONC, with tokenColors scopes', () => {
    const text = `{
      // Night Owl, trimmed
      "name": "Night Owl",
      "type": "dark",
      "colors": {
        "editor.background": "#011627",
        "editor.foreground": "#d6deeb", /* main text */
        "button.background": "#7e57c2",
        "$schema": "vscode://schemas/color-theme",
      },
      "tokenColors": [
        { "scope": "string.quoted, string.template", "settings": { "foreground": "#ecc48d" } },
        { "scope": ["support.type.property-name.json"], "settings": { "foreground": "#7fdbca" } },
      ],
    }`;
    const [v] = parseThemeFile(text, 'night-owl-color-theme.json').variants;
    expect(v.name).toBe('Night Owl');
    expect(v.dark).toBe(true);
    expect(v.colors['color-panel']).toBe('#011627');
    expect(v.colors['color-app']).toBe('#011627');
    expect(v.colors['syntax-string']).toBe('#ecc48d');
    expect(v.colors['syntax-key']).toBe('#7fdbca');
    expect(v.colors['color-on-action']).toBe('#d6deeb');
  });

  it('refuses what is not a theme', () => {
    const code = (text: string) => {
      try {
        parseThemeFile(text, 'x.json');
      } catch (e) {
        return e instanceof ThemeImportError ? e.code : 'other';
      }
      return 'ok';
    };
    expect(code('not json')).toBe('json');
    expect(code('{"openapi":"3.1.0"}')).toBe('format');
    expect(code('{"themes":[{"name":"x"}]}')).toBe('format');
    expect(code('{"colors":{"editor.background":"red; } body {"}}')).toBe('format');
  });
});

describe('themeSlug', () => {
  it.each([
    ['Rosé Pine Moon', 'rose-pine-moon'],
    ['  One Dark Pro (Flat)!', 'one-dark-pro-flat'],
    ['Тема', 'theme'],
  ])('%s → %s', (name, slug) => expect(themeSlug(name)).toBe(slug));
});
