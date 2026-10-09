<script lang="ts">
  /** U1: one-off toast once an update has downloaded in the background. It hides
   * itself after a while; the toolbar pill keeps the update reachable. */
  import { t } from '../i18n';
  import { updateToast, updateVersion, installUpdate } from '../updater';

  const AUTO_HIDE_MS = 12_000;

  $effect(() => {
    if (!$updateToast) return;
    const timer = setTimeout(() => updateToast.set(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  });
</script>

{#if $updateToast}
  <div class="upd" role="status" aria-live="polite">
    <span class="material-symbols-outlined ic" aria-hidden="true">download_done</span>
    <span class="txt">{$t('update.downloaded', { v: $updateVersion })}</span>
    <button class="btn" type="button" onclick={installUpdate}>{$t('update.restart')}</button>
  </div>
{/if}

<style>
  .upd {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 360px;
    padding: 10px 8px 10px 14px;
    border-radius: 20px;
    background: var(--color-raised);
    color: var(--text);
    outline: 1px solid var(--border2);
    outline-offset: -1px;
    box-shadow: 0 12px 32px #00000042;
    font-size: 12px;
    font-weight: 500;
  }
  .ic {
    font-size: 16px;
    color: var(--green);
  }
  .txt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
  }
  .btn:hover {
    background: var(--hover);
  }
</style>
