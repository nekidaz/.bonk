<script lang="ts">
  import { t } from '$shared/i18n';
  import { confirmState } from './confirm.svelte';
  import Button from './Button.svelte';
  import Overlay from './Overlay.svelte';
  import Modal from './Modal.svelte';
  import ModalBody from './ModalBody.svelte';
  import ModalFooter from './ModalFooter.svelte';

  function resolveConfirm(ok: boolean | 'alt'): void {
    const s = confirmState.current;
    if (s) s.resolve(ok);
    confirmState.current = null;
  }
</script>

<!-- In-app confirm dialog (the Tauri webview has no window.confirm) -->
{#if confirmState.current}
  <Overlay role="dialog" aria-modal="true" aria-label={t('app.confirm.title')}>
    <Modal style="max-width: {confirmState.current.altLabel ? '420px' : '360px'}">
      <ModalBody style="padding:18px 18px 6px">{confirmState.current.message}</ModalBody>
      <ModalFooter>
        {#if confirmState.current.altLabel}<Button variant="ghost" onclick={() => resolveConfirm('alt')}
            >{confirmState.current.altLabel}</Button
          >{/if}
        <div class="grow"></div>
        <Button variant="ghost" onclick={() => resolveConfirm(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onclick={() => resolveConfirm(true)}>{confirmState.current.confirmLabel}</Button>
      </ModalFooter>
    </Modal>
  </Overlay>
{/if}
