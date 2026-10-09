<script lang="ts">
  import { t } from '$shared/i18n';
  import { requestPrefs } from '$shared/settings';
  import { row, sw, number, commit } from './ui.svelte';
</script>

<div class="st-group">{t('settings.req.network')}</div>
<div class="st-card">
  {#snippet t1()}{@render number(
      t('settings.req.timeout.aria'),
      Math.round(requestPrefs.requestTimeoutMs / 1000),
      's',
      0,
      600,
      (e) => commit(e, 0, 600, 30, 1000, (n) => (requestPrefs.requestTimeoutMs = n)),
    )}{/snippet}
  {@render row(t('settings.req.timeout'), t('settings.req.timeout.desc'), t1)}
  {#snippet t2()}{@render sw(
      t('settings.req.redirects'),
      requestPrefs.requestFollowRedirects,
      (v) => (requestPrefs.requestFollowRedirects = v),
    )}{/snippet}
  {@render row(t('settings.req.redirects'), t('settings.req.redirects.desc'), t2)}
  {#snippet t3()}{@render sw(
      t('settings.req.tls'),
      requestPrefs.requestValidateTls,
      (v) => (requestPrefs.requestValidateTls = v),
    )}{/snippet}
  {@render row(t('settings.req.tls'), t('settings.req.tls.desc'), t3)}
</div>
<div class="st-group">{t('settings.req.response')}</div>
<div class="st-card">
  {#snippet r1()}{@render number(t('settings.req.preview.aria'), requestPrefs.responseBodyLimitMb, 'MB', 1, 250, (e) =>
      commit(e, 1, 250, 25, 1, (n) => (requestPrefs.responseBodyLimitMb = n)),
    )}{/snippet}
  {@render row(t('settings.req.preview'), t('settings.req.preview.desc'), r1)}
  {#snippet r2()}{@render sw(
      t('settings.req.pretty'),
      requestPrefs.responsePrettyDefault,
      (v) => (requestPrefs.responsePrettyDefault = v),
    )}{/snippet}
  {@render row(t('settings.req.pretty'), t('settings.req.pretty.desc'), r2)}
  {#snippet r3()}{@render sw(
      t('settings.req.wrap'),
      requestPrefs.responseLineWrap,
      (v) => (requestPrefs.responseLineWrap = v),
    )}{/snippet}
  {@render row(t('settings.req.wrap'), t('settings.req.wrap.desc'), r3)}
</div>
<div class="st-group">GRPC</div>
<div class="st-card">
  {#snippet g1()}{@render number(
      t('settings.grpc.deadline.aria'),
      Math.round(requestPrefs.grpcDeadlineMs / 1000),
      's',
      0,
      600,
      (e) => commit(e, 0, 600, 30, 1000, (n) => (requestPrefs.grpcDeadlineMs = n)),
    )}{/snippet}
  {@render row(t('settings.grpc.deadline'), t('settings.grpc.deadline.desc'), g1)}
  {#snippet g2()}{@render sw(
      t('settings.grpc.reflect'),
      requestPrefs.grpcAutoReflect,
      (v) => (requestPrefs.grpcAutoReflect = v),
    )}{/snippet}
  {@render row(t('settings.grpc.reflect'), t('settings.grpc.reflect.desc'), g2)}
</div>
