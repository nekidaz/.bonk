<script lang="ts">
  /**
   * Per-request settings («Настройки запроса»), anchored under the request header's ⋯ button:
   * timeout, redirects and TLS verification for this request only. Anything left alone follows Settings → Запросы.
   */
  import { t } from '../i18n';
  import { requestFollowRedirects, requestTimeoutMs, requestValidateTls, resetActiveRequestOverrides, setActiveRequestOverrides } from '../stores';
  import type { Tab } from '../domain/types';

  let { tab, onClose }: { tab: Tab; onClose: () => void } = $props();

  const o = $derived(tab.settings ?? {});
  const timeoutSec = $derived(Math.round((o.timeoutMs ?? $requestTimeoutMs) / 1000));
  const redirects = $derived(o.followRedirects ?? $requestFollowRedirects);
  const tls = $derived(o.validateTls ?? $requestValidateTls);

  function setTimeout(e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).value.trim();
    const n = Number(raw);
    // Empty / invalid = back to the global value.
    setActiveRequestOverrides({ timeoutMs: raw !== '' && Number.isFinite(n) && n >= 0 ? Math.min(600, Math.round(n)) * 1000 : undefined });
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  }
</script>

<svelte:window onpointerdown={onClose} />

<div class="bs-reqset" role="dialog" aria-label={$t('reqset.title')} tabindex="-1" onpointerdown={(e) => e.stopPropagation()} onkeydown={keydown} {@attach (el) => el.focus()}>
  <div class="head">
    <span class="eyebrow">{$t('reqset.title')}</span>
    <button class="close" type="button" aria-label={$t('common.close')} onclick={onClose}><span class="material-symbols-outlined">close</span></button>
  </div>
  <p class="sub">{$t('reqset.sub')}</p>
  <label class="row">
    <span class="text"><b>{$t('reqset.timeout')}</b><small>{o.timeoutMs === undefined ? $t('reqset.global') : $t('reqset.timeout.hint')}</small></span>
    <input type="number" min="0" max="600" value={timeoutSec} onchange={setTimeout} />
  </label>
  <label class="bs-switch row">
    <span class="text"><b>{$t('reqset.redirects')}</b><small>{o.followRedirects === undefined ? $t('reqset.global') : ''}</small></span>
    <input type="checkbox" role="switch" checked={redirects} onchange={(e) => setActiveRequestOverrides({ followRedirects: e.currentTarget.checked })} />
    <span class="track" aria-hidden="true"></span>
  </label>
  <label class="bs-switch row">
    <span class="text"><b>{$t('reqset.tls')}</b><small>{o.validateTls === undefined ? $t('reqset.global') : ''}</small></span>
    <input type="checkbox" role="switch" checked={tls} onchange={(e) => setActiveRequestOverrides({ validateTls: e.currentTarget.checked })} />
    <span class="track" aria-hidden="true"></span>
  </label>
  <div class="foot">
    <button type="button" disabled={!tab.settings} onclick={resetActiveRequestOverrides}>{$t('reqset.reset')}</button>
    <button type="button" class="done" onclick={onClose}>{$t('reqset.close')}</button>
  </div>
</div>
