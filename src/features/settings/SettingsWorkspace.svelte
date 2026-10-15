<script lang="ts">
  import { t } from '$shared/i18n';
  import { openWorkspaceFolder, renameWorkspaceFolder, deleteWorkspace, workspace } from '$entities/workspace';
  import { requestConfirm } from '$shared/ui';
  import { AUTO_FETCH_MINUTES, GIT_ENABLED, PULL_MODES, git, gitAutoFetch, gitPullMode } from '$entities/git';
  import { gitRemoteAdd, gitRemoteList, gitRemoteRemove } from '$shared/ipc';
  import type { GitRemote } from '$shared/model';
  import { row, seg } from './ui.svelte';
  import { Button } from '$shared/ui/components';

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
  // ---- Git remotes ----
  let remotes = $state.raw<GitRemote[]>([]);
  let remoteName = $state('');
  let remoteUrl = $state('');
  let remoteError = $state('');
  const isRepo = $derived(GIT_ENABLED && !!git.status?.isRepo);

  $effect(() => {
    const root = workspace.path;
    if (root && isRepo) void loadRemotes(root);
  });

  async function loadRemotes(root: string): Promise<void> {
    try {
      remotes = await gitRemoteList(root);
    } catch (e) {
      remoteError = String(e);
    }
  }

  async function remoteOp(fn: (root: string) => Promise<void>): Promise<void> {
    const root = workspace.path;
    if (!root) return;
    remoteError = '';
    try {
      await fn(root);
      await loadRemotes(root);
    } catch (e) {
      remoteError = String(e);
    }
  }

  async function addRemote(): Promise<void> {
    if (!remoteName.trim() || !remoteUrl.trim()) return;
    await remoteOp((root) => gitRemoteAdd(root, remoteName.trim(), remoteUrl.trim()));
    if (!remoteError) remoteName = remoteUrl = '';
  }

  async function removeRemote(r: GitRemote): Promise<void> {
    if (await requestConfirm(t('settings.git.remoteRemove.confirm', { name: r.name }), t('common.delete')))
      await remoteOp((root) => gitRemoteRemove(root, r.name));
  }

  async function remove(): Promise<void> {
    if (await requestConfirm(t('settings.ws.delete.confirm', { name }), t('common.delete'))) await run(deleteWorkspace);
  }
</script>

<div class="st-card">
  {#snippet change()}<Button variant="ghost" onclick={openWorkspaceFolder}
      >{workspace.path ? t('settings.ws.change') : t('settings.ws.choose')}</Button
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
    {#snippet del()}<Button variant="ghost-danger" onclick={remove}>{t('settings.ws.delete.btn')}</Button>{/snippet}
    {@render row(t('settings.ws.delete'), t('settings.ws.delete.desc'), del, true)}
  {/if}
  {#if error}<div class="st-err">{error}</div>{/if}
</div>

{#if isRepo}
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
    {#snippet pm()}{@render seg(
        t('settings.git.pull'),
        gitPullMode.current,
        PULL_MODES.map((m) => ({ label: t(`settings.git.pull.${m}`), value: m })),
        (v) => (gitPullMode.current = v as (typeof PULL_MODES)[number]),
      )}{/snippet}
    {@render row(t('settings.git.pull'), t('settings.git.pull.desc'), pm)}
  </div>

  <div class="st-group">{t('settings.git.remotes')}</div>
  <div class="st-card">
    {#each remotes as r (r.name)}
      {#snippet rm()}<Button variant="ghost-danger" onclick={() => removeRemote(r)}>{t('common.delete')}</Button
        >{/snippet}
      {@render row(r.name, r.url, rm)}
    {/each}
    {#snippet add()}
      <span class="st-remote-add">
        <input
          class="st-text"
          style="width:110px"
          placeholder={t('settings.git.remoteName')}
          aria-label={t('settings.git.remoteName')}
          bind:value={remoteName}
        />
        <input
          class="st-text"
          style="width:260px"
          placeholder="git@github.com:team/api.git"
          aria-label={t('settings.git.remoteUrl')}
          bind:value={remoteUrl}
          onkeydown={(e) => e.key === 'Enter' && void addRemote()}
        />
        <Button variant="ghost" disabled={!remoteName.trim() || !remoteUrl.trim()} onclick={addRemote}
          >{t('settings.git.remoteAdd')}</Button
        >
      </span>
    {/snippet}
    {@render row(t('settings.git.remoteNew'), '', add)}
    {#if remoteError}<div class="st-err">{remoteError}</div>{/if}
  </div>
{/if}

<style>
  .st-remote-add {
    display: inline-flex;
    gap: 8px;
  }
</style>
