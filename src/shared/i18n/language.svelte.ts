import { persisted } from '$shared/persist';

/** UI language (Settings → Общие). Lives in i18n so the translator needs nothing from higher layers. */
export type UiLanguage = 'ru' | 'en';
export const uiLanguage = persisted<UiLanguage>('uiLanguage', 'ru', (v): v is UiLanguage => v === 'ru' || v === 'en');

/** Keep `<html lang>` equal to the UI language. Started once by the app; returns a stop function. */
export function watchDocumentLang(): () => void {
  return $effect.root(() => {
    $effect(() => {
      document.documentElement.lang = uiLanguage.current;
    });
  });
}
