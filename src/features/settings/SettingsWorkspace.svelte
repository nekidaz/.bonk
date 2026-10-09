<script lang="ts">
  import { t } from '$shared/i18n';
  import { openWorkspaceFolder, workspacePath, renameWorkspaceFolder, deleteWorkspace } from '$entities/workspace';
  import { requestConfirm } from '$shared/ui';
  import { row } from './ui.svelte';

  const name = $derived($workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
  let draft = $state('');
  let error = $state('');
  $effect(() => {
    draft = name;
  });

  async function run(fn: () => Promise<void>): Promise<void> {
    error = '';
    try {
      await fn();
    } catch (e) {
      error = String(e);
      draft = name;
    }
  }
  const rename = () =>
    draft.trim() && draft.trim() !== name ? run(() => renameWorkspaceFolder(draft)) : (draft = name);
  async function remove(): Promise<void> {
    if (await requestConfirm($t('settings.ws.delete.confirm', { name }), $t('common.delete')))
      await run(deleteWorkspace);
  }
</script>

<div class="st-card">
  {#snippet change()}<button type="button" class="bs-btn ghost" onclick={openWorkspaceFolder}
      >{$workspacePath ? $t('settings.ws.change') : $t('settings.ws.choose')}</button
    >{/snippet}
  {@render row($t('settings.ws.folder'), $workspacePath || $t('settings.ws.none'), change)}
  {#if name}
    {#snippet nm()}
      <input
        class="st-text"
        style="width:200px"
        aria-label={$t('settings.ws.name.aria')}
        bind:value={draft}
        onchange={rename}
        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    {/snippet}
    {@render row($t('settings.ws.name'), $t('settings.ws.name.desc'), nm)}
    {#snippet del()}<button type="button" class="bs-btn ghost danger" onclick={remove}
        >{$t('settings.ws.delete.btn')}</button
      >{/snippet}
    {@render row($t('settings.ws.delete'), $t('settings.ws.delete.desc'), del, true)}
  {/if}
  {#if error}<div class="st-err">{error}</div>{/if}
</div>
