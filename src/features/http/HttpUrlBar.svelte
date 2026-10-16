<!--
  HTTP request → method picker, URL field and Send / Cancel. The URL field is a one-line CodeMirror
  (shared/editor) so {{variables}} get highlighted; Send calls `sendHttpTab` (entities/request/sendTab.ts).
-->
<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import { cancelRequest } from '$shared/ipc';
  import { sendHttpTab, applyCurlToActiveTab, requestRuntime } from '$entities/request';
  import { tabs } from '$entities/tab';
  import { environments, requestVariableHighlight } from '$entities/environment';
  import { urlHighlight } from '$shared/editor';
  import { EditorView } from '@codemirror/view';
  import { CodeEditor } from '$shared/editor/components';
  import { mergeParamsFromUrl, methodColor, type Tab } from '$shared/model';
  import { titleFor } from './httpHeaders';
  import { SendButton } from '$shared/ui/components';
  import { UrlBar, UrlField, MethodWrap, MethodButton } from '$entities/request/components';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  const activeBusy = $derived(requestRuntime.busy[tab.id]);
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
    // `.on` alone: 'button.on, button' matches in document order, so the first method won.
    if (methodOpen && methodMenu)
      (methodMenu.querySelector<HTMLButtonElement>('button.on') ?? methodMenu.querySelector('button'))?.focus();
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

  const send = () => sendHttpTab(tab);
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

<UrlBar>
  <UrlField
    class={{ long, expanded: focused && long }}
    role="presentation"
    bind:ref={fieldEl}
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
    <MethodWrap role="presentation" onpointerdown={(e) => e.stopPropagation()}>
      <MethodButton
        class={{ open: methodOpen }}
        style="color:{methodColor(tab.request.method)}"
        type="button"
        aria-haspopup="menu"
        aria-expanded={methodOpen}
        onclick={() => (methodOpen = !methodOpen)}
      >
        <span>{tab.request.method}</span>
        <span class="material-symbols-outlined">expand_more</span>
      </MethodButton>
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
    </MethodWrap>
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
  </UrlField>
  <SendButton
    class={{ cancelling: activeBusy?.kind === 'http' }}
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
  </SendButton>
</UrlBar>

<style>
  :global(:root :where(.bs) button.bs-method.open .material-symbols-outlined) {
    color: currentColor;
  }

  .bs-method-option.on {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .bs-method-option :global(.check) {
    width: 18px;
    color: currentColor;
  }

  .bs-method-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 70;
    width: 186px;
    padding: 6px;
    border: 1px solid var(--sep);
    border-radius: 6px;
    background: var(--surface-solid);
    box-shadow: var(--shadow-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  :global(.dark) .bs-method-menu {
    box-shadow:
      0 20px 52px rgba(0, 0, 0, 0.42),
      0 2px 10px rgba(0, 0, 0, 0.28),
      0 0 0 0.5px rgba(255, 255, 255, 0.06);
    background: var(--surface-solid);
  }

  .bs-method-option {
    width: 100%;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 10px 0 8px;
    font-family: var(--mono);
    font-size: 13.5px;
    font-weight: 800;
    contain: paint;
    border-radius: 4px;
  }

  .bs-method-option:hover {
    color: var(--text);
    background: var(--hover);
  }

  :global(:root .bs button.bs-method.open) {
    background: var(--color-selected);
  }

  :global(.bs) .bs-url-more {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    margin: auto -10px auto 0;
    padding: 0 10px 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }

  :global(.bs) .bs-url-more :global(.material-symbols-outlined) {
    font-size: 14px;
  }

  :global(.bs) .bs-method-menu {
    border: 1px solid var(--color-border);
    background: var(--color-raised);
    box-shadow: 0 16px 40px var(--color-shadow, rgba(0, 0, 0, 0.14));
    width: 136px;
    padding: 4px;
    border-radius: 18px;
  }

  :global(.bs) .bs-method-menu .bs-method-option {
    height: 28px;
    gap: 8px;
    padding: 0 10px 0 12px;
    justify-content: space-between;
    border-radius: var(--radius-control);
    font: 600 var(--font-size-caption) var(--font-code);
    letter-spacing: 0.4px;
  }

  :global(.bs) .bs-method-menu :global(.bs-method-option:is(:hover, :focus-visible, .on)) {
    background: var(--color-selected);
    outline: 0;
  }

  :global(.bs) .bs-method-menu .bs-method-option.aux {
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-method-menu .bs-method-option :global(.check) {
    width: auto;
    font-size: 14px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-method-menu :global(.dv) {
    height: 1px;
    margin: 4px 10px;
    background: var(--color-border-subtle);
  }
</style>
