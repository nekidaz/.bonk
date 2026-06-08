<script lang="ts">
  import { collections, moveNode } from '../stores';
  import { findNode } from '../domain/tree';
  import FolderPicker from './FolderPicker.svelte';

  // `open` is the trigger held by the parent (App.svelte); `sourceId` is the node
  // being moved. The chosen destination lives here (undefined = workspace root).
  let { open = $bindable(), sourceId }: { open: boolean; sourceId: string } = $props();

  let moveTarget = $state<string | undefined>(undefined);

  // Reset the destination each time the dialog opens, replicating the original
  // nodeMove() which set moveTargetId = undefined before opening.
  $effect(() => {
    if (open) moveTarget = undefined;
  });

  function confirmMove(): void {
    if (sourceId) void moveNode(sourceId, moveTarget);
    open = false;
  }
</script>

{#if open}
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h">
        <span class="t">Move to folder</span>
        <button class="x" aria-label="Close" onclick={() => (open = false)}><span class="material-symbols-outlined" style="font-size:18px">close</span></button>
      </div>
      <div class="bs-modal-b">
        <div class="bs-saveto">Move to <span>{moveTarget ? (findNode($collections, moveTarget)?.name ?? '—') : 'Workspace root'}</span></div>
        <div class="bs-collbox">
          <div class="bs-colllist">
            <FolderPicker nodes={$collections} bind:selected={moveTarget} excludeId={sourceId} />
          </div>
        </div>
      </div>
      <div class="bs-modal-f">
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={confirmMove}>Move</button>
        <button class="bs-btn ghost" onclick={() => (open = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
