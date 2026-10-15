import { expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { flushPendingSaves } from './persist';
import { setting, settingsFile } from './settings.svelte';

const calls = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd).map(([, args]) => args);
const settle = () => new Promise((r) => setTimeout(r, 400)); // past the file's write debounce

it('moves settings out of state.json, keeps only non-defaults, mirrors back, never overwrites a broken file', async () => {
  let file: string | null = null;
  invoke.mockImplementation(async (cmd: string, args?: { text: string }) => {
    if (cmd === 'app_state_load') return { uiFontSize: 14, proxyUrl: 'http://p', tabs: [] };
    if (cmd === 'settings_file_read') return file;
    if (cmd === 'settings_file_write') file = args!.text;
    return null;
  });
  const size = setting('ui.fontSize', 'uiFontSize', 13);
  const proxy = setting('proxy.url', 'proxyUrl', '');
  const wrap = setting('response.lineWrap', 'responseLineWrap', true);

  // First run: the file is made from state.json, defaults left out.
  await settingsFile.load();
  expect(JSON.parse(file!)).toEqual({ 'ui.fontSize': 14, 'proxy.url': 'http://p' });
  expect([size.current, proxy.current, wrap.current]).toEqual([14, 'http://p', true]);

  // A change from the Settings window: back to the default drops the key; state.json gets the value.
  size.current = 13;
  await settle();
  await flushPendingSaves();
  expect(JSON.parse(file!)).toEqual({ 'proxy.url': 'http://p' });
  expect(calls('app_state_set')).toContainEqual({ key: 'uiFontSize', value: 13 });

  // An edit in another editor: picked up; a value of the wrong type reads as the default.
  file = '{ "proxy.url": 5, "response.lineWrap": false, "someday": 1 }';
  await settingsFile.reload();
  expect([proxy.current, wrap.current]).toEqual(['', false]);

  // A broken file keeps the last good values and isn't written over.
  file = '{ "ui.fontSize": 12,';
  await settingsFile.reload();
  expect(settingsFile.error).not.toBe('');
  expect(wrap.current).toBe(false);
  size.current = 14;
  await settle();
  expect(file).toBe('{ "ui.fontSize": 12,');
  expect(settingsFile.unsaved).toBe(true);

  // Saved from the settings.json tab: written as typed and applied.
  await settingsFile.saveText('{\n  "ui.fontSize": 12\n}\n');
  expect([settingsFile.error, size.current, wrap.current]).toEqual(['', 12, true]);
  expect(file).toBe('{\n  "ui.fontSize": 12\n}\n');
});
