<script lang="ts">
  import { cancelRequest } from '../../api';
  import { busyMap } from '../../requestRuntime';
  import { sendHttpRequest, updateActiveTab, updateTabById } from '../../stores';
  import { buildUrl, mergeParamsFromUrl } from '../../domain/http';
  import { buildRequestForSend } from '../../domain/httpBody';
  import { titleFor } from '../../domain/httpHeaders';
  import { methodColor } from '../../domain/method';
  import type { HttpResponse, Tab } from '../../domain/types';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  const activeBusy = $derived($busyMap[tab.id]);
  const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  function setMethod(method: string): void {
    updateActiveTab((t) => ({ ...t, request: { ...t.request, method } }));
  }

  function chooseHttpMethod(method: string): void {
    setMethod(method);
    methodOpen = false;
  }

  function setUrl(value: string): void {
    updateActiveTab((t) => ({
      ...t,
      params: mergeParamsFromUrl(value, t.params),
      request: { ...t.request, url: value },
      title: titleFor(t, value),
    }));
  }

  async function send(): Promise<void> {
    const t = tab;
    if (!t || t.protocol !== 'http') return;

    const inFlight = $busyMap[t.id];
    if (inFlight?.kind === 'http' && inFlight.requestId) {
      await cancelRequest(inFlight.requestId);
      return;
    }

    const id = t.id;
    const requestId = crypto.randomUUID();
    busyMap.update((m) => ({ ...m, [id]: { kind: 'http', requestId } }));
    const finalUrl = buildUrl(t.request.url, t.params);
    const req = buildRequestForSend(t, finalUrl);

    try {
      await sendHttpRequest(id, req, requestId);
    } catch (e) {
      const cancelled = String(e).toLowerCase().includes('cancel');
      const res: HttpResponse = {
        status: 0,
        headers: {},
        body: cancelled ? 'Request cancelled' : String(e),
        final_url: finalUrl,
        elapsed_ms: 0,
        size_bytes: 0,
      };
      updateTabById(id, (x) => ({ ...x, response: res }));
    } finally {
      busyMap.update((m) => {
        if (m[id]?.requestId !== requestId) return m;
        const { [id]: _done, ...rest } = m;
        return rest;
      });
    }
  }
</script>

<div class="bs-urlbar">
  <div class="bs-urlfield">
    <div class="bs-method-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
      <button
        class="bs-method"
        class:open={methodOpen}
        style="color:{methodColor(tab.request.method)}"
        type="button"
        aria-haspopup="menu"
        aria-expanded={methodOpen}
        onclick={() => (methodOpen = !methodOpen)}
      >
        <span>{tab.request.method}</span>
        <span class="material-symbols-outlined" style="font-size:15px">expand_more</span>
      </button>
      {#if methodOpen}
        <div class="bs-method-menu" role="menu" aria-label="HTTP method">
          {#each httpMethods as m}
            <button
              class="bs-method-option"
              class:on={m === tab.request.method}
              style="color:{methodColor(m)}"
              type="button"
              role="menuitemradio"
              aria-checked={m === tab.request.method}
              onclick={() => chooseHttpMethod(m)}
            >
              <span class="material-symbols-outlined check" style="font-size:17px">{m === tab.request.method ? 'check' : ''}</span>
              <span>{m}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <input class="bs-url" placeholder="Enter URL or paste text" value={tab.request.url} oninput={(e) => setUrl(e.currentTarget.value)} />
  </div>
  <button class="bs-send" class:cancelling={activeBusy?.kind === 'http'} onclick={send}>
    <span class="go">
      {#if activeBusy?.kind === 'http'}<span class="send-spinner" aria-hidden="true"></span>{/if}
      <span>{activeBusy?.kind === 'http' ? 'Cancel' : 'Send'}</span>
    </span>
    <span class="cv"><span class="material-symbols-outlined" style="font-size:14px">{activeBusy?.kind === 'http' ? 'stop' : 'expand_more'}</span></span>
  </button>
</div>
