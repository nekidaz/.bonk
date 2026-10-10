<script lang="ts">
  /**
   * `pm.test` results (SC4): Все / Прошли / Упали, the stage and how long it took, one row per check with
   * its line; a failed check spells out expected vs actual. `compact` (SC9) lists the failures and folds
   * the passed ones into one row.
   */
  import { t, tp } from '$shared/i18n';
  import type { ScriptTestResult, TabTestResults } from '$shared/model';

  let {
    results,
    onLine,
    compact = false,
  }: {
    results: TabTestResults;
    /** Jump to a line of the stage's script. */
    onLine?: (test: ScriptTestResult, line: number) => void;
    compact?: boolean;
  } = $props();

  type Filter = 'all' | 'passed' | 'failed';
  let filter = $state<Filter>('all');
  let showPassed = $state(false);

  const passed = $derived(results.tests.filter((x) => x.passed));
  const failed = $derived(results.tests.filter((x) => !x.passed));
  const shown = $derived(filter === 'passed' ? passed : filter === 'failed' ? failed : results.tests);
  const stageLabel = $derived.by(() => {
    const stages = new Set(results.tests.map((x) => x.stage ?? 'post'));
    const names = [...stages].map((s) => (s === 'pre' ? t('script.pre.name') : t('script.post.name')));
    return [...names, results.postMs !== undefined ? `${results.postMs} ms` : ''].filter(Boolean).join(' · ');
  });
  const FILTERS: [Filter, string][] = [
    ['all', 'response.tests.all'],
    ['passed', 'response.tests.passed'],
    ['failed', 'response.tests.failed'],
  ];
</script>

{#snippet lineLink(test: ScriptTestResult, line: number | undefined)}
  {#if line}
    {#if onLine}<button type="button" class="line" onclick={() => onLine(test, line)}
        >{t('script.line', { n: line })}{#if compact}<span class="material-symbols-outlined" aria-hidden="true"
            >north_east</span
          >{/if}</button
      >{:else}<span class="line">{t('script.line', { n: line })}</span>{/if}
  {/if}
{/snippet}

{#snippet row(test: ScriptTestResult)}
  <li class:fail={!test.passed}>
    <span class="material-symbols-outlined icon" aria-hidden="true">{test.passed ? 'check_circle' : 'cancel'}</span>
    <div class="main">
      <span class="name">{test.name}</span>
      {#if !test.passed && test.error}<code class="err">{test.error}</code>{/if}
    </div>
    {@render lineLink(test, test.passed ? test.line : (test.errorLine ?? test.line))}
  </li>
{/snippet}

<div class="bs-script-tests" class:compact>
  {#if !compact}
    <div class="head">
      <div class="bs-seg" role="radiogroup" aria-label={t('response.tests.filter')}>
        {#each FILTERS as [id, label] (id)}
          {@const n = id === 'all' ? results.tests.length : id === 'passed' ? passed.length : failed.length}
          <button
            type="button"
            role="radio"
            aria-checked={filter === id}
            class:on={filter === id}
            onclick={() => (filter = id)}>{t(label)}<span class="n">{n}</span></button
          >
        {/each}
      </div>
      <span class="stage">{stageLabel}</span>
    </div>
    <ul>
      {#each shown as test, i (i)}{@render row(test)}{:else}<li class="none">{t('response.tests.noneMatch')}</li>{/each}
    </ul>
  {:else}
    <ul>
      {#each failed as test, i (i)}{@render row(test)}{/each}
      {#if passed.length}
        <li class="sum">
          <span class="material-symbols-outlined icon ok" aria-hidden="true">check_circle</span>
          <b>{passed.length} {tp(passed.length, ['прошла', 'прошли', 'прошли'], ['passed', 'passed'])}</b>
          <span class="names">{passed.map((x) => x.name).join(' · ')}</span>
          <button type="button" class="more" aria-expanded={showPassed} onclick={() => (showPassed = !showPassed)}
            >{showPassed ? t('script.run.hide') : t('script.run.show')}<span
              class="material-symbols-outlined"
              aria-hidden="true">{showPassed ? 'expand_less' : 'expand_more'}</span
            ></button
          >
        </li>
        {#if showPassed}{#each passed as test, i (i)}{@render row(test)}{/each}{/if}
      {/if}
    </ul>
  {/if}
</div>

<style>
  .bs-script-tests {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .head .n {
    margin-left: 6px;
    color: var(--t3);
    font-weight: 500;
  }
  .stage {
    color: var(--t3);
    font: 500 var(--font-size-micro) var(--mono);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
  }
  li.fail {
    background: var(--color-danger-soft);
  }
  .icon {
    font-size: 16px;
    color: var(--color-success);
  }
  li.fail .icon {
    color: var(--color-danger);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .name {
    color: var(--text);
    font-size: var(--font-size-body);
  }
  .err {
    color: var(--color-danger);
    font: var(--font-size-caption) var(--mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .line {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--t3);
    font: var(--font-size-micro) var(--mono);
  }
  button.line:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .line .material-symbols-outlined {
    font-size: 12px;
  }
  .none {
    color: var(--t3);
    font-size: var(--font-size-caption);
  }
  .sum {
    align-items: center;
  }
  .sum b {
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
  }
  .names {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--t3);
    font-size: var(--font-size-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--t2);
    font-size: var(--font-size-caption);
  }
  .more .material-symbols-outlined {
    font-size: 15px;
  }
  .compact li {
    padding: 7px 10px;
  }
</style>
