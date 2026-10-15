import { expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async (cmd: string) => (cmd === 'app_state_load' ? {} : null)));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { settingsFile } from '$shared/persist';
import { customThemes } from './customThemes.svelte';
import { deleteCustomTheme, systemDarkTheme, systemLightTheme } from './prefs';
import { theme } from './theme.svelte';

it('deleting a user theme falls back to Bonk Dark / Light wherever it was used', async () => {
  await settingsFile.load();
  customThemes.list = [{ slug: 'rose-pine', name: 'Rosé Pine', dark: true, colors: {} }];
  theme.current = 'custom:rose-pine';
  systemDarkTheme.current = 'custom:rose-pine';
  systemLightTheme.current = 'solarized-light';

  await deleteCustomTheme('rose-pine');

  expect(invoke).toHaveBeenCalledWith('theme_delete', { slug: 'rose-pine' });
  expect(customThemes.list).toEqual([]);
  expect(theme.current).toBe('smooth-dark');
  expect(systemDarkTheme.current).toBe('smooth-dark');
  expect(systemLightTheme.current).toBe('solarized-light');
});
