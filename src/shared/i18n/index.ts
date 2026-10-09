// Public API of shared/i18n (like the exported names of a Go package).
// Code outside src/shared/i18n/ imports only from here; files inside use relative paths.

export { en, plural, ru, t, tp, type Translate } from './i18n';
export { uiLanguage, type UiLanguage, watchDocumentLang } from './language.svelte';
