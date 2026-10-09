import { persisted } from '../persist';

/** App preferences from Settings → Общие / Внешний вид (S32.1, S32.5). Self-persisting. */

export type UiLanguage = 'ru' | 'en';
export const uiLanguage = persisted<UiLanguage>('uiLanguage', 'ru', (v): v is UiLanguage => v === 'ru' || v === 'en');
/** What a launch restores: the last open tabs, or an empty window. */
export const startupOpen = persisted<'last' | 'empty'>('startupOpen', 'last', (v): v is 'last' | 'empty' => v === 'last' || v === 'empty');
export const autoUpdateCheck = persisted('autoUpdateCheck', true);
/** Off: opening a saved request reuses the active tab when it has no unsaved changes. */
export const openInNewTab = persisted('openInNewTab', true);
export const confirmCloseUnsaved = persisted('confirmCloseUnsaved', true);

export const UI_FONT_SIZES = [12, 13, 14] as const;
export const uiFontSize = persisted<number>('uiFontSize', 13, (v): v is number => UI_FONT_SIZES.includes(v as 12));
export const CODE_FONTS = ['JetBrains Mono', 'SF Mono', 'Menlo', 'Fira Code'] as const;
export const codeFont = persisted<string>('codeFont', 'JetBrains Mono');
export const codeFontSize = persisted<number>('codeFontSize', 12);
export type Density = 'compact' | 'normal';
export const density = persisted<Density>('density', 'normal', (v): v is Density => v === 'compact' || v === 'normal');
/** «Как в системе»: follow the OS light/dark appearance with the Bonk palettes. */
export const themeFollowSystem = persisted('themeFollowSystem', false);
