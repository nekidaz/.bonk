<script lang="ts">
  import { moveNode, findNode, workspace } from '$entities/workspace';
  import { FolderPicker, SaveTo, CollList, CollBox } from '$entities/workspace/components';
  import { t } from '$shared/i18n';
  import { Button, Overlay, Modal, ModalHeader, ModalBody, ModalFooter } from '$shared/ui/components';

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
  <Overlay role="dialog" aria-modal="true">
    <Modal>
      <ModalHeader>
        <span class="t">{t('dialog.move.title')}</span>
        <button class="x" aria-label={t('common.close')} onclick={() => (open = false)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </ModalHeader>
      <ModalBody>
        <SaveTo>
          {t('dialog.move.to')}
          <span>{moveTarget ? (findNode(workspace.tree, moveTarget)?.name ?? '—') : t('dialog.move.root')}</span>
        </SaveTo>
        <CollBox>
          <CollList>
            <FolderPicker nodes={workspace.tree} bind:selected={moveTarget} excludeId={sourceId} />
          </CollList>
        </CollBox>
      </ModalBody>
      <ModalFooter>
        <div class="grow"></div>
        <Button variant="primary" onclick={confirmMove}>{t('dialog.move.confirm')}</Button>
        <Button variant="ghost" onclick={() => (open = false)}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  </Overlay>
{/if}
