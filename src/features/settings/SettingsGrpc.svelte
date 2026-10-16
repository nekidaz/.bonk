<script lang="ts">
  import { t } from '$shared/i18n';
  import {
    grpcImportPaths,
    grpcMaxMessageMb,
    grpcKeepaliveSecs,
    grpcEmitDefaults,
    grpcInt64AsNumber,
    requestPrefs,
  } from '$shared/settings';
  import { row, sw, number, select, chips, commit } from './ui.svelte';
  import Row from './Row.svelte';
</script>

<div class="st-group">{t('settings.grpc.schema')}</div>
<div class="st-card">
  {#snippet ar()}{@render sw(
      t('settings.grpc.reflect'),
      requestPrefs.grpcAutoReflect.current,
      (v) => (requestPrefs.grpcAutoReflect.current = v),
    )}{/snippet}
  {@render row(t('settings.grpc.reflect'), t('settings.grpc.reflect.desc'), ar)}
  <Row class="st-col">
    <div class="st-copy">
      <span class="st-name">{t('settings.grpc.paths')}</span><span class="st-desc">{t('settings.grpc.paths.desc')}</span
      >
    </div>
    {@render chips(
      t('settings.grpc.paths.aria'),
      grpcImportPaths.current,
      t('settings.grpc.paths.ph'),
      (items) => (grpcImportPaths.current = items),
    )}
  </Row>
</div>
<div class="st-group">{t('settings.grpc.call')}</div>
<div class="st-card">
  {#snippet dl()}{@render number(
      t('settings.grpc.deadline.aria'),
      Math.round(requestPrefs.grpcDeadlineMs.current / 1000),
      's',
      0,
      600,
      (e) => commit(e, 0, 600, 30, 1000, (n) => (requestPrefs.grpcDeadlineMs.current = n)),
    )}{/snippet}
  {@render row(t('settings.grpc.deadline'), t('settings.grpc.deadline.desc'), dl)}
  {#snippet mm()}{@render number(t('settings.grpc.maxMsg.aria'), grpcMaxMessageMb.current, 'MB', 1, 250, (e) =>
      commit(e, 1, 250, 250, 1, (n) => (grpcMaxMessageMb.current = n)),
    )}{/snippet}
  {@render row(t('settings.grpc.maxMsg'), t('settings.grpc.maxMsg.desc'), mm)}
  {#snippet ka()}{@render number(t('settings.grpc.keepalive.aria'), grpcKeepaliveSecs.current, 's', 0, 600, (e) =>
      commit(e, 0, 600, 30, 1, (n) => (grpcKeepaliveSecs.current = n)),
    )}{/snippet}
  {@render row('Keepalive', t('settings.grpc.keepalive.desc'), ka)}
</div>
<div class="st-group">{t('settings.grpc.display')}</div>
<div class="st-card">
  {#snippet ed()}{@render sw(
      t('settings.grpc.defaults'),
      grpcEmitDefaults.current,
      (v) => (grpcEmitDefaults.current = v),
    )}{/snippet}
  {@render row(t('settings.grpc.defaults'), t('settings.grpc.defaults.desc'), ed)}
  {#snippet i64()}{@render select(
      t('settings.grpc.int64'),
      grpcInt64AsNumber.current ? 'number' : 'string',
      [
        { label: t('settings.grpc.int64.string'), value: 'string' },
        { label: t('settings.grpc.int64.number'), value: 'number' },
      ],
      (v) => (grpcInt64AsNumber.current = v === 'number'),
    )}{/snippet}
  {@render row(t('settings.grpc.int64'), t('settings.grpc.int64.desc'), i64)}
</div>
