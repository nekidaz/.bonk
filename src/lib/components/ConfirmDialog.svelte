<script lang="ts">
  import { t } from '../i18n';
  import { confirmState } from '../stores';

  function resolveConfirm(ok: boolean | 'alt'): void {
    const s = $confirmState;
    if (s) s.resolve(ok);
    confirmState.set(null);
  }
</script>

<!-- In-app confirm dialog (the Tauri webview has no window.confirm) -->
{#if $confirmState}
  <div class="bs-overlay" role="dialog" aria-modal="true" aria-label={$t('app.confirm.title')}>
    <div class="bs-modal" style:max-width={$confirmState.altLabel ? '420px' : '360px'}>
      <div class="bs-modal-b" style="padding:18px 18px 6px">{$confirmState.message}</div>
      <div class="bs-modal-f">
        {#if $confirmState.altLabel}<button type="button" class="bs-btn ghost" onclick={() => resolveConfirm('alt')}
            >{$confirmState.altLabel}</button
          >{/if}
        <div class="grow"></div>
        <button type="button" class="bs-btn ghost" onclick={() => resolveConfirm(false)}>{$t('common.cancel')}</button>
        <button type="button" class="bs-btn primary" onclick={() => resolveConfirm(true)}
          >{$confirmState.confirmLabel}</button
        >
      </div>
    </div>
  </div>
{/if}
