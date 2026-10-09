import { isProtected } from './palette';

/**
 * Pure helpers for the "Окружения для AI" picker (S32.8). The allow-list is by environment
 * NAME because `bonk-mcp --environment <name>` is name-based.
 */
export type McpEnvScope = 'all-but-prod' | 'selected';

export interface McpEnvPrefs {
  /** Absent in prefs saved by older builds: derived from `environments`. */
  envScope?: McpEnvScope;
  /** Names AI may use when scope is `selected`; legacy `null` = default. */
  environments: string[] | null;
  /** Scope `selected`: environments created later are allowed at once (never production-like ones). */
  autoAllowNew?: boolean;
}

interface EnvLike {
  name: string;
  protected?: boolean;
}
type Scoped = { envScope: McpEnvScope; environments: string[] };

/** Production-like: protected (explicit flag or name) or named like live. */
export const isProdLike = (env: EnvLike): boolean => isProtected(env) || /live/i.test(env.name);

export const scopeOf = (p: McpEnvPrefs): McpEnvScope => p.envScope ?? (p.environments ? 'selected' : 'all-but-prod');

/** Names AI may target under the current scope (unique; a name shared with a prod-like env counts as prod-like). */
export function allowedEnvNames(p: McpEnvPrefs, envs: EnvLike[]): Set<string> {
  if (scopeOf(p) === 'all-but-prod') {
    const prod = new Set(envs.filter(isProdLike).map((e) => e.name));
    return new Set(envs.map((e) => e.name).filter((n) => !prod.has(n)));
  }
  const known = new Set(envs.map((e) => e.name));
  return new Set((p.environments ?? []).filter((n) => known.has(n)));
}

/** Toggle one environment; from `all-but-prod` it first becomes an explicit `selected` list. */
export function toggleEnv(p: McpEnvPrefs, envs: EnvLike[], name: string): Scoped {
  const next = allowedEnvNames(p, envs);
  if (!next.delete(name)) next.add(name);
  return { envScope: 'selected', environments: [...next] };
}

export const setAllEnvs = (envs: EnvLike[], on: boolean): Scoped => ({
  envScope: 'selected',
  environments: on ? [...new Set(envs.map((e) => e.name))] : [],
});

/** A new environment was created: allow it right away if the user asked for that (never prod-like). */
export function autoAllowNewEnv<P extends McpEnvPrefs>(p: P, env: EnvLike): P {
  if (scopeOf(p) !== 'selected' || !p.autoAllowNew || isProdLike(env)) return p;
  const cur = p.environments ?? [];
  return cur.includes(env.name) ? p : { ...p, envScope: 'selected', environments: [...cur, env.name] };
}

/** An environment was renamed: carry its allowance over (unless the new name is production-like). */
export function renameEnvAllowance<P extends McpEnvPrefs>(p: P, from: string, to: EnvLike): P {
  if (from === to.name || scopeOf(p) !== 'selected' || !p.environments?.includes(from)) return p;
  const rest = p.environments.filter((n) => n !== from);
  return { ...p, environments: isProdLike(to) || rest.includes(to.name) ? rest : [...rest, to.name] };
}
