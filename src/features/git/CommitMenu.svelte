<script lang="ts">
  /**
   * G6: right-click menu for the selected commits — cherry-pick, revert, save as patch; merge or
   * rebase with the clicked commit's branch; checkout, reset (soft / mixed / hard), tag; copy hashes.
   * Actions that need one commit are disabled for a range. The parent runs every action.
   */
  import type { GraphCommit } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import type { CommitAction } from './graph';

  let {
    at,
    commits,
    current,
    onCurrent,
    onAction,
    onClose,
  }: {
    at: { x: number; y: number };
    /** The selection, newest first; the first one is the commit that was clicked. */
    commits: GraphCommit[];
    /** The checked-out branch ('' when detached). */
    current: string;
    /** True when every selected commit is already on the current branch (cherry-pick would do nothing). */
    onCurrent: boolean;
    onAction: (a: CommitAction) => void;
    onClose: () => void;
  } = $props();

  let resetOpen = $state(false);
  const n = $derived(commits.length);
  const one = $derived(n === 1);
  // The clicked commit's branch to merge or rebase with: a local one other than ours, else a remote one.
  const branch = $derived(
    commits[0]?.refs.find((r) => r.kind === 'branch' && r.name !== current)?.name ??
      commits[0]?.refs.find((r) => r.kind === 'remote' && r.name.split('/').slice(1).join('/') !== current)?.name,
  );
  const here = $derived(current || 'HEAD');
  // Keep the menu inside the window.
  const left = $derived(Math.min(at.x, window.innerWidth - 340));
  const top = $derived(Math.min(at.y, window.innerHeight - 470));

  function run(a: CommitAction): void {
    onClose();
    onAction(a);
  }
</script>

<div class="bs-gitlayer" role="presentation" onpointerdown={onClose} oncontextmenu={(e) => e.preventDefault()}></div>
<div class="bs-commitmenu" role="menu" style:left="{left}px" style:top="{Math.max(8, top)}px">
  <div class="eb">
    {one
      ? `${t('git.graph.commit')}  ·  ${commits[0].short}`
      : `${n} ${tp(n, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits'])}`}
  </div>
  <button role="menuitem" disabled={!current || onCurrent} onclick={() => run({ kind: 'cherry-pick' })}
    ><span class="material-symbols-outlined">commit</span>{t('git.graph.cherryPick', { branch: here })}</button
  >
  <button role="menuitem" onclick={() => run({ kind: 'revert' })}
    ><span class="material-symbols-outlined">undo</span>{one
      ? t('git.graph.revertOne')
      : t('git.graph.revert', { n, commits: tp(n, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits']) })}</button
  >
  <button role="menuitem" onclick={() => run({ kind: 'patch' })}
    ><span class="material-symbols-outlined">draft</span>{t('git.graph.patch')}</button
  >
  {#if one && onCurrent && current && !commits[0].refs.some((r) => r.kind === 'head')}
    <!-- Rewrite our own commits above this one: `rebase -i <commit>`. -->
    <button role="menuitem" onclick={() => run({ kind: 'interactive', branch: commits[0].short })}
      ><span class="material-symbols-outlined">format_list_numbered</span>{t('git.graph.interactiveHere')}</button
    >
  {/if}

  {#if branch}
    <div class="sep"></div>
    <div class="eb">{`${t('git.graph.branchSection')}  ${branch}`}</div>
    <button role="menuitem" disabled={!current} onclick={() => run({ kind: 'merge', branch })}
      ><span class="material-symbols-outlined">merge</span>{t('git.graph.merge', { branch, current: here })}</button
    >
    <button role="menuitem" disabled={!current} onclick={() => run({ kind: 'rebase', branch })}
      ><span class="material-symbols-outlined">low_priority</span>{t('git.graph.rebase', { current: here })}</button
    >
    <button role="menuitem" disabled={!current} onclick={() => run({ kind: 'interactive', branch })}
      ><span class="material-symbols-outlined">format_list_numbered</span>{t('git.graph.interactive')}</button
    >
  {/if}

  <div class="sep"></div>
  <button role="menuitem" disabled={!one} onclick={() => run({ kind: 'checkout' })}
    ><span class="material-symbols-outlined">login</span>{t('git.graph.checkout')}{#if !one}<span class="hint"
        >{t('git.graph.oneOnly')}</span
      >{/if}</button
  >
  <div class="sub">
    <button
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={resetOpen}
      disabled={!one}
      onclick={() => (resetOpen = !resetOpen)}
      ><span class="material-symbols-outlined">history</span>{t('git.graph.reset', { current: here })}<span
        class="material-symbols-outlined chev">chevron_right</span
      ></button
    >
    {#if resetOpen && one}
      <div class="submenu" role="menu">
        {#each ['soft', 'mixed', 'hard'] as const as mode (mode)}
          <button role="menuitem" class:danger={mode === 'hard'} onclick={() => run({ kind: 'reset', mode })}>
            <b>{mode}</b><span class="hint">{t(`git.graph.reset.${mode}`)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <button role="menuitem" disabled={!one} onclick={() => run({ kind: 'tag' })}
    ><span class="material-symbols-outlined">sell</span>{t('git.graph.tag')}</button
  >
  <button role="menuitem" onclick={() => run({ kind: 'copy' })}
    ><span class="material-symbols-outlined">content_copy</span>{one ? t('git.graph.copyOne') : t('git.graph.copy')}<kbd
      >⌘C</kbd
    ></button
  >
</div>

<style>
  .bs-commitmenu {
    position: fixed;
    z-index: 60;
    width: 320px;
    padding: 6px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 18px 48px var(--color-shadow);
  }
  .eb {
    padding: 8px 12px 6px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button:hover:not(:disabled) {
    background: var(--color-hover);
  }
  button:disabled {
    color: var(--color-text-muted);
  }
  .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .hint {
    margin-left: auto;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  kbd {
    margin-left: auto;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .chev {
    margin-left: auto;
  }
  .sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--color-border-subtle);
  }
  .sub {
    position: relative;
  }
  .submenu {
    margin: 2px 0 4px 26px;
    padding-left: 6px;
    border-left: 1px solid var(--color-border-subtle);
  }
  .submenu b {
    min-width: 44px;
    font: 600 var(--font-size-body) var(--font-code);
  }
  .submenu .danger b {
    color: var(--color-danger);
  }
</style>
