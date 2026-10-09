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
export const density = persisted<Density>('density', 'compact', (v): v is Density => v === 'compact' || v === 'normal');
/** «Как в системе»: follow the OS light/dark appearance with the Bonk palettes. */
export const themeFollowSystem = persisted('themeFollowSystem', false);

// Settings → Внешний вид → «Раскладка запроса и ответа» (S32.5b, E1–E7).
/** stack: request above, response below · side: side by side · focus: the pane in use fills, the other folds into a strip. */
export type RequestLayout = 'stack' | 'side' | 'focus';
export const requestLayout = persisted<RequestLayout>('requestLayout', 'stack', (v): v is RequestLayout => v === 'stack' || v === 'side' || v === 'focus');
/** After a response arrives: leave the panes alone, or give the response the height (request folds into its strip). */
export type AfterSend = 'keep' | 'expand';
export const afterSend = persisted<AfterSend>('afterSend', 'keep', (v): v is AfterSend => v === 'keep' || v === 'expand');
/** From SIDE_BY_SIDE_MIN px wide the request and response sit side by side whatever the layout above says.
 *  Off by default so the chosen layout wins; new key because the old `true` default was written to every install. */
export const sideOnWide = persisted('sideOnWideOptIn', false);
export const SIDE_BY_SIDE_MIN = 1440;
/** Arrays longer than this show only their first/last items; the middle folds into a «ещё N объектов» chip. */
export const FOLD_ARRAYS_MIN = 5;
export const FOLD_ARRAYS_MAX = 10_000;
export const foldArraysOver = persisted<number>('foldArraysOver', 50, (v): v is number => Number.isInteger(v) && (v as number) >= FOLD_ARRAYS_MIN && (v as number) <= FOLD_ARRAYS_MAX);
