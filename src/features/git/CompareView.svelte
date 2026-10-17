<script lang="ts">
  /**
   * Two commits or branches side by side (GitKraken's Compare): the files where `target` differs
   * from `base` (`tab.git.path`, `tab.git.rev`) on the left, the selected one's diff on the right.
   */
  import { workspace } from '$entities/workspace';
  import { describeFile, git, statusColor } from '$entities/git';
  import { tabs } from '$entities/tab';
  import { gitCompare, gitCompareFileDiff } from '$shared/ipc';
  import { methodColor, type CommitFile, type Tab } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import FileDiff from './FileDiff.svelte';
  import { diffLayout } from './store.svelte';
  import {
    GitButton,
    GitSeg,
    GitHead,
    GitView,
    GitViewBody,
    GitViewEmpty,
    GitTag,
    GitError,
  } from '$entities/git/components';

  let { tab }: { tab: Tab } = $props();

  let files = $state.raw<CommitFile[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let picked = $state('');
  let diffText = $state('');
  /** Whose diff `diffText` is: until it is the picked file's, that one is still loading. */
  let diffOf = $state('');

  const base = $derived(tab.git?.path ?? '');
  const target = $derived(tab.git?.rev ?? '');
  const short = (r: string) => (/^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);
  const info = (path: string) => describeFile(path, git.prefix, (id) => workspace.byId.get(id));
  const pick = $derived(files.find((f) => f.path === picked) ?? files[0]);
  const plus = $derived(files.reduce((n, f) => n + f.additions, 0));
  const minus = $derived(files.reduce((n, f) => n + f.deletions, 0));

  $effect(() => {
    const root = workspace.path;
    void git.version;
    if (!root || !base || !target) return;
    void gitCompare(root, base, target)
      .then((f) => {
        files = f;
        error = '';
      })
      .catch((err) => (error = String(err)))
      .finally(() => (loaded = true));
  });

  $effect(() => {
    const root = workspace.path;
    const f = pick;
    if (!root || !f) return;
    void gitCompareFileDiff(root, base, target, f.path)
      .then((d) => {
        if (pick?.path !== f.path) return;
        diffText = d;
        diffOf = f.path;
      })
      .catch((err) => (error = String(err)));
  });

  function swap(): void {
    tabs.updateById(tab.id, (x) =>
      x.git
        ? {
            ...x,
            title: t('git.tab.compare', { base: short(target), target: short(base) }),
            git: { ...x.git, path: target, rev: base },
          }
        : x,
    );
  }
</script>

<GitView>
  <GitHead>
    <div class="ttl">
      <span class="crumb">{`${t('git.title')}  /  ${t('git.compare.title')}`}</span>
      <div class="row">
        <h2>{`${short(base)} → ${short(target)}`}</h2>
        {#if loaded && !error}
          <GitTag>{`${files.length} ${tp(files.length, ['file', 'files'])} · +${plus} −${minus}`}</GitTag>
        {/if}
      </div>
    </div>
    <GitButton onclick={swap}
      ><span class="material-symbols-outlined">swap_horiz</span>{t('git.compare.swap')}</GitButton
    >
    <GitSeg role="group" aria-label={t('git.diff.layout')}>
      <button
        class="icon"
        class:on={diffLayout.current === 'inline'}
        title={t('git.diff.inline')}
        aria-pressed={diffLayout.current === 'inline'}
        onclick={() => (diffLayout.current = 'inline')}
        ><span class="material-symbols-outlined">splitscreen_top</span></button
      >
      <button
        class="icon"
        class:on={diffLayout.current === 'split'}
        title={t('git.diff.split')}
        aria-pressed={diffLayout.current === 'split'}
        onclick={() => (diffLayout.current = 'split')}
        ><span class="material-symbols-outlined">vertical_split</span></button
      >
    </GitSeg>
  </GitHead>

  <GitViewBody>
    {#if error}
      <GitError>{error}</GitError>
    {:else if !loaded}
      <GitViewEmpty>{t('git.diff.loading')}</GitViewEmpty>
    {:else if !files.length}
      <GitViewEmpty>{t('git.compare.same')}</GitViewEmpty>
    {:else}
      <div class="split">
        <div class="list">
          {#each files as f (f.path)}
            {@const i = info(f.path)}
            <button class="file" class:sel={pick?.path === f.path} title={f.path} onclick={() => (picked = f.path)}>
              <span class="m" style:color={i.method ? methodColor(i.method === 'gRPC' ? 'GRPC' : i.method) : undefined}
                >{i.method}</span
              >
              <span class="nm">{i.name}</span>
              <span class="cnt"><i class="plus">+{f.additions}</i> <i class="minus">−{f.deletions}</i></span>
              <span class="st" style:color={statusColor(f.status)}>{f.status}</span>
            </button>
          {/each}
        </div>
        <div class="diff">
          {#if pick && diffOf !== pick.path}
            <GitViewEmpty>{t('git.diff.loading')}</GitViewEmpty>
          {:else if pick && diffText.trim()}
            <FileDiff
              path={pick.path}
              text={diffText}
              layout={diffLayout.current}
              leftLabel={short(base)}
              rightLabel={short(target)}
            />
          {:else if pick}
            <GitViewEmpty>{t('git.diff.noText')}</GitViewEmpty>
          {/if}
        </div>
      </div>
    {/if}
  </GitViewBody>
</GitView>

<style>
  .split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(220px, 320px) 1fr;
    gap: 12px;
    padding: 0 20px 16px;
  }
  .list {
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    text-align: left;
  }
  .file:hover {
    background: var(--color-hover);
  }
  .file.sel {
    background: var(--color-selected);
  }
  .m {
    flex: none;
    width: 34px;
    font: 600 var(--font-size-micro) var(--font-code);
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font-size: var(--font-size-ui);
  }
  .cnt {
    flex: none;
    font: var(--font-size-micro) var(--font-code);
  }
  .cnt i {
    font-style: normal;
  }
  .plus {
    color: var(--color-success);
  }
  .minus {
    color: var(--color-danger);
  }
  .st {
    flex: none;
    width: 12px;
    font: 600 var(--font-size-body) var(--font-code);
  }
  .diff {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
</style>
