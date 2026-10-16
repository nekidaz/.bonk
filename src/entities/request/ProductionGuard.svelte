<script lang="ts">
  import { t } from '$shared/i18n';
  import { dialogs } from './dialogs.svelte';
  import { methodColor } from '$shared/model';
  import { Overlay, Modal } from '$shared/ui/components';

  let typed = $state('');
  let returnFocus: HTMLElement | null = null;

  const guard = $derived(dialogs.productionGuard);
  const matches = $derived(!!guard && typed.trim().toLowerCase() === guard.envName.toLowerCase());
  // Show the path; the host sits next to the environment pill.
  const path = $derived.by(() => {
    if (!guard) return '';
    try {
      const u = new URL(guard.url);
      return u.pathname + u.search;
    } catch {
      return guard.url;
    }
  });

  $effect(() => {
    if (!guard) return;
    typed = '';
    returnFocus = document.activeElement as HTMLElement | null;
  });

  function close(ok: boolean): void {
    if (!guard || (ok && !matches)) return;
    guard.resolve(ok);
    dialogs.productionGuard = null;
    returnFocus?.focus();
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      close(true);
    }
  }
</script>

{#if guard}
  <Overlay
    class="bs-guard-overlay"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) close(false);
    }}
  >
    <Modal
      class="bs-guard"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="bs-guard-title"
      aria-describedby="bs-guard-text"
    >
      <h2 id="bs-guard-title">{t('app.guard.title', { method: guard.method, env: guard.envName })}</h2>
      <p id="bs-guard-text">{t('app.guard.text')}</p>
      <div class="bs-guard-summary">
        <div class="bs-guard-req">
          <span class="m" style="color:{methodColor(guard.method)}">{guard.method}</span><span
            class="path"
            title={guard.url}>{path}</span
          >
        </div>
        <div class="bs-guard-env">
          <span class="bs-guard-pill"
            ><span class="material-symbols-outlined" aria-hidden="true">lock</span>{guard.envName}</span
          >
          {#if guard.host}<span class="host">{guard.host}</span>{/if}
        </div>
      </div>
      <label class="bs-guard-label" for="bs-guard-input">{t('app.guard.type', { env: guard.envName })}</label>
      <input
        id="bs-guard-input"
        class="bs-guard-input"
        autocomplete="off"
        spellcheck="false"
        {@attach (el) => el.focus()}
        bind:value={typed}
        onkeydown={keydown}
      />
      <div class="bs-guard-actions">
        <button type="button" class="bs-guard-cancel" onclick={() => close(false)}>{t('common.cancel')}</button>
        <button type="button" class="bs-guard-send" disabled={!matches} onclick={() => close(true)}
          >{t('app.guard.send', { env: guard.envName })}</button
        >
      </div>
    </Modal>
  </Overlay>
{/if}

<style>
  :global(.bs) .bs-guard-send:not(:disabled):hover {
    background: var(--color-danger);
    color: var(--color-on-action);
  }

  :global(:root .bs .bs-guard-overlay) {
    z-index: 130;
    padding: 24px;
    background: var(--color-scrim);
  }

  /* Optical centre: the design sits the dialog 13px above the geometric middle. */
  :global(:root .bs .bs-modal.bs-guard) {
    margin-bottom: 26px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 440px;
    max-width: 100%;
    padding: 28px;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: 0 24px 64px var(--color-shadow);
  }

  :global(:root .bs .bs-guard h2) {
    margin: 0;
    color: var(--color-text);
    font: 600 17px/21px var(--font-ui);
  }

  :global(:root .bs .bs-guard p) {
    margin: 6px 0 6px;
    color: var(--color-text-secondary);
    font: 13px/20px var(--font-ui);
  }

  :global(.bs) .bs-guard-summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 6px;
    padding: 12px 14px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-md);
    background: var(--color-field);
  }

  :global(.bs) .bs-guard-req {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 16px;
  }

  :global(.bs) .bs-guard-req :global(.m) {
    flex: none;
    font: 700 var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-guard-req :global(.path) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-guard-env {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  :global(.bs) .bs-guard-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 9px 0 7px;
    border-radius: var(--radius-control);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    font: 600 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-guard-pill :global(.material-symbols-outlined) {
    font-size: 12px;
  }

  :global(.bs) .bs-guard-env :global(.host) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-guard-label {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-guard-input {
    margin-top: -2px;
    height: 34px;
    padding: 0 14px;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
    box-shadow: none;
  }

  :global(.bs) .bs-guard-input:focus {
    margin-top: -2px;
    height: 34px;
    padding: 0 14px;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
    box-shadow: none;
    outline-color: var(--color-border);
  }

  :global(.bs) .bs-guard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 8px;
  }

  :global(.bs) .bs-guard-actions :global(button) {
    height: 34px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-guard-cancel {
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    background: var(--color-panel);
    color: var(--color-text);
  }

  :global(.bs) .bs-guard-cancel:hover {
    background: var(--color-selected);
  }

  :global(.bs) .bs-guard-send {
    background: var(--color-danger-soft);
    color: var(--color-danger);
    font-weight: 600;
  }

  :global(.bs) .bs-guard-send:disabled {
    opacity: 0.5;
  }
</style>
