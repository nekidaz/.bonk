<script lang="ts">
  import { tabs, activeTabId } from '$entities/tab';
  import { collections, addFolder, findNode, parentId } from '$entities/workspace';
  import { saveActiveRequest } from './store';
  import { saveDialog } from './dialogs';
  import { FolderPicker } from '$entities/workspace/components';
  import { t } from '$shared/i18n';

  // Opened through `requestSaveDialog()` (stores): App's Save / Save As and the
  // close-tab «Сохранить» prompt all await the same dialog. The name/target state
  // lives here; the dialog seeds itself from the active tab each time it opens.
  let { onSaved }: { onSaved?: () => void } = $props();

  const open = $derived(!!$saveDialog);
  const copy = $derived(!!$saveDialog?.copy);

  function close(saved: boolean): void {
    $saveDialog?.resolve(saved);
    saveDialog.set(null);
  }

  const active = $derived($tabs.find((tb) => tb.id === $activeTabId));

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
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h">
        <span class="t">{copy ? t('dialog.save.copyTitle') : t('dialog.save.title')}</span>
        <button class="x" aria-label={t('common.close')} onclick={() => close(false)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </div>
      <div class="bs-modal-b">
        <label class="bs-flabel" for="bs-save-name">{t('dialog.save.name')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="bs-input"
          id="bs-save-name"
          bind:value={name}
          autofocus
          aria-invalid={!!saveError}
          aria-describedby={saveError ? 'bs-save-error' : undefined}
        />
        <div class="bs-saveto">
          {t('dialog.save.to')}
          <span>{targetId ? (findNode($collections, targetId)?.name ?? '—') : t('dialog.move.root')}</span>
        </div>
        <div class="bs-collbox">
          <div class="bs-colllist">
            <FolderPicker nodes={$collections} bind:selected={targetId} />
          </div>
        </div>
        {#if saveError}<div class="bs-form-error" id="bs-save-error" role="alert">{saveError}</div>{/if}
      </div>
      <div class="bs-modal-f">
        <button class="bs-btn link" onclick={newFolderInDialog}
          ><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">add</span>
          {t('dialog.save.newFolder')}</button
        >
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={confirmSave}>{t('common.save')}</button>
        <button class="bs-btn ghost" onclick={() => close(false)}>{t('common.cancel')}</button>
      </div>
    </div>
  </div>
{/if}
