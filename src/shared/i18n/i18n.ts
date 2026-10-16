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
import * as session from './session';
import * as sessions from './sessions';
import * as sessionrun from './sessionrun';
import * as settingsfile from './settingsfile';
// Each area owns a part file in ./i18n/ exporting `en`; they are merged below.
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
  session,
  sessions,
  sessionrun,
  settingsfile,
];

export const en: Record<string, string> = Object.assign({}, ...parts.map((p) => p.en));

export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

/** Translate: `t('settings.general.app')`, `t('x', { n: 3 })` for `{n}`. Falls back to the key. */
export const t: Translate = (key, params) => {
  const s = en[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
};

/** Plural: `tp(n, ['file', 'files'])`. */
export const tp = (n: number, [one, other]: [string, string]): string => (Math.abs(n) === 1 ? one : other);
