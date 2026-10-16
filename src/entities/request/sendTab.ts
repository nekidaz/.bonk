import { t } from '$shared/i18n';
import { cancelRequest, stopStream } from '$shared/ipc';
import { buildUrl, resolveVars, type HttpResponse, type Tab } from '$shared/model';
import { tabs } from '$entities/tab';
import { environments, currentVarScope, needsProductionGuard } from '$entities/environment';
import { withInheritedAuth } from '$entities/workspace';
import { requestProductionSend } from './dialogs.svelte';
import { requestRuntime } from './requestRuntime.svelte';
import { sendHttpRequest } from './store';

/**
 * Send (or, while it is in flight, cancel) an HTTP tab: production guard, busy state, and an error
 * «response» on failure. Shared by the URL bar's Send, ⌘↵ in the script editor and SC6's
 * “Send without scripts” (`skipScripts`).
 */
export async function sendHttpTab(tab: Tab, opts: { skipScripts?: boolean } = {}): Promise<void> {
  if (tab.protocol !== 'http') return;

  const inFlight = requestRuntime.busy[tab.id];
  if (inFlight?.kind === 'http' && inFlight.requestId) {
    // A live event stream ends softly (the collected response is kept); anything else is a hard cancel.
    if (tabs.list.find((x) => x.id === tab.id)?.sseLive) await stopStream(inFlight.requestId);
    else await cancelRequest(inFlight.requestId);
    return;
  }

  const finalUrl = buildUrl(tab.request.url, tab.params);
  const env = environments.active;
  const envName = env?.name;
  if (env && envName && needsProductionGuard(tab.request.method, env)) {
    const url = resolveVars(finalUrl, currentVarScope());
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      /* relative or unresolved URL: no host to show */
    }
    if (!(await requestProductionSend({ method: tab.request.method.toUpperCase(), url, envName, host }))) return;
  }

  const id = tab.id;
  const requestId = crypto.randomUUID();
  requestRuntime.updateBusy((m) => ({ ...m, [id]: { kind: 'http', requestId, startedAt: Date.now() } }));

  try {
    const req = withInheritedAuth(tab, tab.savedPath).request;
    await sendHttpRequest(id, req, requestId, opts);
  } catch (e) {
    // A pre-request script error is never a cancel, whatever its message says.
    const scriptFailed = tabs.list.find((x) => x.id === id)?.testResults?.errorPhase === 'pre';
    const cancelled = !scriptFailed && String(e).toLowerCase().includes('cancel');
    const res: HttpResponse = {
      status: 0,
      headers: {},
      body: cancelled ? t('http.url.cancelled') : String(e),
      final_url: finalUrl,
      elapsed_ms: 0,
      size_bytes: 0,
    };
    tabs.updateById(id, (x) => ({ ...x, response: res, sseLive: undefined }));
  } finally {
    requestRuntime.updateBusy((m) => {
      if (m[id]?.requestId !== requestId) return m;
      const { [id]: _done, ...rest } = m;
      return rest;
    });
  }
}
