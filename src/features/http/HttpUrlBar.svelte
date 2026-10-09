<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import { cancelRequest } from '$shared/ipc';
  import { busyMap, sendHttpRequest, applyCurlToActiveTab, requestProductionSend } from '$entities/request';
  import { tabs } from '$entities/tab';
  import { environments, currentVarScope, requestVariableHighlight, needsProductionGuard } from '$entities/environment';
  import { withInheritedAuth } from '$entities/workspace';
  import { urlHighlight } from '$shared/editor';
  import { EditorView } from '@codemirror/view';
  import { CodeEditor } from '$shared/editor/components';
  import {
    buildUrl,
    mergeParamsFromUrl,
    buildRequestForSend,
    methodColor,
    resolveVars,
    type HttpResponse,
    type Tab,
  } from '$shared/model';
  import { titleFor } from './httpHeaders';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  const cancelledMsg = $derived(t('http.url.cancelled'));
  const activeBusy = $derived($busyMap[tab.id]);
  // S38: everyday methods first, service ones (muted) below a divider.
  const methodGroups = [
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'QUERY'],
    ['HEAD', 'OPTIONS'],
  ];

  function setMethod(method: string): void {
    tabs.updateActive((t) => ({ ...t, request: { ...t.request, method } }));
  }

  function chooseHttpMethod(method: string): void {
    setMethod(method);
    methodOpen = false;
  }

  let methodMenu = $state<HTMLDivElement>();
  $effect(() => {
    if (methodOpen && methodMenu) methodMenu.querySelector<HTMLButtonElement>('button.on, button')?.focus();
  });

  // ↑↓ move, a letter jumps to the next method starting with it (P: POST → PUT → PATCH), ↵ picks.
  function methodMenuKeydown(e: KeyboardEvent): void {
    if (!methodMenu || e.metaKey || e.ctrlKey || e.altKey) return;
    const items = [...methodMenu.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (/^[a-z]$/i.test(e.key)) {
      const hits = items.filter((b) => b.dataset.method?.startsWith(e.key.toUpperCase()));
      if (!hits.length) return;
      e.preventDefault();
      hits[(hits.indexOf(items[i]) + 1) % hits.length].focus();
    }
  }

  function setUrl(value: string): void {
    tabs.updateActive((t) => ({
      ...t,
      params: mergeParamsFromUrl(value, t.params),
      request: { ...t.request, url: value },
      title: titleFor(t, value),
    }));
  }

  // Postman-style: pasting a whole `curl ...` command into the URL bar imports
  // it into the active request instead of dropping the raw text into the field.
  // Returning true tells the editor to swallow the paste.
  function onUrlPaste(text: string): boolean {
    return /^\s*curl\s/i.test(text) && applyCurlToActiveTab(text);
  }

  // `{{var}}` inline highlight + hover quick-set. Re-derived whenever the
  // variable stores change so the URL bar's decorations stay in sync (e.g.
  // adding a value from the popover flips missing → resolved immediately).
  const varHighlight = $derived(
    requestVariableHighlight(environments.globals, environments.list, environments.activeId),
  );

  // S13: at rest the URL is one line with a fading tail and a "+N params" hint; focus opens it into
  // a card that wraps between parameters. `long` / `hidden` are measured on the one-line layout.
  const urlExtensions = urlHighlight();
  let fieldEl = $state<HTMLDivElement | null>(null);
  let focused = $state(false);
  let long = $state(false);
  let hidden = $state(0);
  const paramCount = $derived((tab.request.url.split('?')[1] ?? '').split('&').filter(Boolean).length);

  function measure(): void {
    const scroller = fieldEl?.querySelector<HTMLElement>('.cm-scroller');
    const content = fieldEl?.querySelector<HTMLElement>('.cm-content');
    const url = tab.request.url;
    if (!scroller || !content || focused) return;
    long = content.scrollWidth > scroller.clientWidth + 1;
    const fit = scroller.clientWidth / (content.scrollWidth / Math.max(1, url.length));
    // A parameter counts as hidden once its end is past the fade.
    let end = url.indexOf('?');
    hidden = 0;
    if (long && end !== -1)
      for (const part of url.slice(end + 1).split('&')) {
        end += part.length + 1;
        if (end > fit - 4) hidden += 1;
      }
  }
  $effect(() => {
    void tab.request.url;
    void focused;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  });
  $effect(() => {
    if (!fieldEl) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(fieldEl);
    return () => observer.disconnect();
  });

  async function send(): Promise<void> {
    const t = tab;
    if (!t || t.protocol !== 'http') return;

    const inFlight = $busyMap[t.id];
    if (inFlight?.kind === 'http' && inFlight.requestId) {
      await cancelRequest(inFlight.requestId);
      return;
    }

    const finalUrl = buildUrl(t.request.url, t.params);
    const env = environments.active;
    const envName = env?.name;
    if (env && envName && needsProductionGuard(t.request.method, env)) {
      const url = resolveVars(finalUrl, currentVarScope());
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        /* relative or unresolved URL: no host to show */
      }
      if (!(await requestProductionSend({ method: t.request.method.toUpperCase(), url, envName, host }))) return;
    }

    const id = t.id;
    const requestId = crypto.randomUUID();
    busyMap.update((m) => ({ ...m, [id]: { kind: 'http', requestId, startedAt: Date.now() } }));
    const req = buildRequestForSend(withInheritedAuth(t, t.savedPath), finalUrl);

    try {
      await sendHttpRequest(id, req, requestId);
    } catch (e) {
      const cancelled = String(e).toLowerCase().includes('cancel');
      const res: HttpResponse = {
        status: 0,
        headers: {},
        body: cancelled ? cancelledMsg : String(e),
        final_url: finalUrl,
        elapsed_ms: 0,
        size_bytes: 0,
      };
      tabs.updateById(id, (x) => ({ ...x, response: res }));
    } finally {
      busyMap.update((m) => {
        if (m[id]?.requestId !== requestId) return m;
        const { [id]: _done, ...rest } = m;
        return rest;
      });
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (
      e.key === 'Escape' &&
      activeBusy?.kind === 'http' &&
      activeBusy.requestId &&
      !document.querySelector('.bs-overlay, .bs-menu, .bs-palette, [aria-expanded="true"]')
    ) {
      e.preventDefault();
      void cancelRequest(activeBusy.requestId);
    }
  }}
/>

<div class="bs-urlbar">
  <div
    class="bs-urlfield"
    class:long
    class:expanded={focused && long}
    role="presentation"
    bind:this={fieldEl}
    onfocusin={() => (focused = true)}
    onfocusout={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' && focused && !activeBusy) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }}
  >
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
        <div
          class="bs-method-menu"
          role="menu"
          tabindex="-1"
          aria-label={t('http.url.method_aria')}
          bind:this={methodMenu}
          onkeydown={methodMenuKeydown}
        >
          {#each methodGroups as group, gi (gi)}
            {#if gi > 0}<div class="dv" role="separator"></div>{/if}
            {#each group as m (m)}
              <button
                class="bs-method-option"
                class:on={m === tab.request.method}
                class:aux={gi > 0}
                style={gi > 0 ? undefined : `color:${methodColor(m)}`}
                type="button"
                role="menuitemradio"
                aria-checked={m === tab.request.method}
                data-method={m}
                onclick={() => chooseHttpMethod(m)}
              >
                <span>{m}</span>
                {#if m === tab.request.method}<span class="material-symbols-outlined check" aria-hidden="true"
                    >check</span
                  >{/if}
              </button>
            {/each}
          {/each}
        </div>
      {/if}
    </div>
    <div class="bs-url-main">
      <CodeEditor
        value={tab.request.url}
        onChange={setUrl}
        singleLine
        placeholder={t('http.url.placeholder')}
        onEnter={() => void send()}
        onPaste={onUrlPaste}
        varHighlight={[varHighlight, urlExtensions, focused && long ? EditorView.lineWrapping : []]}
        docId={tab.id}
        ariaLabel={t('http.url.aria')}
      />
      {#if focused && long}
        <div class="bs-url-meta">
          <span
            >{`${paramCount} ${tp(paramCount, ['параметр', 'параметра', 'параметров'], ['param', 'params'])}\u00a0\u00a0·\u00a0\u00a0${t('http.url.chars', { n: tab.request.url.length })}`}</span
          ><span class="hint">{t('http.url.collapse')}</span>
        </div>
      {/if}
    </div>
    {#if !focused && hidden > 0}<span class="bs-url-more" aria-hidden="true"
        ><span class="material-symbols-outlined">unfold_more</span
        >{`+${hidden} ${tp(hidden, ['параметр', 'параметра', 'параметров'], ['param', 'params'])}`}</span
      >{/if}
  </div>
  <button
    class="bs-send"
    class:cancelling={activeBusy?.kind === 'http'}
    aria-busy={activeBusy?.kind === 'http'}
    disabled={activeBusy?.kind !== 'http' && !tab.request.url.trim()}
    title={activeBusy?.kind === 'http' ? t('http.url.cancel_title') : undefined}
    onclick={send}
  >
    <span class="go">
      {#if activeBusy?.kind === 'http'}<span>{t('http.url.cancel')}</span><kbd>Esc</kbd>{:else}<span
          >{t('http.url.send')}</span
        >{/if}
    </span>
  </button>
</div>
