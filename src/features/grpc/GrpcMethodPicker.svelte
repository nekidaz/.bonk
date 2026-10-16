<script lang="ts">
  /**
   * The endpoint bar's method picker: trigger button + searchable service /
   * method dropdown (⌘P opens it). `open` is bound from GrpcEditor, whose
   * App-level outside-click resets it; the wrapper stops pointer-down so
   * clicking inside doesn't close it.
   */
  import { flushSync, untrack } from 'svelte';
  import { t, tp } from '$shared/i18n';
  import { tabs } from '$entities/tab';
  import { filterGrpcServices, grpcMethodKind } from '$entities/request';
  import { grpcMethodLabel } from './grpcActions';
  import { splitMethodSymbol } from './grpcEditor';
  import type { Tab } from '$shared/model';

  let {
    tab,
    open = $bindable(),
    connecting,
    noAddress,
    ensureConnected,
    onRefresh,
    onImportProto,
  }: {
    tab: Tab;
    open: boolean;
    connecting: boolean;
    noAddress: boolean;
    /** Connect + reflect if not connected yet. */
    ensureConnected: () => Promise<void>;
    /** Re-dial and re-read the schema. */
    onRefresh: () => void;
    onImportProto: () => void;
  } = $props();

  const methodPath = $derived(splitMethodSymbol(tab.grpc?.method ?? ''));
  const protoFileNames = $derived((tab.grpc?.protoPaths ?? []).map((p) => p.split(/[\\/]/).pop() ?? p));
  const isProtoSource = $derived(tab.grpc?.source === 'proto');

  let search = $state('');
  let searchInput = $state<HTMLInputElement | undefined>(undefined);
  const filteredServices = $derived(filterGrpcServices(tab.grpc?.tree?.services ?? [], search));
  const filteredMethodCount = $derived(filteredServices.reduce((count, service) => count + service.methods.length, 0));

  $effect(() => {
    if (!open) search = '';
  });

  // Keyboard cursor over the flattened (service -> methods) list; the search box keeps focus.
  const flatMethods = $derived(filteredServices.flatMap((s) => s.methods));
  let activeIdx = $state(0);
  $effect(() => {
    // Reset on open / new query: start on the selected method when it is still listed.
    void open;
    void search;
    activeIdx = Math.max(
      0,
      untrack(() => flatMethods).findIndex((m) => m.symbol === untrack(() => tab.grpc?.method)),
    );
  });
  $effect(() => {
    void activeIdx;
    if (open) document.querySelector('.bs-mpick .mp-option.active')?.scrollIntoView({ block: 'nearest' });
  });

  function select(symbol: string): void {
    const id = tab?.grpc?.connectionId;
    if (!id) return;
    // Selecting an RPC only changes the method. Message, metadata, and scripts
    // are the user's request draft and must survive method switches. An example
    // is inserted only through the explicit "Use Example Message" action.
    const tabId = tab.id;
    flushSync(() => {
      open = false;
      tabs.updateById(tabId, (t) => (t.grpc ? { ...t, grpc: { ...t.grpc, method: symbol } } : t));
    });
  }
  function clearSearch(): void {
    search = '';
    searchInput?.focus();
  }
  function searchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (search) clearSearch();
      else open = false;
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && flatMethods.length) {
      e.preventDefault();
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + flatMethods.length) % flatMethods.length;
      return;
    }
    if (e.key === 'Enter') {
      const pick = flatMethods[activeIdx];
      if (pick) {
        e.preventDefault();
        select(pick.symbol);
      }
    }
  }
  async function openDropdown(): Promise<void> {
    if (!tab?.grpc?.tree) await ensureConnected();
    open = !open;
    if (open) {
      search = '';
      requestAnimationFrame(() => searchInput?.focus());
    }
  }
  function onKeydown(e: KeyboardEvent): void {
    // S23: ⌘P opens the method picker.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyP' && !e.shiftKey) {
      e.preventDefault();
      if (!open) void openDropdown();
    }
  }
</script>

<div class="bs-grpc-picker" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="bs-grpc-trigger"
    class:open
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={noAddress && !tab.grpc?.method}
    onclick={openDropdown}
    type="button"
  >
    <span class="material-symbols-outlined lead" aria-hidden="true">schema</span>
    {#if tab.grpc?.method}<span class="path"
        ><span class="svc">{methodPath.service}/</span><b>{methodPath.name}</b></span
      >{:else if noAddress}<span class="path">{t('grpc.enterAddressFirst')}</span>{:else}<span class="path"
        >{grpcMethodLabel(tab, connecting, t)}</span
      >{/if}
    <span class="material-symbols-outlined" style="font-size:16px">unfold_more</span>
  </button>
  {#if open}
    <div class="bs-grpc-menu bs-mpick">
      {#if tab.grpc?.tree && !connecting}
        <div class="mp-search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            bind:this={searchInput}
            bind:value={search}
            aria-label={t('grpc.picker.searchAria')}
            placeholder={t('grpc.picker.searchPlaceholder')}
            autocomplete="off"
            spellcheck="false"
            onkeydown={searchKeydown}
          />
          {#if search}
            <span class="mp-count">{filteredMethodCount}</span>
            <button
              type="button"
              aria-label={t('grpc.picker.clearAria')}
              title={t('grpc.picker.clear')}
              onclick={clearSearch}
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          {:else}
            <kbd>⌘P</kbd>
          {/if}
        </div>
        <div class="mp-source">
          <span class="dot" aria-hidden="true"></span>
          {`${isProtoSource ? `${t('grpc.picker.fromProto')} · ${protoFileNames.join(', ')}` : `Server reflection · ${tab.grpc.endpoint}`} · ${tab.grpc.tree.services.length} ${tp(tab.grpc.tree.services.length, ['service', 'services'])}`}
        </div>
      {/if}
      <div class="mp-list" role="menu" aria-label={t('grpc.picker.methods')}>
        {#if connecting}
          <div class="mp-empty">{t('grpc.connecting')}</div>
        {:else if !tab.grpc?.tree}
          <div class="mp-empty">
            {isProtoSource && !protoFileNames.length ? t('grpc.picker.importFirst') : t('grpc.picker.connectFirst')}
          </div>
        {:else if filteredServices.length === 0}
          <div class="mp-empty">
            <span class="material-symbols-outlined" aria-hidden="true">search_off</span>
            <strong>{t('grpc.picker.noMatch')}</strong>
            <span>{t('grpc.picker.noMatchHint')}</span>
          </div>
        {:else}
          {#each filteredServices as service (service.name)}
            <div class="mp-service">
              <span class="material-symbols-outlined" aria-hidden="true">schema</span>{service.name}
            </div>
            {#each service.methods as m (m.symbol)}
              {@const kind = grpcMethodKind(m)}
              {@const on = m.symbol === tab.grpc?.method}
              <button
                class="mp-option"
                class:on
                class:active={flatMethods[activeIdx]?.symbol === m.symbol}
                role="menuitemradio"
                aria-checked={on}
                onpointerdown={(e) => {
                  e.preventDefault();
                  select(m.symbol);
                }}
                onclick={() => select(m.symbol)}
                type="button"
              >
                <span class="mp-line">
                  <span class="mp-name">{m.name}</span>
                  <span class="mp-kind" class:stream={kind !== 'unary'}>{kind}</span>
                  {#if on}<span class="material-symbols-outlined mp-check" aria-hidden="true">check</span>{/if}
                </span>
                {#if on && m.inputType}
                  <span class="mp-types"
                    >{m.inputType.split('.').pop()}{#if m.outputType}<span class="arrow" aria-hidden="true">→</span
                      >{m.outputType.split('.').pop()}{/if}</span
                  >
                {/if}
              </button>
            {/each}
          {/each}
        {/if}
      </div>
      <div class="mp-foot">
        <button type="button" onclick={onRefresh}>
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>{isProtoSource
            ? t('grpc.picker.rereadProto')
            : t('grpc.picker.refreshReflection')}
        </button>
        <button type="button" onclick={onImportProto}>
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>{t('grpc.picker.importProto')}
        </button>
      </div>
    </div>
  {/if}
</div>
<svelte:window onkeydown={onKeydown} />

<style>
  /* Belongs to grpc.css, but the cascade needs it before `.bs-file-picker span:last-child` (same elements, same specificity), so it lives here. */
  .bs-grpc-trigger :global(span:first-child) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--t2);
  }

  /* gRPC: endpoint field, method picker, TLS popover, metadata, proto, stream feed. */
  .bs-grpc-trigger {
    color: var(--text);
    background: transparent;
    border: none;
  }

  .bs-grpc-trigger.open :global(span:first-child) {
    color: var(--text);
  }

  .bs-grpc-picker:where(:hover) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--sep));
  }

  .bs-grpc-menu {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(:where(.dark)) .bs-grpc-menu {
    border-color: var(--sep);
    background: var(--surface-solid);
  }

  .bs-grpc-picker:focus-within {
    border-color: var(--color-text-muted);
    box-shadow: none;
  }

  .bs-mpick :global(.mp-option.active:not(.on)) {
    background: var(--color-hover);
  }

  .bs-mpick .mp-option.active.on {
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  /* overflow stays visible so the CodeMirror {{var}} hover popover isn't clipped. */
  .bs-grpc-picker {
    flex: 1 1 auto;
    position: relative;
    transition:
      border-color 130ms ease,
      box-shadow 130ms ease,
      background 130ms ease;
    height: 48px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    box-shadow: none;
    min-width: 180px;
  }

  .bs-grpc-trigger {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    gap: 8px;
    font-size: var(--font-size-body);
    border-radius: var(--radius-control);
  }

  .bs-grpc-trigger.open {
    outline-offset: 0;
    outline: none;
    border-radius: var(--radius-control);
    box-shadow: var(--focus-ring);
  }

  .bs-grpc-menu {
    position: absolute;
    top: calc(100% + 7px);
    right: 0;
    z-index: 70;
    width: 100%;
    min-width: 0;
    max-height: min(460px, calc(100vh - 178px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    padding: 6px;
    background: var(--color-raised);
    box-shadow: 0 16px 40px var(--color-shadow, rgba(0, 0, 0, 0.14));
  }

  :global(:root[data-density='compact']) .bs-grpc-picker {
    height: 34px;
  }

  :global(:root[data-density='compact'] .bs .bs-grpc-field) .bs-grpc-trigger {
    height: 28px;
  }

  @media (max-width: 1100px) {
    .bs-grpc-picker {
      min-width: 150px;
    }
  }

  /* The address has priority: the picker gives way first (huge flex-shrink), the service ellipsizes, and it
     stops at about the method name's width; only then does a long address scroll. */
  /* static: the menu anchors to the whole field (GrpcEditor makes it relative), not to this button. */
  /* flex-end: the trigger (capped at 360px) hugs the field's right edge, short or long address alike. */
  :global(.bs .bs-grpc-field) .bs-grpc-picker {
    position: static;
    display: flex;
    justify-content: flex-end;
    flex: 0 1000 auto;
    width: auto;
    min-width: min(190px, 40%);
    margin-left: auto;
    height: auto;
    border: 0;
    outline: 0;
    background: none;
    box-shadow: none;
  }

  :global(.bs .bs-grpc-field) .bs-grpc-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: auto;
    min-width: 0;
    /* Never wider than the picker's slot, or it overlaps Send in a narrow window. */
    max-width: min(100%, 360px);
    height: 36px;
    padding: 0 10px 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs .bs-grpc-field) .bs-grpc-trigger:hover {
    background: var(--color-raised);
    box-shadow: none;
  }

  :global(.bs .bs .bs-grpc-field) .bs-grpc-trigger.open {
    background: var(--color-raised);
    box-shadow: none;
  }

  :global(.bs) .bs-grpc-trigger :global(.lead) {
    font-size: 16px;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-grpc-trigger :global(.path) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Short of room, the service gives way first: «helloworld.Gr…SayHello». */
  :global(.bs) .bs-grpc-trigger :global(.path:has(.svc)) {
    display: flex;
  }

  :global(.bs .bs-grpc-trigger .path) .svc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.bs) .bs-grpc-trigger :global(.path b) {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text);
    font-weight: 600;
  }

  @media (max-width: 760px) {
    :global(.bs) .bs-grpc-trigger :global(:is(.lead, .svc)) {
      display: none;
    }

    :global(.bs .bs-grpc-field) .bs-grpc-trigger {
      gap: 4px;
      padding: 0 6px 0 8px;
    }
  }

  /* As wide as the address field, like Postman's schema picker. */
  :global(.bs .bs-grpc-field) .bs-grpc-menu {
    right: 0;
    left: 0;
    top: calc(100% + 10px);
  }

  /* S23: method picker — search, source line, services, kind badges, actions. */
  :global(.bs .bs-grpc-field) .bs-mpick {
    position: absolute;
    z-index: 80;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: auto;
    max-height: min(502px, calc(100vh - 140px));
    padding: 6px;
    border-radius: 22px;
  }

  :global(.bs) .bs-mpick .mp-search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 8px 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-mpick .mp-search :global(input) {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    outline: 0;
    box-shadow: none;
    background: none;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-mpick .mp-search :global(input::placeholder) {
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-mpick .mp-search :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-mpick .mp-search :global(kbd) {
    display: grid;
    place-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-code);
    opacity: 1;
  }

  :global(.bs) .bs-mpick .mp-search :global(button) {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-mpick .mp-count {
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-mpick .mp-source {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 2px;
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-caption)/13px var(--font-ui);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  :global(.bs) .bs-mpick .mp-source :global(.dot) {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-success);
  }

  :global(.bs) .bs-mpick .mp-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  :global(.bs) .bs-mpick .mp-service {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 12px 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-mpick .mp-service :global(.material-symbols-outlined) {
    font-size: 13px;
  }

  :global(.bs) .bs-mpick .mp-option {
    flex: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    gap: 3px;
    width: 100%;
    min-height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    text-align: left;
  }

  :global(.bs) .bs-mpick .mp-option:hover {
    background: var(--color-hover);
    outline: 0;
  }

  :global(.bs) .bs-mpick .mp-option:focus-visible {
    background: var(--color-hover);
    outline: 0;
  }

  :global(.bs) .bs-mpick .mp-option.on {
    min-height: 52px;
    padding: 8px 12px;
    border-radius: 16px;
    background: var(--color-selected);
    color: var(--color-text);
  }

  :global(.bs) .bs-mpick .mp-line {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 18px;
  }

  :global(.bs) .bs-mpick .mp-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font: var(--font-size-body)/16px var(--font-code);
  }

  :global(.bs) .bs-mpick .mp-option.on .mp-name {
    font-weight: 600;
  }

  :global(.bs) .bs-mpick .mp-kind {
    flex: none;
    height: 18px;
    padding: 0 7px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    color: var(--color-text-muted);
    font: 500 9px/16px var(--font-code);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  :global(.bs) .bs-mpick .mp-kind.stream {
    border-color: transparent;
    background: var(--color-var-soft);
    color: var(--color-var);
  }

  :global(.bs) .bs-mpick .mp-check {
    font-size: 15px;
  }

  :global(.bs) .bs-mpick .mp-types {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--sk);
    font: var(--font-size-caption)/15px var(--font-code);
  }

  :global(.bs) .bs-mpick .mp-types :global(.arrow) {
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }

  :global(.bs) .bs-mpick .mp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 24px 12px;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
    text-align: center;
  }

  :global(.bs) .bs-mpick .mp-empty :global(strong) {
    color: var(--color-text);
    font-weight: 600;
  }

  :global(.bs) .bs-mpick .mp-foot {
    flex: none;
    display: flex;
    justify-content: space-between;
    gap: 4px;
    padding: 8px 6px 2px;
    border-top: 1px solid var(--color-border-subtle);
  }

  :global(.bs) .bs-mpick .mp-foot :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-mpick .mp-foot :global(button:hover) {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-mpick .mp-foot :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  /* G1: a new gRPC request picks where its schema comes from; the method picker waits for an address. */
  :global(.bs .bs-grpc-field) .bs-grpc-trigger:disabled {
    opacity: 0.55;
    cursor: default;
    background: transparent;
  }
</style>
