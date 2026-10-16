<script lang="ts">
  import { tabs } from '$entities/tab';
  import { addFolder, findNode, parentId, workspace } from '$entities/workspace';
  import { saveActiveRequest } from './store';
  import { dialogs } from './dialogs.svelte';
  import { FolderPicker, SaveTo, CollList, CollBox } from '$entities/workspace/components';
  import { t } from '$shared/i18n';
  import { Button, Overlay, Modal, ModalHeader, ModalBody, ModalFooter, TextInput } from '$shared/ui/components';

  // Opened through `requestSaveDialog()` (stores): App's Save / Save As and the
  // close-tab “Save” prompt all await the same dialog. The name/target state
  // lives here; the dialog seeds itself from the active tab each time it opens.
  let { onSaved }: { onSaved?: () => void } = $props();

  const open = $derived(!!dialogs.save);
  const copy = $derived(!!dialogs.save?.copy);

  function close(saved: boolean): void {
    dialogs.save?.resolve(saved);
    dialogs.save = null;
  }

  const active = $derived(tabs.active);

  let name = $state('');
  let targetId = $state<string | undefined>(undefined); // folder id; undefined = root
  let saveError = $state('');

  // Seed name + destination folder when the dialog opens, replicating the
  // original openSaveDialog seeding logic.
  $effect(() => {
    if (open && active) {
      name = active.title;
      targetId = active.savedPath ? parentId(active.savedPath) : undefined;
      saveError = '';
    }
  });

  async function confirmSave(): Promise<void> {
    saveError = '';
    try {
      await saveActiveRequest(targetId, name, copy);
      close(true);
      onSaved?.();
    } catch (err) {
      // Keep the dialog open and show why, so the user never thinks a failed
      // save succeeded and loses their edits.
      saveError = err instanceof Error ? err.message : String(err);
      console.error('workspace: confirmSave failed', err);
    }
  }

  async function newFolderInDialog(): Promise<void> {
    const id = await addFolder(targetId);
    if (id) targetId = id;
  }
</script>

{#if open}
  <Overlay role="dialog" aria-modal="true">
    <Modal>
      <ModalHeader>
        <span class="t">{copy ? t('dialog.save.copyTitle') : t('dialog.save.title')}</span>
        <button class="x" aria-label={t('common.close')} onclick={() => close(false)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </ModalHeader>
      <ModalBody>
        <label class="bs-flabel" for="bs-save-name">{t('dialog.save.name')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <TextInput
          id="bs-save-name"
          bind:value={name}
          autofocus
          aria-invalid={!!saveError}
          aria-describedby={saveError ? 'bs-save-error' : undefined}
        />
        <SaveTo>
          {t('dialog.save.to')}
          <span>{targetId ? (findNode(workspace.tree, targetId)?.name ?? '—') : t('dialog.move.root')}</span>
        </SaveTo>
        <CollBox>
          <CollList>
            <FolderPicker nodes={workspace.tree} bind:selected={targetId} />
          </CollList>
        </CollBox>
        {#if saveError}<div class="bs-form-error" id="bs-save-error" role="alert">{saveError}</div>{/if}
      </ModalBody>
      <ModalFooter>
        <Button variant="link" onclick={newFolderInDialog}
          ><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">add</span>
          {t('dialog.save.newFolder')}</Button
        >
        <div class="grow"></div>
        <Button variant="primary" onclick={confirmSave}>{t('common.save')}</Button>
        <Button variant="ghost" onclick={() => close(false)}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  </Overlay>
{/if}

<style>
  .bs-flabel {
    display: block;
    font-size: 12.5px;
    color: var(--t2);
    margin: 8px 0 6px;
    font-weight: 600;
  }

  .bs-form-error {
    margin-top: 8px;
    color: var(--red);
    font-family: var(--mono);
    font-size: 12px;
    white-space: pre-wrap;
  }

  .bs-form-error::before {
    content: '! ';
    font-weight: 700;
  }
</style>
