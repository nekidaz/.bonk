<script lang="ts">
  import { GitBranchIcon } from '$shared/ui/components';
  import type { UtilityMode } from '$shared/ui';
  import { tabs } from '$entities/tab';
  import { runner } from '$features/runner';
  import { cookieJar } from '$entities/cookies';
  import { git, GIT_ENABLED } from '$entities/git';
  import { groupIssues, utilityUi } from '$features/utility-panel';
  import { formatBinding, hotkeys } from '$shared/settings';
  import { layout } from './layout.svelte';
  import { t } from '$shared/i18n';

  let {
    onRunner,
    utilityMode,
    onTerminal,
    onConsole,
    onIssues,
  }: {
    onRunner: () => void;
    utilityMode: UtilityMode | null;
    onTerminal: () => void;
    onConsole: () => void;
    onIssues: () => void;
  } = $props();

  // CT9: the Issues chip; hovering it lists what failed in the last hour.
  const issueCount = $derived(utilityUi.issues.length);
  let peek = $state(false);
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  const recent = $derived(
    peek
      ? groupIssues(
          utilityUi.issues.filter((x) => Date.now() - x.entry.at < 3_600_000),
          'cause',
        ).slice(0, 4)
      : [],
  );
  function setPeek(on: boolean): void {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => (peek = on && issueCount > 0), on ? 250 : 150);
  }
  /** `CreateBatch`, `DELETE /v1/payments/{id}`. */
  const short = (target: string) => (target.includes(' ') ? target : (target.split('/').at(-1) ?? target));

  const runnerOn = $derived(tabs.active?.protocol === 'runner');
  const cookieCount = $derived(cookieJar.list.length);

  // G3: the branch chip opens the branch popover above it; without a repo it says so and opens the Git tab.
  const gitStatus = $derived(GIT_ENABLED ? git.status : null);
  const sync = $derived(
    gitStatus
      ? `${gitStatus.behind ? `↓${gitStatus.behind}` : ''} ${gitStatus.ahead ? `↑${gitStatus.ahead}` : ''}`.trim()
      : '',
  );
  function onBranch(e: MouseEvent): void {
    if (!gitStatus?.isRepo) {
      layout.showSidebar('git');
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    git.branchMenu = { x: r.left, y: r.top - 6, up: true };
  }
</script>

<div class="bs-status">
  <button
    class="bs-status-link"
    class:on={utilityMode === 'console'}
    type="button"
    aria-label={t('nav.status.console')}
    aria-pressed={utilityMode === 'console'}
    onclick={onConsole}
    ><span class="material-symbols-outlined" aria-hidden="true">data_object</span><span class="lbl"
      >{t('nav.status.console')}</span
    ></button
  >
  <button
    class="bs-status-link"
    class:on={utilityMode === 'terminal'}
    type="button"
    aria-label={t('nav.status.terminal')}
    aria-pressed={utilityMode === 'terminal'}
    onclick={onTerminal}
    ><span class="material-symbols-outlined" aria-hidden="true">terminal</span><span class="lbl"
      >{t('nav.status.terminal')}</span
    ></button
  >
  {#if issueCount || utilityMode === 'issues'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bs-status-issues" onmouseenter={() => setPeek(true)} onmouseleave={() => setPeek(false)}>
      <button
        class="bs-status-link issues"
        class:on={utilityMode === 'issues'}
        class:has={issueCount > 0}
        type="button"
        aria-pressed={utilityMode === 'issues'}
        onclick={() => {
          peek = false;
          onIssues();
        }}
        ><span class="material-symbols-outlined" aria-hidden="true">error</span><span class="lbl"
          >{issueCount ? `${t('nav.status.issues')} ${issueCount}` : t('nav.status.issues')}</span
        ></button
      >
      {#if peek && recent.length}
        <div class="bs-status-peek" role="tooltip">
          <div class="head">
            <span>{t('issues.recent')}</span><span>{formatBinding(hotkeys.current.utilityPanel).join('')}</span>
          </div>
          {#each recent as g (g.key)}
            <div class="row">
              <span class="material-symbols-outlined {g.kind === '4xx' ? 'warn' : 'err'}" aria-hidden="true"
                >{g.icon}</span
              >
              <span class="name">{t(g.title, { name: g.arg ?? '' })} · {short(g.issues[0].target)}</span>
              <span class="n">×{g.count}</span>
            </div>
          {/each}
          <button
            type="button"
            onclick={() => {
              peek = false;
              if (utilityMode !== 'issues') onIssues();
            }}>{t('issues.open')} <span aria-hidden="true">→</span></button
          >
        </div>
      {/if}
    </div>
  {/if}
  {#if gitStatus}
    <button
      class="bs-status-link branch"
      class:on={!!git.branchMenu?.up}
      type="button"
      aria-label={t('git.branch.switch')}
      onclick={onBranch}
      ><GitBranchIcon size={13} /><span class="lbl"
        >{gitStatus.isRepo
          ? `${gitStatus.branch || t('git.noBranch')}${sync ? `  ${sync}` : ''}`
          : t('git.noRepo')}</span
      ></button
    >
  {/if}
  <div class="bs-spacer"></div>
  <!-- Flow · Cookies: the jar's size; opens the jar window. -->
  <button
    class="bs-status-link"
    class:on={cookieJar.sheetOpen}
    type="button"
    aria-label={t('cookies.chip_aria', { cookies: cookieCount })}
    onclick={() => cookieJar.open()}
    ><span class="material-symbols-outlined" aria-hidden="true">cookie</span><span class="lbl"
      >{cookieCount ? `${t('cookies.chip')} · ${cookieCount}` : t('cookies.chip')}</span
    ></button
  >
  <button
    class="bs-status-link runner"
    class:on={runnerOn}
    type="button"
    aria-pressed={runnerOn}
    aria-label={t('nav.status.runner')}
    onclick={onRunner}
    ><span class="material-symbols-outlined" class:spin={runner.run.status === 'running'} aria-hidden="true"
      >{runner.run.status === 'running' ? 'progress_activity' : 'play_arrow'}</span
    ><span class="lbl">{t('nav.status.runner')}</span></button
  >
</div>

<style>
  /* S36: the active Runner reads as a selected pill. */
  .spin {
    animation: bs-spin 1s linear infinite;
  }
  @keyframes bs-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
  .bs-status-issues {
    position: relative;
  }
  .bs-status-link.issues.has {
    color: var(--red);
  }
  .bs-status-peek {
    position: absolute;
    z-index: 30;
    bottom: calc(100% + 6px);
    left: 0;
    width: 330px;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: var(--shadow-panel);
    font-size: 12px;
  }
  .bs-status-peek .head {
    display: flex;
    justify-content: space-between;
    padding: 2px 6px 6px;
    color: var(--t3);
    font-size: 9.5px;
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .bs-status-peek .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 6px;
  }
  .bs-status-peek .row .material-symbols-outlined {
    font-size: 14px;
  }
  .bs-status-peek .err {
    color: var(--red);
  }
  .bs-status-peek .warn {
    color: var(--orange);
  }
  .bs-status-peek .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-status-peek .n {
    color: var(--t3);
    font-family: var(--font-code);
    font-size: 10.5px;
  }
  .bs-status-peek button {
    margin-top: 4px;
    padding: 4px 6px;
    color: var(--text);
    font-size: 12px;
  }
  .branch .lbl {
    font-family: var(--font-code);
    white-space: pre;
  }
  .branch.on,
  .runner.on {
    height: 21px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
  }
</style>
