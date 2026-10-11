import { describe, expect, it } from 'vitest';
import { parseCustomTheme, serializeCustomTheme, themeCssText } from './customThemes.svelte';

describe('custom theme files', () => {
  it('round-trips and drops what could break out of the CSS rule', () => {
    const t = { slug: 'rose-pine', name: 'Rosé Pine', dark: true, colors: { 'color-app': '#191724' } };
    expect(parseCustomTheme('rose-pine', serializeCustomTheme(t))).toEqual(t);

    const evil = JSON.stringify({
      name: 'x',
      appearance: 'light',
      colors: { 'color-app': 'red}body{x:y', nope: '#fff' },
    });
    expect(parseCustomTheme('x', evil)).toEqual({ slug: 'x', name: 'x', dark: false, colors: {} });
    expect(parseCustomTheme('../x', serializeCustomTheme(t))).toBeNull();
    expect(parseCustomTheme('x', '{}')).toBeNull();
  });

  it('feeds every tokens.css name of a token', () => {
    expect(themeCssText({ 'color-app': '#111111', 'color-focus': '#ff000040' })).toBe(
      '--bg:#111111;--tb:#111111;--color-focus:#ff000040;--focus-ring:0 0 0 3px #ff000040',
    );
  });
});
