// Public API of shared/settings (like the exported names of a Go package).
// Code outside src/shared/settings/ imports only from here; files inside use relative paths.

export { hotkeyOverrides, hotkeys, resetAllBindings, resetBinding, setBinding } from './hotkeyPrefs.svelte';
export { commandFor, eventToBinding, findConflicts, formatBinding, HOTKEY_COMMANDS, HOTKEY_GROUPS } from './hotkeys';
export {
  activeClientCerts,
  clientCerts,
  currentGrpcPrefs,
  forgetP12Password,
  grpcEmitDefaults,
  grpcImportPaths,
  grpcInt64AsNumber,
  grpcKeepaliveSecs,
  grpcMaxMessageMb,
  grpcTlsFor,
  p12Passwords,
  proxyAuth,
  proxyPassword,
  proxyUser,
  setP12Password,
  trustSystemCas,
  withGlobalImports,
} from './netPrefs.svelte';
export {
  afterSend,
  type AfterSend,
  autoUpdateCheck,
  CODE_FONTS,
  codeFont,
  codeFontSize,
  confirmCloseUnsaved,
  density,
  type Density,
  FOLD_ARRAYS_MAX,
  FOLD_ARRAYS_MIN,
  foldArraysOver,
  openInNewTab,
  requestLayout,
  type RequestLayout,
  SIDE_BY_SIDE_MIN,
  sideOnWide,
  startupOpen,
  deleteCustomTheme,
  pickTheme,
  systemDarkTheme,
  systemLightTheme,
  themeFollowSystem,
  UI_FONT_SIZES,
  uiFontSize,
} from './prefs';
export { fileName, type HostCert, proxyUrlError } from './proxy';
export {
  cookieJarScope,
  type CookieJarScope,
  cookiesExclude,
  cookiesKeepSession,
  cookiesSave,
  cookiesSend,
} from './cookiePrefs.svelte';
export { requestPrefs } from './requestPrefs.svelte';
export {
  allThemes,
  applyAppearance,
  applyStoredTheme,
  fontOf,
  fontPref,
  isDarkTheme,
  setTheme,
  shapeOf,
  shapePref,
  SHAPES,
  type Shape,
  theme,
  type Theme,
  themeInfo,
  type ThemeInfo,
  THEMES,
  type UiFont,
} from './theme.svelte';
export { dynamicOptions, dynKeepSent, dynLocale, dynPerRequest, dynSeed, dynSeedOn } from './dynamicPrefs.svelte';
export {
  customThemes,
  type CustomTheme,
  isHexColor,
  loadCustomThemes,
  serializeCustomTheme,
  type ThemeColors,
  themeCssText,
  THEME_TOKENS,
  type ThemeToken,
} from './customThemes.svelte';
