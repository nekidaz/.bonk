<script lang="ts">
  import { renameActiveTab, resetActiveTabTitle } from '../stores';
  import type { Tab } from '../domain/types';

  let {
    tab,
    savedFlash,
    onSwitch,
    onSmartSave,
    onOpenSave,
    onCode,
  }: {
    tab: Tab;
    savedFlash: boolean;
    onSwitch: (e: MouseEvent) => void;
    onSmartSave: () => void | Promise<void>;
    onOpenSave: () => void;
    onCode: () => void;
  } = $props();

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
  <button class="bs-hb" onclick={onSwitch}>
    <span class="material-symbols-outlined ti2" style="font-size:18px;color:#2aa3ff">{tab.protocol === 'grpc' ? 'lan' : 'language'}</span>
    <span class="material-symbols-outlined cv2" style="font-size:12px;color:var(--t3)">expand_more</span>
  </button>
  {#if editing}
    <input
      class="nm title-input"
      aria-label="Request name"
      bind:this={input}
      bind:value={draft}
      onblur={commitRename}
      onkeydown={titleKeydown}
    />
  {:else}
    <button class="nm rename" title="Rename request" onclick={startRename}>{tab.title}</button>
  {/if}
  <span class="star"><span class="material-symbols-outlined" style="font-size:15px">star</span></span>
  <div class="bs-spacer"></div>
  <div class="bs-savegrp">
    <button class="bs-save bs-save-main" class:saved={savedFlash} title={tab.savedPath ? 'Save (⌘S)' : 'Save to…  (⌘S)'} onclick={onSmartSave}>
      <span class="material-symbols-outlined" style="font-size:14px">{savedFlash ? 'check' : 'save'}</span>{savedFlash ? 'Saved' : 'Save'}
    </button>
    <button class="bs-save bs-save-more" title="Save to folder…" onclick={onOpenSave}><span class="material-symbols-outlined" style="font-size:14px">expand_more</span></button>
  </div>
  {#if tab.protocol !== 'grpc'}
    <button class="bs-share" title="View code (cURL)" onclick={onCode}>
      <span class="material-symbols-outlined" style="font-size:14px">code</span>Code
    </button>
  {/if}
</div>
