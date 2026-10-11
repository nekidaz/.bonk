<script lang="ts">
  /**
   * G10: one stash as a tab — where it was made, its files as full diffs, and Drop (asks first),
   * Branch from stash, Apply, Pop. Once popped or dropped the stash is gone and the tab says so.
   */
  import { workspace } from '$entities/workspace';
  import { git, relativeAgo, stashApply, stashBranch, stashDrop, stashPop } from '$entities/git';
  import { gitStashShow } from '$shared/ipc';
  import { requestConfirm } from '$shared/ui';
  import type { StashFile, Tab } from '$shared/model';
  import { t, tp, uiLanguage } from '$shared/i18n';
  import FileDiff from './FileDiff.svelte';
  import { diffLayout } from './store.svelte';

  let { tab }: { tab: Tab } = $props();

  let files = $state.raw<StashFile[]>([]);
  let error = $state('');
  let branching = $state(false);
  let branchName = $state('');
  let loadSeq = 0;

  const stash = $derived(git.stashes.find((s) => s.hash === tab.git?.path));
  const age = $derived(stash ? relativeAgo(stash.time, Date.now(), uiLanguage.current) : '');

  $effect(() => {
    const root = workspace.path;
    const index = stash?.index;
    if (root && index !== undefined) void load(root, index);
  });

  async function load(root: string, index: number): Promise<void> {
    const seq = ++loadSeq;
    try {
      const result = await gitStashShow(root, index);
      if (seq !== loadSeq) return;
      files = result;
      error = '';
    } catch (err) {
      if (seq === loadSeq) error = String(err);
    }
  }

  async function drop(): Promise<void> {
    if (stash && (await requestConfirm(t('git.stash.dropConfirm', { name: stash.message }), t('git.stash.drop'))))
      await stashDrop(stash.index);
  }

  async function makeBranch(): Promise<void> {
    if (stash && branchName.trim() && (await stashBranch(branchName, stash.index))) branching = false;
  }
</script>

<div class="bs-gview">
  {#if !stash}
    <div class="bs-gview-empty">{t('git.stash.gone')}</div>
  {:else}
    <div class="bs-ghead">
      <div class="ttl">
        <span class="crumb"
          >{`stash@{${stash.index}}  ·  ${t('git.stash.on', { branch: stash.branch || 'HEAD' })}  ·  ${stash.short}`}</span
        >
        <div class="row">
          <h2>{stash.message}</h2>
          <span class="bs-gtag"
            >{`${files.length} ${tp(files.length, ['файл', 'файла', 'файлов'], ['file', 'files'])} · ${age}`}</span
          >
        </div>
      </div>
      {#if branching}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="bs-input stash-branch"
          placeholder={t('git.branch.newPlaceholder')}
          bind:value={branchName}
          autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') void makeBranch();
            else if (e.key === 'Escape') branching = false;
          }}
          onblur={() => (branching = false)}
        />
      {/if}
      <button class="bs-gbtn danger" onclick={drop}
        ><span class="material-symbols-outlined">delete</span>{t('git.stash.drop')}</button
      >
      <button
        class="bs-gbtn"
        onclick={() => {
          branchName = '';
          branching = true;
        }}><span class="material-symbols-outlined">fork_right</span>{t('git.stash.branch')}</button
      >
      <button class="bs-gbtn" onclick={() => stashApply(stash!.index)}
        ><span class="material-symbols-outlined">content_copy</span>{t('git.stash.apply')}</button
      >
      <button class="bs-gbtn inv" onclick={() => stashPop(stash!.index)}
        ><span class="material-symbols-outlined">download</span>{t('git.stash.pop')}</button
      >
    </div>
    <div class="bs-gview-body">
      {#if git.error}<div class="bs-git-diff-error">{git.error}</div>{/if}
      {#if error}
        <div class="bs-git-diff-error">{error}</div>
      {/if}
      {#each files as f (f.path)}
        <div class="file">
          <FileDiff
            path={f.path}
            text={f.diff}
            layout={diffLayout.current}
            leftLabel={`HEAD  ${stash.short}^`}
            rightLabel={`stash@{${stash.index}}`}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .file {
    flex: none;
    display: flex;
    max-height: none;
  }
  .stash-branch {
    width: 200px;
    height: 30px;
    border-radius: var(--radius-control);
  }
</style>
