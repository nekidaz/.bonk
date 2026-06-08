<script lang="ts">
  import { tabs, activeTabId, collections, saveActiveRequest, addFolder } from '../stores';
  import { findNode, parentId } from '../domain/tree';
  import FolderPicker from './FolderPicker.svelte';

  // `open` is the trigger held by the parent (App.svelte). The name/target state
  // lives here; the dialog seeds itself from the active tab each time it opens.
  let { open = $bindable(), onSaved }: { open: boolean; onSaved?: () => void } = $props();

  const active = $derived($tabs.find((t) => t.id === $activeTabId));

  let name = $state('');
  let targetId = $state<string | undefined>(undefined); // folder id; undefined = root

  // Seed name + destination folder when the dialog opens, replicating the
  // original openSaveDialog seeding logic.
  $effect(() => {
    if (open && active) {
      name = active.title;
      targetId = active.savedPath ? parentId(active.savedPath) : undefined;
    }
  });

  async function confirmSave(): Promise<void> {
    try {
      await saveActiveRequest(targetId, name);
      open = false;
      onSaved?.();
    } catch (err) {
      console.error('workspace: confirmSave failed', err);
    }
  }

  async function newFolderInDialog(): Promise<void> {
    const id = await addFolder(targetId);
    if (id) targetId = id;
  }
</script>

{#if open}
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h">
        <span class="t">Save Request</span>
        <button class="x" aria-label="Close" onclick={() => (open = false)}><span class="material-symbols-outlined" style="font-size:18px">close</span></button>
      </div>
      <div class="bs-modal-b">
        <div class="bs-flabel">Request name</div>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="bs-input" bind:value={name} autofocus />
        <span class="bs-link">Add description</span>
        <div class="bs-saveto">Save to <span>{targetId ? (findNode($collections, targetId)?.name ?? '—') : 'Workspace root'}</span></div>
        <div class="bs-collbox">
          <div class="bs-colllist">
            <FolderPicker nodes={$collections} bind:selected={targetId} />
          </div>
        </div>
      </div>
      <div class="bs-modal-f">
        <button class="bs-btn link" onclick={newFolderInDialog}><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">add</span> New Folder</button>
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={confirmSave}>Save</button>
        <button class="bs-btn ghost" onclick={() => (open = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
