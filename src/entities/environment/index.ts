// Public API of entities/environment (like the exported names of a Go package).
// Code outside src/entities/environment/ imports only from here; files inside use relative paths.

export { allowedEnvNames, isProdLike, scopeOf, setAllEnvs, toggleEnv } from './mcpEnvs';
export { mcpPrefs, type McpPrefs } from './mcpPrefs';
export {
  clock,
  ENV_COLOR_VAR,
  ENV_COLORS,
  envColor,
  type EnvColor,
  envToneOf,
  historyDay,
  historyPath,
  isProtected,
  matchSaved,
  needsProductionGuard,
  paletteSlot,
  recentRequests,
  searchEnvironments,
  searchRequests,
  timeAgo,
} from './palette';
export { requestVariableHighlight } from './requestVarHighlight';
export {
  addEnvironment,
  currentVarScope,
  environments,
  openEnvironmentsTab,
  setActiveEnvironment,
  setEnvVars,
  setGlobalVars,
} from './store.svelte';
