import { uiLanguage, type UiLanguage } from './language.svelte';
import * as common from './common';
import * as app from './app';
import * as nav from './nav';
import * as request from './request';
import * as grpcgit from './grpcgit';
import * as runner from './runner';
import * as shell from './shell';
import * as utility from './utility';
import * as largebody from './largebody';
import * as scripts from './scripts';
import * as cookies from './cookies';
import * as importer from './importer';
import * as dynamic from './dynamic';
import * as inputs from './inputs';
// Each area owns a part file in ./i18n/ exporting `ru` and `en: Record<keyof typeof ru, string>`
// (so a missing key is a type error); they are merged below.
const parts = [
  common,
  app,
  nav,
  request,
  grpcgit,
  runner,
  shell,
  utility,
  largebody,
  scripts,
  cookies,
  importer,
  dynamic,
  inputs,
];

export const ru = Object.assign({}, ...parts.map((p) => p.ru)) as Record<string, string> & (typeof common)['ru'];
export const en = Object.assign({}, ...parts.map((p) => p.en)) as Record<string, string> & (typeof common)['en'];
export type MsgKey = string;

const dicts: Record<UiLanguage, Record<string, string>> = { ru, en };

export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

/**
 * Translate: `t('settings.general.language')`, `t('x', { n: 3 })` for `{n}`. A plain function that
 * reads the current language, so a template (or $derived) calling it re-renders on a language switch.
 */
export const t: Translate = (key, params) => {
  const s = dicts[uiLanguage.current][key] ?? ru[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
};

/** Pick the plural form: ru takes [one, few, many] (1 файл / 2 файла / 5 файлов), en [one, other]. */
export function plural(
  n: number,
  forms: [string, string, string] | [string, string],
  lang: UiLanguage = uiLanguage.current,
): string {
  const a = Math.abs(n);
  if (lang === 'en' || forms.length === 2) return a === 1 ? forms[0] : forms[forms.length - 1];
  const m10 = a % 10,
    m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** Plural in the current language: `tp(n, ['файл','файла','файлов'], ['file','files'])`. */
export const tp = (n: number, ru: [string, string, string], en: [string, string]): string =>
  plural(n, uiLanguage.current === 'ru' ? ru : en, uiLanguage.current);
