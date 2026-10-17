<script lang="ts">
  import { saveFolderScripts, findNode, workspace } from '$entities/workspace';
  import type { ScriptStage } from '$shared/model';
  import { ScriptsEditor } from '$shared/editor/components';
  import { t } from '$shared/i18n';
  import { Button, Overlay, Modal, ModalHeader, ModalBody, ModalFooter } from '$shared/ui/components';

  // Folder-level scripts (Postman's collection/folder scripts): every request under the folder runs
  // them before its own. `folderId` open = shown.
  let { folderId = $bindable() }: { folderId: string | undefined } = $props();

  const folder = $derived(folderId ? findNode(workspace.tree, folderId) : undefined);
  let pre = $state('');
  let test = $state('');
  let stage = $state<ScriptStage>('pre');
  $effect(() => {
    pre = folder?.kind === 'folder' ? (folder.preRequestScript ?? '') : '';
    test = folder?.kind === 'folder' ? (folder.testScript ?? '') : '';
    stage = 'pre';
  });

  function save(): void {
    if (folderId) void saveFolderScripts(folderId, pre, test);
    folderId = undefined;
  }
</script>

{#if folder?.kind === 'folder'}
  <Overlay role="dialog" aria-modal="true">
    <Modal class="bs-folder-scripts-modal">
      <ModalHeader>
        <span class="t">{t('dialog.scripts.title', { name: folder.name })}</span>
        <button class="x" aria-label={t('common.close')} onclick={() => (folderId = undefined)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </ModalHeader>
      <ModalBody>
        <p class="hint">{t('dialog.scripts.hint')}</p>
        <ScriptsEditor
          preRequestScript={pre}
          testScript={test}
          onPreRequestChange={(v) => (pre = v)}
          onTestChange={(v) => (test = v)}
          docId={`folder:${folder.id}`}
          {stage}
          onStage={(s) => (stage = s)}
        />
      </ModalBody>
      <ModalFooter>
        <div class="grow"></div>
        <Button variant="primary" onclick={save}>{t('common.save')}</Button>
        <Button variant="ghost" onclick={() => (folderId = undefined)}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  </Overlay>
{/if}

<style>
  :global(:root .bs .bs-modal.bs-folder-scripts-modal) {
    width: 940px;
    height: 72vh;
  }
  :global(.bs-folder-scripts-modal .bs-modal-b) {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-bottom: 0;
  }
  .hint {
    margin: 0 14px 4px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
</style>
