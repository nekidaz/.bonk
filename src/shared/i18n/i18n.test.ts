import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
// node env: stub the document so i18n can set <html lang>
vi.hoisted(() => {
  (globalThis as any).document = { documentElement: { lang: '' } };
});

import { t, tp, plural, ru, en } from './i18n';
import { uiLanguage } from './language';

describe('i18n', () => {
  it('en and ru have identical keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('no empty values and {params} match between languages', () => {
    const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(ru)) {
      expect(ru[k], k).not.toBe('');
      expect(en[k], k).not.toBe('');
      expect(params(en[k]), k).toEqual(params(ru[k]));
    }
  });

  it('every key used in source exists', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f) && !p.includes('/i18n')) files.push(p);
      }
    };
    walk('src');
    const used = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(
        /(?<![\w.])(?:\$t|\$tp|get\(t\)|tr)\(\s*'([a-z][\w]*(?:\.[\w-]+)+)'/g,
      ))
        used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in ru));
    expect(missing).toEqual([]);
  });

  it('interpolates and falls back to the key', () => {
    uiLanguage.set('en');
    expect(get(t)('missing.key.xyz')).toBe('missing.key.xyz');
    uiLanguage.set('ru');
  });

  it('switching uiLanguage changes output', () => {
    uiLanguage.set('ru');
    expect(get(t)('common.cancel')).toBe('Отмена');
    uiLanguage.set('en');
    expect(get(t)('common.cancel')).toBe('Cancel');
    expect(document.documentElement.lang).toBe('en');
    uiLanguage.set('ru');
    expect(document.documentElement.lang).toBe('ru');
  });

  it('plural forms', () => {
    const f: [string, string, string] = ['запись', 'записи', 'записей'];
    expect([1, 2, 5, 11, 21, 24, 112].map((n) => plural(n, f, 'ru'))).toEqual([
      'запись',
      'записи',
      'записей',
      'записей',
      'запись',
      'записи',
      'записей',
    ]);
    expect(plural(1, ['entry', 'entries'], 'en')).toBe('entry');
    expect(plural(2, ['entry', 'entries'], 'en')).toBe('entries');
    uiLanguage.set('en');
    expect(get(tp)(3, f, ['entry', 'entries'])).toBe('entries');
    uiLanguage.set('ru');
  });
});
