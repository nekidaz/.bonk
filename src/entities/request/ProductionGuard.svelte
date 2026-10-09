<script lang="ts">
  import { t } from '$shared/i18n';
  import { dialogs } from './dialogs.svelte';
  import { methodColor } from '$shared/model';

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
  <div
    class="bs-overlay bs-guard-overlay"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) close(false);
    }}
  >
    <div
      class="bs-modal bs-guard"
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
    </div>
  </div>
{/if}
