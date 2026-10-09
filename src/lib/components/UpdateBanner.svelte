<script lang="ts">
  /** Floating in-app update notice. Hidden unless the updater has something to
   * show (available / downloading / ready / up-to-date / error). */
  import { t } from '../i18n';
  import {
    updateStatus,
    updateVersion,
    updateProgress,
    installUpdate,
    dismissUpdate,
  } from '../updater';

  const pct = $derived(Math.round($updateProgress * 100));
  const visible = $derived($updateStatus !== 'idle' && $updateStatus !== 'checking');
</script>

{#if visible}
  <div class="upd" role="status" aria-live="polite">
    {#if $updateStatus === 'available'}
      <span class="material-symbols-outlined ic">download</span>
      <span class="txt">{$t('update.available', { v: $updateVersion })}</span>
      <button class="btn primary" onclick={installUpdate}>{$t('update.install')}</button>
      <button class="btn ghost" aria-label={$t('update.dismiss')} onclick={dismissUpdate}>{$t('update.later')}</button>
    {:else if $updateStatus === 'downloading'}
      <span class="material-symbols-outlined ic spin">progress_activity</span>
      <span class="txt">{$t('update.downloading', { pct })}</span>
    {:else if $updateStatus === 'ready'}
      <span class="material-symbols-outlined ic">restart_alt</span>
      <span class="txt">{$t('update.restarting')}</span>
    {:else if $updateStatus === 'uptodate'}
      <span class="material-symbols-outlined ic">check_circle</span>
      <span class="txt">{$t('update.latest')}</span>
      <button class="btn ghost" onclick={dismissUpdate}>OK</button>
    {:else if $updateStatus === 'error'}
      <span class="material-symbols-outlined ic err">error</span>
      <span class="txt">{$t('update.failed')}</span>
      <button class="btn ghost" onclick={dismissUpdate}>{$t('update.dismiss')}</button>
    {/if}
  </div>
{/if}

<style>
  .upd {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface, #fff);
    color: var(--text, #1d1d1f);
    border: 0.5px solid var(--sep, rgba(0, 0, 0, 0.12));
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.12);
    font-size: 12.5px;
    max-width: 360px;
  }
  .ic {
    font-size: 18px;
    color: var(--accent, #0a84ff);
  }
  .ic.err {
    color: var(--red, #ff3b30);
  }
  .ic.spin {
    animation: upd-spin 850ms linear infinite;
  }
  @keyframes upd-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .txt {
    flex: 1;
    white-space: nowrap;
  }
  .btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    border: 0.5px solid var(--sep, rgba(0, 0, 0, 0.12));
    background: var(--surface, #fff);
    cursor: pointer;
  }
  .btn.primary {
    background: var(--accent, #0a84ff);
    color: #fff;
    border-color: transparent;
  }
  .btn.ghost {
    color: var(--t2, #6e6e73);
  }
</style>
