<script lang="ts">
  import { collections, saveFolderAuth, findNode } from '$entities/workspace';
  import type { AuthConfig } from '$shared/model';
  import { HttpAuthEditor } from '$entities/request/components';
  import { t } from '$shared/i18n';

  // Collection-level auth (S11): requests set to "inherit" use it. `folderId` open = shown.
  let { folderId = $bindable() }: { folderId: string | undefined } = $props();

  const folder = $derived(folderId ? findNode($collections, folderId) : undefined);
  let draft = $state<AuthConfig | undefined>(undefined);
  $effect(() => {
    draft = folder?.kind === 'folder' ? folder.auth : undefined;
  });

  function save(): void {
    if (folderId) void saveFolderAuth(folderId, draft && draft.type !== 'inherit' ? draft : null);
    folderId = undefined;
  }
</script>

{#if folder?.kind === 'folder'}
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h">
        <span class="t">{$t('dialog.auth.title', { name: folder.name })}</span>
        <button class="x" aria-label={$t('common.close')} onclick={() => (folderId = undefined)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </div>
      <div class="bs-modal-b">
        <HttpAuthEditor value={draft} onChange={(a) => (draft = a)} />
      </div>
      <div class="bs-modal-f">
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={save}>{$t('common.save')}</button>
        <button class="bs-btn ghost" onclick={() => (folderId = undefined)}>{$t('common.cancel')}</button>
      </div>
    </div>
  </div>
{/if}
