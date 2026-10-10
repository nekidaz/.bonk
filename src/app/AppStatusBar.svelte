<script lang="ts">
  import type { UtilityMode } from '$shared/ui';
  import { tabs } from '$entities/tab';
  import { runner } from '$features/runner';
  import { cookieJar } from '$entities/cookies';
  import { t } from '$shared/i18n';

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

  const runnerOn = $derived(tabs.active?.protocol === 'runner');
  const cookieCount = $derived(cookieJar.list.length);
</script>

<div class="bs-status">
  <button
    class="bs-status-link"
    class:on={utilityMode === 'console' || utilityMode === 'issues'}
    type="button"
    aria-label={t('nav.status.console')}
    aria-pressed={utilityMode === 'console' || utilityMode === 'issues'}
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
  .runner.on {
    height: 21px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
  }
</style>
