import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { theme, setTheme, isDarkTheme, DEFAULT_THEME, shapeOf, fontOf, shapePref, fontPref } from './theme.svelte';

describe('theme', () => {
  beforeEach(() => setTheme(DEFAULT_THEME));

  it('defaults to Bonk Light', () => {
    expect(DEFAULT_THEME).toBe('smooth-light');
    expect(theme.current).toBe('smooth-light');
  });

  it('setTheme sets the value', () => {
    setTheme('smooth-dark');
    expect(theme.current).toBe('smooth-dark');
    expect(isDarkTheme('smooth-dark')).toBe(true);
    expect(isDarkTheme('smooth-light')).toBe(false);
  });

  it('shape and UI font follow the theme until picked', () => {
    shapePref.current = 'theme';
    fontPref.current = 'theme';
    expect([shapeOf('gruvbox-dark'), fontOf('gruvbox-dark')]).toEqual(['square', 'mono']);
    expect([shapeOf('nord'), fontOf('nord')]).toEqual(['sharp', 'sans']);
    shapePref.current = 'soft';
    fontPref.current = 'sans';
    expect([shapeOf('gruvbox-dark'), fontOf('gruvbox-dark')]).toEqual(['soft', 'sans']);
  });
});

describe('theme before settings.json is read', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function storedTheme(value: string): void {
    const values = new Map([['bonk.theme', value]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, next: string) => values.set(key, next),
    });
    vi.resetModules();
  }

  it.each([
    ['smooth-light', 'smooth-light'],
    ['smooth-dark', 'smooth-dark'],
    ['light', 'smooth-light'],
    ['postman-light', 'smooth-light'],
    ['nope', 'smooth-light'],
    ['dark', 'smooth-dark'],
    ['postman-dark', 'smooth-dark'],
    ['nord', 'nord'],
    ['gruvbox-dark', 'gruvbox-dark'],
    ['tokyo-night', 'smooth-dark'],
    ['ayu-mirage', 'smooth-dark'],
    ['rose-pine', 'smooth-dark'],
  ])('maps a stored %s to %s', async (stored, expected) => {
    storedTheme(stored);
    const fresh = await import('./theme.svelte');
    expect(fresh.theme.current).toBe(expected);
  });
});
