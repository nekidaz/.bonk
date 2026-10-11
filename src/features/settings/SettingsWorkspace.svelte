<script lang="ts">
  import { t } from '$shared/i18n';
  import { openWorkspaceFolder, renameWorkspaceFolder, deleteWorkspace, workspace } from '$entities/workspace';
  import { requestConfirm } from '$shared/ui';
  import { AUTO_FETCH_MINUTES, GIT_ENABLED, git, gitAutoFetch } from '$entities/git';
  import { row, seg } from './ui.svelte';

  const name = $derived(workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
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
    if (await requestConfirm(t('settings.ws.delete.confirm', { name }), t('common.delete'))) await run(deleteWorkspace);
  }
</script>

<div class="st-card">
  {#snippet change()}<button type="button" class="bs-btn ghost" onclick={openWorkspaceFolder}
      >{workspace.path ? t('settings.ws.change') : t('settings.ws.choose')}</button
    >{/snippet}
  {@render row(t('settings.ws.folder'), workspace.path || t('settings.ws.none'), change)}
  {#if name}
    {#snippet nm()}
      <input
        class="st-text"
        style="width:200px"
        aria-label={t('settings.ws.name.aria')}
        bind:value={draft}
        onchange={rename}
        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    {/snippet}
    {@render row(t('settings.ws.name'), t('settings.ws.name.desc'), nm)}
    {#snippet del()}<button type="button" class="bs-btn ghost danger" onclick={remove}
        >{t('settings.ws.delete.btn')}</button
      >{/snippet}
    {@render row(t('settings.ws.delete'), t('settings.ws.delete.desc'), del, true)}
  {/if}
  {#if error}<div class="st-err">{error}</div>{/if}
</div>

{#if GIT_ENABLED && git.status?.isRepo}
  <div class="st-group">Git</div>
  <div class="st-card">
    {#snippet af()}{@render seg(
        t('settings.git.autoFetch'),
        String(gitAutoFetch.current),
        AUTO_FETCH_MINUTES.map((m) => ({
          label: m ? t('settings.git.minutes', { n: m }) : t('settings.git.off'),
          value: String(m),
        })),
        (v) => (gitAutoFetch.current = Number(v)),
      )}{/snippet}
    {@render row(t('settings.git.autoFetch'), t('settings.git.autoFetch.desc'), af)}
  </div>
{/if}
