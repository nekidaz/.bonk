import {
  proxyAuth,
  proxyUser,
  proxyPassword,
  trustSystemCas,
  activeClientCerts,
  requestPrefs,
  cookiesSave,
  cookiesSend,
  cookiesKeepSession,
  cookiesExclude,
} from '$shared/settings';
import { type RequestSettings, type ScriptResult, applyEnvPatch } from '$shared/model';
import { environments, setEnvVars, setGlobalVars } from '$entities/environment';
import { cookieJar, cookieJarKey } from '$entities/cookies';

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function currentRequestSettings(): RequestSettings {
  const timeoutMs = clampInt(requestPrefs.requestTimeoutMs.current, 0, 600_000, 30_000);
  const maxResponseBodyMb = clampInt(requestPrefs.responseBodyLimitMb.current, 1, 250, 25);
  const auth = requestPrefs.proxyMode.current === 'manual' && proxyAuth.current;
  return {
    timeoutMs,
    followRedirects: requestPrefs.requestFollowRedirects.current,
    validateTls: requestPrefs.requestValidateTls.current,
    maxResponseBodyBytes: maxResponseBodyMb * 1024 * 1024,
    proxy: {
      mode: requestPrefs.proxyMode.current,
      url: requestPrefs.proxyUrl.current.trim(),
      bypass: requestPrefs.proxyBypass.current.trim(),
      username: auth ? proxyUser.current.trim() : '',
      password: auth ? proxyPassword.current : '',
    },
    caPaths: requestPrefs.trustedCaPaths.current,
    trustSystemCas: trustSystemCas.current,
    clientCerts: activeClientCerts(),
    cookieJar: cookieJarKey(),
    cookiesSave: cookiesSave.current,
    cookiesSend: cookiesSend.current,
    cookiesKeepSession: cookiesKeepSession.current,
    cookiesExclude: cookiesExclude.current,
  };
}

/**
 * Fold a ScriptResult's env/globals mutations back into the stores. Writes to
 * the captured environment (if any) via setEnvVars and to globals via
 * setGlobalVars, mirroring Postman's `pm.environment.set` / `pm.globals.set`.
 * Exported so the Collection Runner folds script writes the exact same way,
 * which is what lets a later request in the run see an earlier one's writes.
 */
export function applyScriptVars(
  result: Pick<ScriptResult, 'envSet' | 'envUnset' | 'globalsSet' | 'globalsUnset' | 'cookieClears'>,
  environmentId: string | null = environments.activeId,
  clearCookies = true,
): void {
  const hasEnv = Object.keys(result.envSet).length > 0 || result.envUnset.length > 0;
  const hasGlob = Object.keys(result.globalsSet).length > 0 || result.globalsUnset.length > 0;
  if (hasEnv) {
    const id = environmentId;
    if (id) {
      const env = environments.list.find((e) => e.id === id);
      if (env) setEnvVars(id, applyEnvPatch(env.vars, result.envSet, result.envUnset));
    }
  }
  if (hasGlob) {
    setGlobalVars(applyEnvPatch(environments.globals, result.globalsSet, result.globalsUnset));
  }
  // Shared-core runs already cleared before dispatch. A second IPC could erase
  // cookies from the response or clear the workspace selected while it was running.
  if (clearCookies) for (const url of result.cookieClears ?? []) void cookieJar.clearFor(url);
  else if (result.cookieClears?.length) void cookieJar.refresh();
}
