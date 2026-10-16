<script lang="ts">
  import { findNode, parentId, workspace } from '$entities/workspace';
  import { dirtyTabIds } from '$entities/request';
  import { history } from '$entities/history';
  import { renameActiveTab, resetActiveTabTitle } from '$features/tabs';
  import { CodeSnippetPopover } from '$features/codegen/components';
  import type { Tab } from '$shared/model';
  import { t } from '$shared/i18n';
  import { Spacer } from '$shared/ui/components';

  let {
    tab,
    savedFlash,
    onSwitch,
    onSmartSave,
    onOpenSave,
    codeOpen,
    onCode,
  }: {
    tab: Tab;
    savedFlash: boolean;
    /** Protocol button: opens the HTTP / gRPC menu. */
    onSwitch: (e: MouseEvent) => void;
    onSmartSave: () => void | Promise<void>;
    onOpenSave: () => void;
    codeOpen: boolean;
    onCode: () => void;
  } = $props();

  // gRPC call shape for the eyebrow: unary / server stream / client stream / bidi stream.
  const callType = $derived.by(() => {
    const m = tab.grpc?.tree?.services.flatMap((s) => s.methods).find((x) => x.symbol === tab.grpc?.method);
    if (!m) return 'gRPC';
    if (m.clientStreaming && m.serverStreaming) return t('nav.header.bidi');
    return m.serverStreaming
      ? t('nav.header.server')
      : m.clientStreaming
        ? t('nav.header.client')
        : t('nav.header.unary');
  });

  // Breadcrumb: the folder the saved request lives in.
  // A history snapshot (S21) shows where its original lives.
  const origin = $derived(
    tab.savedPath ?? (tab.historyId ? history.list.find((h) => h.id === tab.historyId)?.savedPath : undefined),
  );
  const folderId = $derived(origin ? parentId(origin) : undefined);
  const folderName = $derived(folderId ? findNode(workspace.tree, folderId)?.name : undefined);

  let editing = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement | undefined>(undefined);

  // Discard any in-progress rename when the active tab changes. Every reachable
  // tab-switch blurs the input first (committing it), but this keeps the edit
  // state strictly tab-scoped against any future keyboard/programmatic switch.
  $effect(() => {
    tab.id;
    editing = false;
    draft = '';
  });

  function startRename(): void {
    editing = true;
    draft = tab.title;
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
  }

  function commitRename(): void {
    if (!editing) return;
    const clean = draft.trim();
    if (clean) renameActiveTab(clean);
    else resetActiveTabTitle();
    editing = false;
    draft = '';
  }

  function cancelRename(): void {
    editing = false;
    draft = '';
  }

  function titleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }
</script>

<div class="bs-reqhead">
  <button
    class="bs-proto"
    type="button"
    title={t('proto.tip', { type: tab.protocol === 'grpc' ? 'gRPC' : 'HTTP' })}
    aria-label={t('proto.aria')}
    aria-haspopup="menu"
    onclick={onSwitch}
  >
    <span
      class="material-symbols-outlined"
      aria-hidden="true"
      style:color={tab.protocol === 'grpc' ? 'var(--method-grpc)' : undefined}
      >{tab.protocol === 'grpc' ? 'hub' : 'language'}</span
    >
  </button>
  <div class="bs-reqtitle">
    <span class="bs-crumb"
      >{origin
        ? `${folderName ?? t('workspace.title')}  /  ${tab.protocol === 'grpc' ? callType : tab.request.method}`
        : `${t('nav.welcome.newRequest')}  /  ${tab.protocol === 'grpc' ? 'gRPC' : t('nav.header.unsaved')}`}</span
    >
    {#if editing}
      <input
        class="nm title-input"
        aria-label={t('nav.header.renameAria')}
        bind:this={input}
        bind:value={draft}
        onblur={commitRename}
        onkeydown={titleKeydown}
      />
    {:else}
      <span class="bs-title-row">
        <button class="nm rename" class:draft={!origin} title={t('nav.header.rename')} onclick={startRename}
          >{tab.title}</button
        >
        {#if tab.savedPath && dirtyTabIds.current.has(tab.id)}<span class="bs-modified"
            ><span class="dot" aria-hidden="true"></span>{t('nav.header.modified')}</span
          >{/if}
      </span>
    {/if}
  </div>
  <Spacer />
  <div class="bs-savegrp">
    <button
      class="bs-save bs-save-main"
      class:saved={savedFlash}
      class:primary={dirtyTabIds.current.has(tab.id)}
      title={tab.savedPath ? t('nav.header.saveTip') : t('nav.header.saveToTip')}
      aria-label={t('nav.header.save')}
      onclick={onSmartSave}
    >
      <span class="material-symbols-outlined" aria-hidden="true">save</span><span class="lbl"
        >{t('nav.header.save')}</span
      ><kbd>⌘S</kbd>
    </button>
    <button
      class="bs-hb"
      class:on={codeOpen}
      title={t('nav.header.codeTip')}
      aria-label={t('nav.header.code')}
      aria-pressed={codeOpen}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={onCode}><span class="material-symbols-outlined">code</span></button
    >
    {#if codeOpen}<CodeSnippetPopover {tab} onClose={onCode} />{/if}
  </div>
</div>

<style>
  @media (max-width: 760px) {
    :global(.bs) .bs-reqhead :global(.nm) {
      font-size: 17px;
    }
  }

  /* Request pane (HTTP, and the parts gRPC shares): header, URL bar, method menu, send/save,
     request tabs, params/headers/auth/body editors, production guard, code snippet. */
  .bs-reqhead :global(.nm) {
    letter-spacing: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .bs-reqhead :global(.nm.rename) {
    max-width: min(520px, 48vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    border-radius: 6px;
    padding: 3px 5px;
    margin-left: -5px;
  }

  .bs-reqhead :global(.nm.rename:hover) {
    background: var(--hover);
  }

  .bs-reqhead {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* Request header: eyebrow crumb over a 22px title; actions in one capsule */
  .bs-reqhead {
    display: flex;
    backdrop-filter: none;
    box-shadow: none;
    flex: none;
    height: auto;
    min-height: 70px;
    padding: 12px 20px 14px;
    gap: 12px;
    align-items: flex-end;
    border: 0;
    background: transparent;
  }

  :global(.bs) .bs-reqhead :global(.nm) {
    margin: 0;
    padding: 0 6px;
    height: 27px;
    line-height: 27px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    font-size: 22px;
    letter-spacing: -0.5px;
    font-weight: 600;
    color: var(--color-text);
    text-align: left;
  }

  :global(:root[data-density='compact']) .bs-reqhead {
    min-height: 60px;
    padding: 8px 14px;
  }

  @media (max-width: 760px) {
    .bs-reqhead {
      padding-inline: 9px;
      padding-left: 12px;
      padding-right: 12px;
    }
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs button.bs-hb` (same elements, same specificity), so it lives here. */
  :global(:where(.bs)) button.bs-hb:hover {
    background: var(--hover);
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs button.bs-save` (same elements, same specificity), so it lives here. */
  :global(:where(.bs)) button.bs-save:hover {
    background: var(--hover);
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs :is(.bs-menu,.bs-method-menu,.bs-work-menu,.bs-tab-ctx,.bs-grpc-menu) button` (same elements, same specificity), so it lives here. */
  :global(.bs) button.bs-hb {
    border-radius: 5px;
    padding: 0 4px;
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs :is(.bs-menu,.bs-method-menu,.bs-work-menu,.bs-tab-ctx,.bs-grpc-menu) button` (same elements, same specificity), so it lives here. */
  :global(.bs) button.bs-save {
    height: 32px;
    background: var(--side);
    border: 0;
    border-radius: 4px;
    box-shadow: none;
    color: var(--t2);
    font-size: 12px;
  }

  @media (max-width: 900px) {
    /* Only the avatar; the full name stays in the chip's tooltip. */
    :global(.bs) .bs-savegrp .bs-save-main :global(:is(.lbl, kbd)) {
      display: none;
    }

    :global(.bs) .bs-savegrp button.bs-save-main {
      width: 30px;
      padding: 0;
      justify-content: center;
    }
  }

  @media (max-width: 760px) {
    :global(.bs-reqhead) .bs-crumb {
      display: none;
    }
  }

  .bs-hb {
    height: 30px;
    padding: 0 8px;
    border-radius: 8px;
    border: 0.5px solid var(--sep);
    background: var(--surface);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .bs-hb:hover {
    background: var(--hover2);
  }

  :global(:where(.bs-reqhead)) .nm.title-input {
    width: min(520px, 48vw);
    max-width: min(520px, 48vw);
    height: 30px;
    padding: 0 8px;
    margin-left: -6px;
    color: var(--text);
    background: var(--surface);
    border: 0.5px solid rgba(10, 132, 255, 0.62);
    border-radius: 7px;
    outline: none;
    box-shadow: var(--focus-ring), var(--shadow-sm);
    letter-spacing: 0;
  }

  .bs-save {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px;
    border-radius: 7px;
    border: 0.5px solid var(--sep);
    font-size: 12.5px;
    font-weight: 500;
    background: var(--surface);
  }

  .bs-save:hover {
    background: var(--hover2);
  }

  :global(.bs) .bs-savegrp .bs-save-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .bs-save.saved {
    color: var(--green);
  }

  .bs-save.saved :global(.material-symbols-outlined) {
    color: var(--green);
  }

  .bs-save :global(svg) {
    width: 14px;
    height: 14px;
    color: var(--t2);
  }

  :global(.bs) button.bs-hb {
    height: 26px;
  }

  .bs-reqtitle {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    margin-left: -6px;
  }

  .bs-crumb {
    display: block;
    white-space: pre;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    padding-left: 6px;
  }

  :global(.bs .bs-reqhead) .nm.draft {
    color: var(--color-text-secondary);
  }

  .bs-savegrp {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 2px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    overflow: visible;
  }

  :global(.bs) .bs-savegrp button.bs-save {
    height: 30px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    box-shadow: none;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-savegrp button.bs-save-main {
    padding: 0 12px 0 10px;
    gap: 6px;
    background: var(--color-raised);
    color: var(--color-text);
    font-size: var(--font-size-body);
    font-weight: 600;
  }

  :global(.bs) .bs-savegrp button.bs-save-main :global(kbd) {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    opacity: 1;
  }

  :global(.bs) .bs-savegrp button.bs-hb.on {
    background: var(--color-raised);
    color: var(--color-text);
  }

  :global(.bs) .bs-savegrp button.bs-hb {
    height: 30px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    box-shadow: none;
    color: var(--color-text-secondary);
    width: 30px;
    padding: 0;
    justify-content: center;
    border-left: 0;
  }

  :global(.bs) .bs-savegrp :global(button:hover) {
    background: var(--hover-strong);
    color: var(--color-text);
  }

  /* Direct buttons only: the code popover also renders inside .bs-savegrp. */
  :global(.bs) .bs-savegrp > :global(button .material-symbols-outlined) {
    font-size: 17px;
  }

  :global(.bs) .bs-savegrp .bs-save-main :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-save.saved {
    color: var(--color-success);
  }

  :global(.bs) .bs-save.saved :global(.material-symbols-outlined) {
    color: var(--color-success);
  }

  :global(:root[data-density='compact']) .bs-savegrp {
    height: 32px;
  }

  :global(:root[data-density='compact'] .bs) .bs-savegrp button.bs-save {
    height: 26px;
  }

  :global(:root[data-density='compact'] .bs) .bs-savegrp button.bs-hb {
    height: 26px;
    width: 26px;
  }

  :global(.bs) .bs-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 100%;
  }

  :global(.bs) .bs-modified {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px 0 7px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
    white-space: nowrap;
  }

  :global(.bs) .bs-modified :global(.dot) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text);
  }

  :global(.bs) .bs-savegrp button.bs-save-main.primary {
    background: var(--color-action);
    color: var(--color-on-action);
  }

  :global(.bs) .bs-savegrp button.bs-save-main.primary:hover {
    background: var(--color-action);
    color: var(--color-on-action);
  }

  :global(.bs) .bs-savegrp button.bs-save-main.primary :global(kbd) {
    color: var(--color-on-action);
    opacity: 0.7;
  }

  :global(.bs) .bs-savegrp {
    position: relative;
  }

  /* Protocol button (Q34l0k): 28px field capsule left of the request title. */
  .bs-proto {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-bottom: 1px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 9px;
    background: var(--color-field);
    color: var(--color-text-secondary);
  }

  .bs-proto:hover {
    background: var(--hover-strong);
    color: var(--color-text);
  }

  .bs-proto:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }

  .bs-proto :global(.material-symbols-outlined) {
    font-size: 16px;
  }
</style>
