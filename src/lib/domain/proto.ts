import { get } from 'svelte/store';
import { plural } from '../i18n';
import { uiLanguage } from '../stores/prefs';

/** Russian plural form: one (1, 21…), few (2–4, 22…), many (0, 5–20…). */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Language-aware counters (read the language at call time; use the reactive `$tp` in templates when live switching matters).
const count = (n: number, ru: [string, string, string], en: [string, string]): string =>
  `${n} ${plural(n, get(uiLanguage) === 'ru' ? ru : en)}`;
export const ruServices = (n: number): string => count(n, ['сервис', 'сервиса', 'сервисов'], ['service', 'services']);
export const ruMethods = (n: number): string => count(n, ['метод', 'метода', 'методов'], ['method', 'methods']);
export const ruFiles = (n: number): string => count(n, ['файл', 'файла', 'файлов'], ['file', 'files']);

/** Replace a leading home directory with `~`. */
export function abbrevHome(path: string, home: string): string {
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path;
}
