// Public API of shared/settings (like the exported names of a Go package).
// Code outside src/shared/settings/ imports only from here; files inside use relative paths.

export { hotkeyOverrides, hotkeys, resetAllBindings, resetBinding, setBinding } from './hotkeyPrefs';
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
} from './netPrefs';
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
  themeFollowSystem,
  UI_FONT_SIZES,
  uiFontSize,
} from './prefs';
export { fileName, type HostCert, proxyUrlError } from './proxy';
export {
  grpcAutoReflect,
  grpcDeadlineMs,
  proxyBypass,
  proxyMode,
  proxyUrl,
  requestFollowRedirects,
  requestTimeoutMs,
  requestValidateTls,
  responseBodyLimitMb,
  responseLineWrap,
  responsePrettyDefault,
  trustedCaPaths,
} from './requestPrefs';
export { applyStoredTheme, isDarkTheme, setTheme, theme } from './theme';
