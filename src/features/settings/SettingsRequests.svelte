<script lang="ts">
  import { t } from '$shared/i18n';
  import {
    requestTimeoutMs,
    requestFollowRedirects,
    requestValidateTls,
    responseBodyLimitMb,
    responsePrettyDefault,
    responseLineWrap,
    grpcDeadlineMs,
    grpcAutoReflect,
  } from '$shared/settings';
  import { row, sw, number, commit } from './ui.svelte';
</script>

<div class="st-group">{$t('settings.req.network')}</div>
<div class="st-card">
  {#snippet t1()}{@render number(
      $t('settings.req.timeout.aria'),
      Math.round($requestTimeoutMs / 1000),
      's',
      0,
      600,
      (e) => commit(e, 0, 600, 30, 1000, (n) => requestTimeoutMs.set(n)),
    )}{/snippet}
  {@render row($t('settings.req.timeout'), $t('settings.req.timeout.desc'), t1)}
  {#snippet t2()}{@render sw($t('settings.req.redirects'), $requestFollowRedirects, (v) =>
      requestFollowRedirects.set(v),
    )}{/snippet}
  {@render row($t('settings.req.redirects'), $t('settings.req.redirects.desc'), t2)}
  {#snippet t3()}{@render sw($t('settings.req.tls'), $requestValidateTls, (v) => requestValidateTls.set(v))}{/snippet}
  {@render row($t('settings.req.tls'), $t('settings.req.tls.desc'), t3)}
</div>
<div class="st-group">{$t('settings.req.response')}</div>
<div class="st-card">
  {#snippet r1()}{@render number($t('settings.req.preview.aria'), $responseBodyLimitMb, 'MB', 1, 250, (e) =>
      commit(e, 1, 250, 25, 1, (n) => responseBodyLimitMb.set(n)),
    )}{/snippet}
  {@render row($t('settings.req.preview'), $t('settings.req.preview.desc'), r1)}
  {#snippet r2()}{@render sw($t('settings.req.pretty'), $responsePrettyDefault, (v) =>
      responsePrettyDefault.set(v),
    )}{/snippet}
  {@render row($t('settings.req.pretty'), $t('settings.req.pretty.desc'), r2)}
  {#snippet r3()}{@render sw($t('settings.req.wrap'), $responseLineWrap, (v) => responseLineWrap.set(v))}{/snippet}
  {@render row($t('settings.req.wrap'), $t('settings.req.wrap.desc'), r3)}
</div>
<div class="st-group">GRPC</div>
<div class="st-card">
  {#snippet g1()}{@render number(
      $t('settings.grpc.deadline.aria'),
      Math.round($grpcDeadlineMs / 1000),
      's',
      0,
      600,
      (e) => commit(e, 0, 600, 30, 1000, (n) => grpcDeadlineMs.set(n)),
    )}{/snippet}
  {@render row($t('settings.grpc.deadline'), $t('settings.grpc.deadline.desc'), g1)}
  {#snippet g2()}{@render sw($t('settings.grpc.reflect'), $grpcAutoReflect, (v) => grpcAutoReflect.set(v))}{/snippet}
  {@render row($t('settings.grpc.reflect'), $t('settings.grpc.reflect.desc'), g2)}
</div>
