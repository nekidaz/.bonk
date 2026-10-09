import { persisted } from '$shared/persist';

/** UI language (Settings → Общие). Lives in i18n so the translator needs nothing from higher layers. */
export type UiLanguage = 'ru' | 'en';
export const uiLanguage = persisted<UiLanguage>('uiLanguage', 'ru', (v): v is UiLanguage => v === 'ru' || v === 'en');
