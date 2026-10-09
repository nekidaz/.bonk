import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  theme,
  setTheme,
  toggleTheme,
  nextTheme,
  isTheme,
  isDarkTheme,
  themeLabel,
  DEFAULT_THEME,
  THEME_OPTIONS,
} from './theme';

describe('theme', () => {
  beforeEach(() => setTheme(DEFAULT_THEME));

  it('defaults to Bonk Light', () => {
    expect(DEFAULT_THEME).toBe('smooth-light');
    expect(get(theme)).toBe('smooth-light');
  });

  it('nextTheme cycles through every palette', () => {
    expect(nextTheme('smooth-light')).toBe('smooth-dark');
    expect(nextTheme('smooth-dark')).toBe('postman-light');
    expect(nextTheme('postman-light')).toBe('postman-dark');
    expect(nextTheme('postman-dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('nord');
    expect(nextTheme('rose-pine')).toBe('smooth-light');
  });

  it('toggleTheme advances the store value', () => {
    setTheme('light');
    toggleTheme();
    expect(get(theme)).toBe('dark');
    toggleTheme();
    expect(get(theme)).toBe('nord');
  });

  it('setTheme sets the value', () => {
    setTheme('dark');
    expect(get(theme)).toBe('dark');
  });

  it('isTheme guards valid values', () => {
    for (const option of THEME_OPTIONS) expect(isTheme(option.value)).toBe(true);
    expect(isTheme('nope')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('exposes palette metadata', () => {
    expect(themeLabel('tokyo-night')).toBe('Tokyo Night');
    expect(isDarkTheme('light')).toBe(false);
    expect(isDarkTheme('postman-dark')).toBe(true);
    expect(isDarkTheme('ayu-mirage')).toBe(true);
  });
});


describe('persisted theme upgrades', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function storedTheme(value: string, version?: string): Map<string, string> {
    const values = new Map([['bonk.theme', value]]);
    if (version) values.set('bonk.theme.version', version);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, next: string) => values.set(key, next),
    });
    vi.resetModules();
    return values;
  }

  it.each([['light', 'smooth-light'], ['dark', 'smooth-dark'], ['postman-light', 'smooth-light'], ['postman-dark', 'smooth-dark']])(
    'upgrades the old %s default to %s and persists it', async (oldTheme, expected) => {
      const values = storedTheme(oldTheme);
      const fresh = await import('./theme');
      expect(get(fresh.theme)).toBe(expected);
      expect(values.get('bonk.theme')).toBe(expected);
      expect(values.get('bonk.theme.version')).toBe('4');
    },
  );

  it('upgrades a palette persisted under the previous version', async () => {
    storedTheme('postman-dark', '3');
    const fresh = await import('./theme');
    expect(get(fresh.theme)).toBe('smooth-dark');
  });

  it('preserves an explicitly selected legacy palette after a restart', async () => {
    storedTheme('dark');
    const fresh = await import('./theme');
    fresh.setTheme('light');
    vi.resetModules();
    const restarted = await import('./theme');
    expect(get(restarted.theme)).toBe('light');
  });

  it.each(['nord', 'tokyo-night', 'ayu-mirage', 'rose-pine', 'smooth-light', 'smooth-dark'])(
    'preserves the existing %s palette', async (value) => {
      storedTheme(value);
      const fresh = await import('./theme');
      expect(get(fresh.theme)).toBe(value);
    },
  );
});
