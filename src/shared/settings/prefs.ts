import { setting } from '$shared/persist';
import { themeDelete } from '$shared/ipc';
import { customThemes } from './customThemes.svelte';
import { isDarkTheme, isTheme, theme, themeInfo, type Theme } from './theme.svelte';

/** App preferences from Settings → Общие / Внешний вид (S32.1, S32.5). Self-persisting. */

/** What a launch restores: the last open tabs, or an empty window. */
export const startupOpen = setting<'last' | 'empty'>(
  'app.startup',
  'startupOpen',
  'last',
  (v): v is 'last' | 'empty' => v === 'last' || v === 'empty',
);
export const autoUpdateCheck = setting('app.checkForUpdates', 'autoUpdateCheck', true);
/** Off: opening a saved request reuses the active tab when it has no unsaved changes. */
export const openInNewTab = setting('tabs.openInNewTab', 'openInNewTab', true);
export const confirmCloseUnsaved = setting('tabs.confirmCloseUnsaved', 'confirmCloseUnsaved', true);

export const UI_FONT_SIZES = [12, 13, 14] as const;
export const uiFontSize = setting<number>('ui.fontSize', 'uiFontSize', 13, (v): v is number =>
  UI_FONT_SIZES.includes(v as 12),
);
/** Whole-window zoom (⌘= / ⌘− / ⌘0), applied to the webview in app/lifecycle.svelte.ts. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const uiZoom = setting<number>(
  'ui.zoom',
  'uiZoom',
  1,
  (v): v is number => typeof v === 'number' && v >= ZOOM_MIN && v <= ZOOM_MAX,
);
/** Step the zoom by `d` (0 = reset), clamped and rounded so 0.1 steps don't drift. */
export function zoomBy(d: number): void {
  const z = d ? uiZoom.current + d : 1;
  uiZoom.current = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
}
export const CODE_FONTS = ['JetBrains Mono', 'SF Mono', 'Menlo', 'Fira Code'] as const;
export const codeFont = setting<string>('editor.fontFamily', 'codeFont', 'JetBrains Mono');
export const codeFontSize = setting<number>('editor.fontSize', 'codeFontSize', 12);
export type Density = 'compact' | 'normal';
export const density = setting<Density>(
  'ui.density',
  'density',
  'compact',
  (v): v is Density => v === 'compact' || v === 'normal',
);
/** «Как в системе»: follow the OS light/dark appearance with the pair below (app/lifecycle.svelte.ts). */
export const themeFollowSystem = setting('ui.theme.followSystem', 'themeFollowSystem', false);
export const systemLightTheme = setting<Theme>(
  'ui.theme.light',
  'themeLight',
  'smooth-light',
  (v): v is Theme => isTheme(v) && !isDarkTheme(v),
);
export const systemDarkTheme = setting<Theme>(
  'ui.theme.dark',
  'themeDark',
  'smooth-dark',
  (v): v is Theme => isTheme(v) && isDarkTheme(v),
);
/** An explicit pick (gallery, ⌘K) wins over «Как в системе». */
export function pickTheme(t: Theme): void {
  themeFollowSystem.current = false;
  theme.current = t;
}
/** Delete a user theme's file. Whatever used it falls back to Bonk Dark / Light. */
export async function deleteCustomTheme(slug: string): Promise<void> {
  await themeDelete(slug);
  const id: Theme = `custom:${slug}`;
  const base = themeInfo(id).base;
  // Before the list loses it: a setting naming a theme that isn't there reads as its default.
  if (theme.current === id) theme.current = base;
  if (systemLightTheme.current === id) systemLightTheme.current = 'smooth-light';
  if (systemDarkTheme.current === id) systemDarkTheme.current = 'smooth-dark';
  customThemes.list = customThemes.list.filter((x) => x.slug !== slug);
}

// Settings → Внешний вид → «Раскладка запроса и ответа» (S32.5b, E1–E7).
/** stack: request above, response below · side: side by side · focus: the pane in use fills, the other folds into a strip. */
export type RequestLayout = 'stack' | 'side' | 'focus';
export const requestLayout = setting<RequestLayout>(
  'layout.mode',
  'requestLayout',
  'stack',
  (v): v is RequestLayout => v === 'stack' || v === 'side' || v === 'focus',
);
/** After a response arrives: leave the panes alone, or give the response the height (request folds into its strip). */
export type AfterSend = 'keep' | 'expand';
export const afterSend = setting<AfterSend>(
  'layout.afterSend',
  'afterSend',
  'keep',
  (v): v is AfterSend => v === 'keep' || v === 'expand',
);
/** From SIDE_BY_SIDE_MIN px wide the request and response sit side by side whatever the layout above says.
 *  Off by default so the chosen layout wins; new key because the old `true` default was written to every install. */
export const sideOnWide = setting('layout.sideBySideWhenWide', 'sideOnWideOptIn', false);
export const SIDE_BY_SIDE_MIN = 1440;
/** Arrays longer than this show only their first/last items; the middle folds into a «ещё N объектов» chip. */
export const FOLD_ARRAYS_MIN = 5;
export const FOLD_ARRAYS_MAX = 10_000;
export const foldArraysOver = setting<number>(
  'response.foldArraysOver',
  'foldArraysOver',
  50,
  (v): v is number => Number.isInteger(v) && (v as number) >= FOLD_ARRAYS_MIN && (v as number) <= FOLD_ARRAYS_MAX,
);
