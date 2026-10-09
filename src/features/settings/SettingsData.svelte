<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import { onMount } from 'svelte';
  import {
    historyPaused,
    history,
    clearHistory,
    exportIncludeSecrets,
    exportFormat,
    historyDays,
  } from '$entities/history';
  import { requestConfirm } from '$shared/ui';
  import { importApiFile, buildWorkspaceExport, buildPostmanCollection, workspace } from '$entities/workspace';
  import { environments } from '$entities/environment';
  import { appDataDir, openapiExportSave, revealPath } from '$shared/ipc';
  import { row, sw, select } from './ui.svelte';

  const days = $derived([
    { label: t('settings.data.days', { n: 7 }), value: '7' },
    { label: t('settings.data.days', { n: 30 }), value: '30' },
    { label: t('settings.data.days', { n: 90 }), value: '90' },
    { label: t('settings.data.always'), value: '0' },
  ]);

  let dataDir = $state('');
  let status = $state('');
  onMount(() => {
    appDataDir()
      .then((d) => (dataDir = d))
      .catch(() => {});
  });

  const shortDir = $derived(dataDir.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~'));
  const size = (b: number) =>
    b < 1024
      ? t('settings.data.size.b', { n: b })
      : b < 1048576
        ? t('settings.data.size.kb', { n: Math.round(b / 1024) })
        : t('settings.data.size.mb', { n: (b / 1048576).toFixed(1) });
  const historyNote = $derived(
    `${$history.length} ${tp($history.length, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])} · ${size(new TextEncoder().encode(JSON.stringify($history)).length)}`,
  );

  async function run(fn: () => Promise<string | void>): Promise<void> {
    status = '';
    try {
      status = (await fn()) ?? '';
    } catch (e) {
      status = String(e);
    }
  }
  const doImport = () =>
    run(async () => {
      await importApiFile();
    });
  const doExport = () =>
    run(async () => {
      const name = workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace';
      const postman = exportFormat.current === 'postman';
      const text = postman
        ? buildPostmanCollection(name, workspace.tree, environments.globals, exportIncludeSecrets.current)
        : buildWorkspaceExport(
            name,
            workspace.tree,
            environments.globals,
            environments.list,
            exportIncludeSecrets.current,
          );
      return (await openapiExportSave(
        postman ? `${name}.postman_collection.json` : `${name}.bonk.json`,
        text,
        t('settings.data.export.title'),
      ))
        ? t('settings.data.exported')
        : '';
    });
  async function clear(): Promise<void> {
    if (await requestConfirm(t('settings.data.clear.confirm'), t('settings.data.clear.ok'))) clearHistory();
  }
</script>

<div class="st-group">{t('settings.data.import')}</div>
<div class="st-card">
  {#snippet imp()}<button type="button" class="bs-btn ghost" onclick={doImport}>{t('settings.data.import.btn')}</button
    >{/snippet}
  {@render row(t('settings.data.sources'), 'cURL, OpenAPI 3, Postman v2.1, Insomnia v4, HAR', imp)}
</div>

<div class="st-group">{t('settings.data.export')}</div>
<div class="st-card">
  {#snippet fmt()}{@render select(
      t('settings.data.format'),
      exportFormat.current,
      [
        { label: 'Bonk JSON', value: 'bonk' },
        { label: 'Postman Collection v2.1', value: 'postman' },
      ],
      (v) => (exportFormat.current = v === 'postman' ? 'postman' : 'bonk'),
    )}{/snippet}
  {@render row(t('settings.data.format'), '', fmt)}
  {#snippet sec()}{@render sw(
      t('settings.data.secrets'),
      exportIncludeSecrets.current,
      (v) => (exportIncludeSecrets.current = v),
    )}{/snippet}
  {@render row(t('settings.data.secrets'), t('settings.data.secrets.desc'), sec)}
  {#snippet exp()}<button type="button" class="bs-btn ghost" onclick={doExport}>{t('settings.data.export.btn')}</button
    >{/snippet}
  {@render row(t('settings.data.export.ws'), '', exp)}
</div>
{#if status}<p class="st-note">{status}</p>{/if}

<div class="st-group">{t('settings.data.history')}</div>
<div class="st-card">
  {#snippet keep()}{@render select(
      t('settings.data.keep'),
      String(historyDays.current),
      days,
      (v) => (historyDays.current = Number(v)),
    )}{/snippet}
  {@render row(t('settings.data.keep'), t('settings.data.keep.desc'), keep)}
  {#snippet pause()}{@render sw(t('settings.data.pause'), $historyPaused, (v) => historyPaused.set(v))}{/snippet}
  {@render row(t('settings.data.pause'), t('settings.data.pause.desc'), pause)}
  {#snippet clr()}<button type="button" class="bs-btn ghost danger" onclick={clear}
      >{t('settings.data.clear.btn')}</button
    >{/snippet}
  {@render row(t('settings.data.clear'), historyNote, clr, true)}
</div>

<div class="st-group">{t('settings.data.storage')}</div>
<div class="st-card">
  {#snippet show()}<button
      type="button"
      class="bs-btn ghost"
      disabled={!dataDir}
      onclick={() => run(() => revealPath(dataDir))}>{t('settings.data.reveal')}</button
    >{/snippet}
  {@render row(t('settings.data.dir'), shortDir, show)}
</div>
