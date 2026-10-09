<script lang="ts">
  import { t } from '../../i18n';
  import { proxyMode, proxyUrl, proxyBypass } from '../../stores';
  import { proxyAuth, proxyUser, proxyPassword } from '../../stores/netPrefs';
  import { proxyUrlError } from '../../domain/proxy';
  import type { ProxyMode } from '../../domain/types';
  import { row, sw, seg, chips } from './ui.svelte';

  const PROXY_MODES: { label: string; value: ProxyMode }[] = $derived([
    { label: $t('settings.proxy.system'), value: 'system' },
    { label: $t('settings.proxy.manual'), value: 'manual' },
    { label: $t('settings.proxy.none'), value: 'none' },
  ]);
  // Shown only after the field was touched, so an empty fresh form isn't red.
  let proxyTouched = $state(false);
  const proxyError = $derived(
    $proxyMode === 'manual' && (proxyTouched || $proxyUrl) ? proxyUrlError($proxyUrl, $t) : '',
  );
  const bypass = $derived(
    $proxyBypass
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  );
</script>

<div class="st-group">{$t('settings.proxy.mode')}</div>
<div class="st-card">
  {#snippet p1()}{@render seg($t('settings.proxy.mode.aria'), $proxyMode, PROXY_MODES, (v) =>
      proxyMode.set(v as ProxyMode),
    )}{/snippet}
  {@render row(
    $t('settings.proxy.source'),
    $proxyMode === 'system'
      ? $t('settings.proxy.source.system')
      : $proxyMode === 'none'
        ? $t('settings.proxy.source.none')
        : $t('settings.proxy.source.manual'),
    p1,
  )}
</div>
{#if $proxyMode === 'manual'}
  <div class="st-group">{$t('settings.proxy.server')}</div>
  <div class="st-card">
    <div class="st-row st-col">
      <div class="st-copy">
        <span class="st-name">{$t('settings.proxy.http')}</span><span class="st-desc"
          >{$t('settings.proxy.http.desc')}</span
        >
      </div>
      <input
        class="st-text"
        type="text"
        spellcheck="false"
        placeholder="proxy.corp.local:3128"
        aria-label={$t('settings.proxy.addr')}
        aria-invalid={proxyError ? 'true' : undefined}
        aria-describedby={proxyError ? 'st-proxy-err' : undefined}
        bind:value={$proxyUrl}
        onblur={() => (proxyTouched = true)}
      />
    </div>
    {#if proxyError}<div class="st-err" id="st-proxy-err" role="alert">{proxyError}</div>{/if}
    {#snippet au()}{@render sw($t('settings.proxy.auth'), $proxyAuth, (v) => proxyAuth.set(v))}{/snippet}
    {@render row($t('settings.proxy.auth'), $t('settings.proxy.auth.desc'), au)}
    {#if $proxyAuth}
      <div class="st-row st-col">
        <div class="st-copy"><span class="st-name">{$t('settings.proxy.login')}</span></div>
        <input
          class="st-text"
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label={$t('settings.proxy.login.aria')}
          bind:value={$proxyUser}
        />
      </div>
      <div class="st-row st-col">
        <div class="st-copy"><span class="st-name">{$t('settings.proxy.password')}</span></div>
        <input
          class="st-text"
          type="password"
          autocomplete="off"
          aria-label={$t('settings.proxy.password.aria')}
          bind:value={$proxyPassword}
        />
      </div>
    {/if}
  </div>
  <div class="st-group">{$t('settings.proxy.bypass')}</div>
  <div class="st-card">
    <div class="st-row st-col">
      <div class="st-copy">
        <span class="st-name">{$t('settings.proxy.bypass.name')}</span><span class="st-desc"
          >{$t('settings.proxy.bypass.desc')}</span
        >
      </div>
      {@render chips($t('settings.proxy.bypass.aria'), bypass, $t('settings.proxy.host'), (items) =>
        proxyBypass.set(items.join(', ')),
      )}
    </div>
  </div>
{/if}
