<script lang="ts">
  import { t } from '$shared/i18n';
  import { proxyAuth, proxyUser, proxyPassword, proxyUrlError, requestPrefs } from '$shared/settings';
  import type { ProxyMode } from '$shared/model';
  import { row, sw, seg, chips } from './ui.svelte';

  const PROXY_MODES: { label: string; value: ProxyMode }[] = $derived([
    { label: t('settings.proxy.system'), value: 'system' },
    { label: t('settings.proxy.manual'), value: 'manual' },
    { label: t('settings.proxy.none'), value: 'none' },
  ]);
  // Shown only after the field was touched, so an empty fresh form isn't red.
  let proxyTouched = $state(false);
  const proxyError = $derived(
    requestPrefs.proxyMode === 'manual' && (proxyTouched || requestPrefs.proxyUrl)
      ? proxyUrlError(requestPrefs.proxyUrl, t)
      : '',
  );
  const bypass = $derived(
    requestPrefs.proxyBypass
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  );
</script>

<div class="st-group">{t('settings.proxy.mode')}</div>
<div class="st-card">
  {#snippet p1()}{@render seg(
      t('settings.proxy.mode.aria'),
      requestPrefs.proxyMode,
      PROXY_MODES,
      (v) => (requestPrefs.proxyMode = v as ProxyMode),
    )}{/snippet}
  {@render row(
    t('settings.proxy.source'),
    requestPrefs.proxyMode === 'system'
      ? t('settings.proxy.source.system')
      : requestPrefs.proxyMode === 'none'
        ? t('settings.proxy.source.none')
        : t('settings.proxy.source.manual'),
    p1,
  )}
</div>
{#if requestPrefs.proxyMode === 'manual'}
  <div class="st-group">{t('settings.proxy.server')}</div>
  <div class="st-card">
    <div class="st-row st-col">
      <div class="st-copy">
        <span class="st-name">{t('settings.proxy.http')}</span><span class="st-desc"
          >{t('settings.proxy.http.desc')}</span
        >
      </div>
      <input
        class="st-text"
        type="text"
        spellcheck="false"
        placeholder="proxy.corp.local:3128"
        aria-label={t('settings.proxy.addr')}
        aria-invalid={proxyError ? 'true' : undefined}
        aria-describedby={proxyError ? 'st-proxy-err' : undefined}
        bind:value={requestPrefs.proxyUrl}
        onblur={() => (proxyTouched = true)}
      />
    </div>
    {#if proxyError}<div class="st-err" id="st-proxy-err" role="alert">{proxyError}</div>{/if}
    {#snippet au()}{@render sw(t('settings.proxy.auth'), proxyAuth.current, (v) => (proxyAuth.current = v))}{/snippet}
    {@render row(t('settings.proxy.auth'), t('settings.proxy.auth.desc'), au)}
    {#if proxyAuth.current}
      <div class="st-row st-col">
        <div class="st-copy"><span class="st-name">{t('settings.proxy.login')}</span></div>
        <input
          class="st-text"
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label={t('settings.proxy.login.aria')}
          bind:value={proxyUser.current}
        />
      </div>
      <div class="st-row st-col">
        <div class="st-copy"><span class="st-name">{t('settings.proxy.password')}</span></div>
        <input
          class="st-text"
          type="password"
          autocomplete="off"
          aria-label={t('settings.proxy.password.aria')}
          bind:value={proxyPassword.current}
        />
      </div>
    {/if}
  </div>
  <div class="st-group">{t('settings.proxy.bypass')}</div>
  <div class="st-card">
    <div class="st-row st-col">
      <div class="st-copy">
        <span class="st-name">{t('settings.proxy.bypass.name')}</span><span class="st-desc"
          >{t('settings.proxy.bypass.desc')}</span
        >
      </div>
      {@render chips(
        t('settings.proxy.bypass.aria'),
        bypass,
        t('settings.proxy.host'),
        (items) => (requestPrefs.proxyBypass = items.join(', ')),
      )}
    </div>
  </div>
{/if}
