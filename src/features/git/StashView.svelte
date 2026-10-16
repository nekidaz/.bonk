<script lang="ts">
  /**
   * G10: one stash as a tab — where it was made, its files as full diffs, and Drop (asks first),
   * Branch from stash, Apply, Pop. Once popped or dropped the stash is gone and the tab says so.
   */
  import { GitBranchIcon, TextInput } from '$shared/ui/components';
  import { workspace } from '$entities/workspace';
  import { git, relativeAgo, stashApply, stashBranch, stashDrop, stashPop } from '$entities/git';
  import { gitStashShow } from '$shared/ipc';
  import { requestConfirm } from '$shared/ui';
  import type { StashFile, Tab } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import FileDiff from './FileDiff.svelte';
  import { diffLayout } from './store.svelte';
  import { GitButton, GitHead, GitView, GitViewBody, GitViewEmpty, GitTag, GitError } from '$entities/git/components';

  let { tab }: { tab: Tab } = $props();

  let files = $state.raw<StashFile[]>([]);
  let error = $state('');
  let branching = $state(false);
  let branchName = $state('');
  let loadSeq = 0;

  const stash = $derived(git.stashes.find((s) => s.hash === tab.git?.path));
  const age = $derived(stash ? relativeAgo(stash.time, Date.now()) : '');

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

<GitView>
  {#if !stash}
    <GitViewEmpty>{t('git.stash.gone')}</GitViewEmpty>
  {:else}
    <GitHead>
      <div class="ttl">
        <span class="crumb"
          >{`stash@{${stash.index}}  ·  ${t('git.stash.on', { branch: stash.branch || 'HEAD' })}  ·  ${stash.short}`}</span
        >
        <div class="row">
          <h2>{stash.message}</h2>
          <GitTag>{`${files.length} ${tp(files.length, ['file', 'files'])} · ${age}`}</GitTag>
        </div>
      </div>
      {#if branching}
        <!-- svelte-ignore a11y_autofocus -->
        <TextInput
          class="stash-branch"
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
      <GitButton class="danger" onclick={drop}
        ><span class="material-symbols-outlined">delete</span>{t('git.stash.drop')}</GitButton
      >
      <GitButton
        onclick={() => {
          branchName = '';
          branching = true;
        }}><GitBranchIcon size={15} />{t('git.stash.branch')}</GitButton
      >
      <GitButton onclick={() => stashApply(stash!.index)}
        ><span class="material-symbols-outlined">content_copy</span>{t('git.stash.apply')}</GitButton
      >
      <GitButton class="inv" onclick={() => stashPop(stash!.index)}
        ><span class="material-symbols-outlined">download</span>{t('git.stash.pop')}</GitButton
      >
    </GitHead>
    <GitViewBody>
      {#if git.error}<GitError>{git.error}</GitError>{/if}
      {#if error}
        <GitError>{error}</GitError>
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
    </GitViewBody>
  {/if}
</GitView>

<style>
  .file {
    flex: none;
    display: flex;
    max-height: none;
  }
  :global(.bs-input.stash-branch) {
    width: 200px;
    height: 30px;
    border-radius: var(--radius-control);
  }
</style>
