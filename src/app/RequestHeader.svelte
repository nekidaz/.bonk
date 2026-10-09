<script lang="ts">
  import { findNode, parentId, workspace } from '$entities/workspace';
  import { dirtyTabIds } from '$entities/request';
  import { history } from '$entities/history';
  import { renameActiveTab, resetActiveTabTitle } from '$features/tabs';
  import { CodeSnippetPopover } from '$features/codegen/components';
  import type { Tab } from '$shared/model';
  import { t } from '$shared/i18n';

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
  <div class="bs-spacer"></div>
  <div class="bs-savegrp">
    <button
      class="bs-save bs-save-main"
      class:saved={savedFlash}
      class:primary={dirtyTabIds.current.has(tab.id)}
      title={tab.savedPath ? t('nav.header.saveTip') : t('nav.header.saveToTip')}
      onclick={onSmartSave}
    >
      <span class="material-symbols-outlined" aria-hidden="true">save</span>{t('nav.header.save')}<kbd>⌘S</kbd>
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
