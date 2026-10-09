<script lang="ts">
  import { moveNode, findNode, workspace } from '$entities/workspace';
  import { FolderPicker } from '$entities/workspace/components';
  import { t } from '$shared/i18n';

  // `open` is the trigger held by the parent (app/ `shell.moveOpen`); `sourceId` is the node
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
        <span class="t">{t('dialog.move.title')}</span>
        <button class="x" aria-label={t('common.close')} onclick={() => (open = false)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </div>
      <div class="bs-modal-b">
        <div class="bs-saveto">
          {t('dialog.move.to')}
          <span>{moveTarget ? (findNode(workspace.tree, moveTarget)?.name ?? '—') : t('dialog.move.root')}</span>
        </div>
        <div class="bs-collbox">
          <div class="bs-colllist">
            <FolderPicker nodes={workspace.tree} bind:selected={moveTarget} excludeId={sourceId} />
          </div>
        </div>
      </div>
      <div class="bs-modal-f">
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={confirmMove}>{t('dialog.move.confirm')}</button>
        <button class="bs-btn ghost" onclick={() => (open = false)}>{t('common.cancel')}</button>
      </div>
    </div>
  </div>
{/if}
