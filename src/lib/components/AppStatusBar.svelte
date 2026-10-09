<script lang="ts">
  import type { UtilityMode } from '../domain/appShell';
  import { tabs, activeTabId, runnerRun } from '../stores';
  import { t } from '../i18n';

  let {
    onRunner,
    utilityMode,
    onTerminal,
    onConsole,
  }: {
    onRunner: () => void;
    utilityMode: UtilityMode | null;
    onTerminal: () => void;
    onConsole: () => void;
  } = $props();

  const runnerOn = $derived($tabs.find((tb) => tb.id === $activeTabId)?.protocol === 'runner');
</script>

<div class="bs-status">
  <button
    class="bs-status-link"
    class:on={utilityMode === 'console' || utilityMode === 'issues'}
    type="button"
    aria-pressed={utilityMode === 'console' || utilityMode === 'issues'}
    onclick={onConsole}
    ><span class="material-symbols-outlined" aria-hidden="true">data_object</span>{$t('nav.status.console')}</button
  >
  <button
    class="bs-status-link"
    class:on={utilityMode === 'terminal'}
    type="button"
    aria-pressed={utilityMode === 'terminal'}
    onclick={onTerminal}
    ><span class="material-symbols-outlined" aria-hidden="true">terminal</span>{$t('nav.status.terminal')}</button
  >
  <div class="bs-spacer"></div>
  <button class="bs-status-link runner" class:on={runnerOn} type="button" aria-pressed={runnerOn} onclick={onRunner}
    ><span class="material-symbols-outlined" class:spin={$runnerRun.status === 'running'} aria-hidden="true"
      >{$runnerRun.status === 'running' ? 'progress_activity' : 'play_arrow'}</span
    >{$t('nav.status.runner')}</button
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
  .runner.on {
    height: 21px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
  }
</style>
