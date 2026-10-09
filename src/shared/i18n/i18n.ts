import { derived, get } from 'svelte/store';
import { uiLanguage, type UiLanguage } from './language';
import * as common from './common';
import * as app from './app';
import * as nav from './nav';
import * as request from './request';
import * as grpcgit from './grpcgit';
import * as flow from './flow';
import * as shell from './shell';
import * as largebody from './largebody';
// Each area owns a part file in ./i18n/ exporting `ru` and `en: Record<keyof typeof ru, string>`
// (so a missing key is a type error); they are merged below.
const parts = [common, app, nav, request, grpcgit, flow, shell, largebody];

export const ru = Object.assign({}, ...parts.map((p) => p.ru)) as Record<string, string> & (typeof common)['ru'];
export const en = Object.assign({}, ...parts.map((p) => p.en)) as Record<string, string> & (typeof common)['en'];
export type MsgKey = string;

const dicts: Record<UiLanguage, Record<string, string>> = { ru, en };

export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

function make(lang: UiLanguage): Translate {
  return (key, params) => {
    const s = dicts[lang][key] ?? ru[key] ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
  };
}

/** Reactive translator: `$t('settings.general.language')`, `$t('x', { n: 3 })` for `{n}`. In .ts modules use `get(t)(...)`. */
export const t = derived(uiLanguage, (l) => make(l));

/** Pick the plural form: ru takes [one, few, many] (1 файл / 2 файла / 5 файлов), en [one, other]. */
export function plural(
  n: number,
  forms: [string, string, string] | [string, string],
  lang: UiLanguage = get(uiLanguage),
): string {
  const a = Math.abs(n);
  if (lang === 'en' || forms.length === 2) return a === 1 ? forms[0] : forms[forms.length - 1];
  const m10 = a % 10,
    m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** Reactive plural: `$tp(n, ['файл','файла','файлов'], ['file','files'])` → forms chosen by current language. */
export const tp = derived(
  uiLanguage,
  (l) => (n: number, ru: [string, string, string], en: [string, string]) => plural(n, l === 'ru' ? ru : en, l),
);

if (typeof document !== 'undefined')
  uiLanguage.subscribe((l) => {
    document.documentElement.lang = l;
  });
