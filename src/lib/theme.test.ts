import { describe, it, expect, beforeEach } from 'vitest';
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

  it('defaults to light', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(get(theme)).toBe('light');
  });

  it('nextTheme cycles through every palette', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('nord');
    expect(nextTheme('rose-pine')).toBe('light');
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
    expect(isDarkTheme('ayu-mirage')).toBe(true);
  });
});
