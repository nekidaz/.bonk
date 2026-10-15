<script lang="ts">
  // Flow · Cookies, CJ6: Settings → Cookies. Every switch applies to the next request.
  import { t, tp } from '$shared/i18n';
  import {
    cookieJarScope,
    type CookieJarScope,
    cookiesExclude,
    cookiesKeepSession,
    cookiesSave,
    cookiesSend,
  } from '$shared/settings';
  import { cookieJar } from '$entities/cookies';
  import { row, sw, seg, chips } from './ui.svelte';
  import { Button } from '$shared/ui/components';

  const SCOPES = $derived([
    { label: t('settings.cookies.scope.workspace'), value: 'workspace' },
    { label: t('settings.cookies.scope.app'), value: 'app' },
  ]);
  const domains = $derived(new Set(cookieJar.list.map((c) => c.domain)).size);
  const status = $derived(
    t('settings.cookies.now', {
      cookies: `${cookieJar.list.length} ${tp(cookieJar.list.length, ['cookie', 'cookies', 'cookies'], ['cookie', 'cookies'])}`,
      domains: `${domains} ${tp(domains, ['домене', 'доменах', 'доменах'], ['domain', 'domains'])}`,
    }),
  );
</script>

<div class="st-group">{t('settings.cookies.jar')}</div>
<div class="st-card">
  {#snippet s1()}{@render sw(
      t('settings.cookies.save'),
      cookiesSave.current,
      (v) => (cookiesSave.current = v),
    )}{/snippet}
  {@render row(t('settings.cookies.save'), t('settings.cookies.save.desc'), s1)}
  {#snippet s2()}{@render sw(
      t('settings.cookies.send'),
      cookiesSend.current,
      (v) => (cookiesSend.current = v),
    )}{/snippet}
  {@render row(t('settings.cookies.send'), t('settings.cookies.send.desc'), s2)}
  {#snippet s3()}{@render sw(
      t('settings.cookies.keep'),
      cookiesKeepSession.current,
      (v) => (cookiesKeepSession.current = v),
    )}{/snippet}
  {@render row(
    t('settings.cookies.keep'),
    t(cookiesKeepSession.current ? 'settings.cookies.keep.on' : 'settings.cookies.keep.off'),
    s3,
  )}
</div>

<div class="st-group">{t('settings.cookies.scope')}</div>
<div class="st-card">
  {#snippet sc()}{@render seg(
      t('settings.cookies.scope.name'),
      cookieJarScope.current,
      SCOPES,
      (v) => (cookieJarScope.current = v as CookieJarScope),
    )}{/snippet}
  {@render row(t('settings.cookies.scope.name'), t('settings.cookies.scope.desc'), sc)}
</div>

<div class="st-group">{t('settings.cookies.exclude')}</div>
<div class="st-card">
  <div class="st-row st-col">
    <div class="st-copy">
      <span class="st-name">{t('settings.cookies.exclude.name')}</span><span class="st-desc"
        >{t('settings.cookies.exclude.desc')}</span
      >
    </div>
    {@render chips(
      t('settings.cookies.exclude.name'),
      cookiesExclude.current,
      t('settings.cookies.exclude.placeholder'),
      (items) => (cookiesExclude.current = items),
    )}
  </div>
</div>

<div class="st-cookies-foot">
  <p class="st-note" title={cookieJar.path}>{status}{cookieJar.path ? ` · ${cookieJar.path}` : ''}</p>
  <Button variant="ghost" onclick={() => cookieJar.open()}
    ><span class="material-symbols-outlined" aria-hidden="true">cookie</span>{t('cookies.open_jar')}</Button
  >
</div>

<style>
  .st-cookies-foot {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .st-cookies-foot .st-note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st-cookies-foot :global(.bs-btn) {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .st-cookies-foot .material-symbols-outlined {
    font-size: 16px;
  }
</style>
