import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { theme, setTheme, toggleTheme, nextTheme, isTheme, DEFAULT_THEME } from './theme';

describe('theme', () => {
  beforeEach(() => setTheme(DEFAULT_THEME));

  it('defaults to light', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(get(theme)).toBe('light');
  });

  it('nextTheme flips light <-> dark', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });

  it('toggleTheme flips the store value', () => {
    setTheme('light');
    toggleTheme();
    expect(get(theme)).toBe('dark');
    toggleTheme();
    expect(get(theme)).toBe('light');
  });

  it('setTheme sets the value', () => {
    setTheme('dark');
    expect(get(theme)).toBe('dark');
  });

  it('isTheme guards valid values', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('nope')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
