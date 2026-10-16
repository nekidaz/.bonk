import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { t, tp, en } from './i18n';

describe('i18n', () => {
  it('no empty values', () => {
    for (const k of Object.keys(en)) expect(en[k], k).not.toBe('');
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
      for (const m of readFileSync(f, 'utf8').matchAll(/(?<![\w.])(?:t|tp|tr|i18nT)\(\s*'([a-z][\w]*(?:\.[\w-]+)+)'/g))
        used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('interpolates and falls back to the key', () => {
    expect(t('missing.key.xyz')).toBe('missing.key.xyz');
    expect(t('common.cancel')).toBe('Cancel');
  });

  it('plural forms', () => {
    expect([0, 1, 2, -1].map((n) => tp(n, ['entry', 'entries']))).toEqual(['entries', 'entry', 'entries', 'entry']);
  });
});
