<script lang="ts">
  /**
   * The endpoint bar's method picker: trigger button + searchable service /
   * method dropdown (⌘P opens it). `open` is bound from GrpcEditor, whose
   * App-level outside-click resets it; the wrapper stops pointer-down so
   * clicking inside doesn't close it.
   */
  import { flushSync, untrack } from 'svelte';
  import { t, tp } from '../../i18n';
  import { updateTabById } from '../../stores';
  import { filterGrpcServices } from '../../grpcEditorUi';
  import { grpcMethodLabel } from '../../grpcActions';
  import { grpcMethodKind } from '../../domain/grpc';
  import { splitMethodSymbol } from '../../domain/grpcEditor';
  import type { Tab } from '../../domain/types';

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
    void open; void search;
    activeIdx = Math.max(0, untrack(() => flatMethods).findIndex((m) => m.symbol === untrack(() => tab.grpc?.method)));
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
      updateTabById(tabId, (t) => (t.grpc ? { ...t, grpc: { ...t.grpc, method: symbol } } : t));
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
  <button class="bs-grpc-trigger" class:open aria-haspopup="menu" aria-expanded={open} disabled={noAddress && !tab.grpc?.method} onclick={openDropdown} type="button">
    <span class="material-symbols-outlined lead" aria-hidden="true">schema</span>
    {#if tab.grpc?.method}<span class="path"><span class="svc">{methodPath.service}/</span><b>{methodPath.name}</b></span>{:else if noAddress}<span class="path">{$t('grpc.enterAddressFirst')}</span>{:else}<span class="path">{grpcMethodLabel(tab, connecting, $t)}</span>{/if}
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
            aria-label={$t('grpc.picker.searchAria')}
            placeholder={$t('grpc.picker.searchPlaceholder')}
            autocomplete="off"
            spellcheck="false"
            onkeydown={searchKeydown}
          />
          {#if search}
            <span class="mp-count">{filteredMethodCount}</span>
            <button type="button" aria-label={$t('grpc.picker.clearAria')} title={$t('grpc.picker.clear')} onclick={clearSearch}>
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          {:else}
            <kbd>⌘P</kbd>
          {/if}
        </div>
        <div class="mp-source">
          <span class="dot" aria-hidden="true"></span>
          {`${isProtoSource ? `${$t('grpc.picker.fromProto')} · ${protoFileNames.join(', ')}` : `Server reflection · ${tab.grpc.endpoint}`} · ${tab.grpc.tree.services.length} ${$tp(tab.grpc.tree.services.length, ['сервис', 'сервиса', 'сервисов'], ['service', 'services'])}`}
        </div>
      {/if}
      <div class="mp-list" role="menu" aria-label={$t('grpc.picker.methods')}>
        {#if connecting}
          <div class="mp-empty">{$t('grpc.connecting')}</div>
        {:else if !tab.grpc?.tree}
          <div class="mp-empty">{isProtoSource && !protoFileNames.length ? $t('grpc.picker.importFirst') : $t('grpc.picker.connectFirst')}</div>
        {:else if filteredServices.length === 0}
          <div class="mp-empty">
            <span class="material-symbols-outlined" aria-hidden="true">search_off</span>
            <strong>{$t('grpc.picker.noMatch')}</strong>
            <span>{$t('grpc.picker.noMatchHint')}</span>
          </div>
        {:else}
          {#each filteredServices as service (service.name)}
            <div class="mp-service"><span class="material-symbols-outlined" aria-hidden="true">schema</span>{service.name}</div>
            {#each service.methods as m (m.symbol)}
              {@const kind = grpcMethodKind(m)}
              {@const on = m.symbol === tab.grpc?.method}
              <button class="mp-option" class:on class:active={flatMethods[activeIdx]?.symbol === m.symbol} role="menuitemradio" aria-checked={on} onpointerdown={(e) => { e.preventDefault(); select(m.symbol); }} onclick={() => select(m.symbol)} type="button" title={m.clientStreaming ? $t('grpc.picker.noClientStream') : undefined}>
                <span class="mp-line">
                  <span class="mp-name">{m.name}</span>
                  <span class="mp-kind" class:stream={kind !== 'unary'}>{kind}</span>
                  {#if on}<span class="material-symbols-outlined mp-check" aria-hidden="true">check</span>{/if}
                </span>
                {#if on && m.inputType}
                  <span class="mp-types">{m.inputType.split('.').pop()}{#if m.outputType}<span class="arrow" aria-hidden="true">→</span>{m.outputType.split('.').pop()}{/if}</span>
                {/if}
              </button>
            {/each}
          {/each}
        {/if}
      </div>
      <div class="mp-foot">
        <button type="button" onclick={onRefresh}>
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>{isProtoSource ? $t('grpc.picker.rereadProto') : $t('grpc.picker.refreshReflection')}
        </button>
        <button type="button" onclick={onImportProto}>
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>{$t('grpc.picker.importProto')}
        </button>
      </div>
    </div>
  {/if}
</div>
<svelte:window onkeydown={onKeydown} />
