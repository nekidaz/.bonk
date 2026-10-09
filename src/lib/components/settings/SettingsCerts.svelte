<script lang="ts">
  import { t } from '../../i18n';
  import { get } from 'svelte/store';
  import { filePick, certFileInfo } from '../../api';
  import { trustedCaPaths } from '../../stores';
  import { trustSystemCas, clientCerts } from '../../stores/netPrefs';
  import { fileName, type HostCert } from '../../domain/proxy';
  import { row, sw } from './ui.svelte';

  let certError = $state('');
  async function pickPem(): Promise<string | null> {
    try {
      return await filePick();
    } catch (error) {
      certError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
  async function addCa(): Promise<void> {
    certError = '';
    const path = await pickPem();
    if (path && !$trustedCaPaths.includes(path)) trustedCaPaths.update((l) => [...l, path]);
  }

  // "<subject CN> · до <date>" per CA file; falls back to the path when the file can't be parsed.
  let caInfo = $state<Record<string, string>>({});
  $effect(() => {
    for (const path of $trustedCaPaths) {
      if (caInfo[path] !== undefined) continue;
      caInfo[path] = path;
      certFileInfo(path)
        .then(([cn, notAfter]) => (caInfo[path] = `${cn || fileName(path)} · ${get(t)('settings.certs.until')} ${new Date(notAfter * 1000).toLocaleDateString(get(t)('app.dateLocale'))}`))
        .catch(() => {});
    }
  });

  // Inline editor for one per-host identity; index -1 = new.
  let draft = $state<(HostCert & { index: number }) | null>(null);
  async function pickInto(field: 'certPath' | 'keyPath'): Promise<void> {
    certError = '';
    const path = await pickPem();
    if (path && draft) draft[field] = path;
  }
  function saveDraft(): void {
    if (!draft) return;
    const { index, ...entry } = draft;
    entry.host = entry.host.trim();
    clientCerts.update((l) => (index < 0 ? [...l, entry] : l.map((c, i) => (i === index ? entry : c))));
    draft = null;
  }
</script>

<div class="st-group">{$t('settings.certs.cas')}</div>
<div class="st-card">
  {#snippet sys()}{@render sw($t('settings.certs.system'), $trustSystemCas, (v) => trustSystemCas.set(v))}{/snippet}
  {@render row($t('settings.certs.system'), $trustSystemCas ? $t('settings.certs.system.on') : $t('settings.certs.system.off'), sys)}
  {#each $trustedCaPaths as path (path)}
    <div class="st-row">
      <div class="st-copy"><span class="st-name">{fileName(path)}</span><span class="st-desc" title={path}>{caInfo[path] ?? path}</span></div>
      <button type="button" class="bs-btn ghost danger" onclick={() => trustedCaPaths.update((l) => l.filter((x) => x !== path))}>{$t('common.delete')}</button>
    </div>
  {/each}
  {#snippet c1()}<button type="button" class="bs-btn ghost" onclick={() => void addCa()}>{$t('settings.certs.addCa')}</button>{/snippet}
  {@render row($t('settings.certs.ownCa'), $t('settings.certs.ownCa.desc'), c1)}
</div>

<div class="st-group">{$t('settings.certs.client')}</div>
<div class="st-card">
  {#if $clientCerts.length}
    <div class="st-certs st-certs-head"><span>{$t('settings.certs.col.host')}</span><span>{$t('settings.certs.col.cert')}</span><span>{$t('settings.certs.col.key')}</span><span></span></div>
    {#each $clientCerts as c, i (i)}
      <div class="st-certs">
        <span class="st-name" title={c.host}>{c.host || $t('settings.certs.anyHost')}</span>
        <span class="st-desc" title={c.certPath}>{fileName(c.certPath)}</span>
        <span class="st-desc" title={c.keyPath}>{fileName(c.keyPath)}</span>
        <span class="st-file">
          <button type="button" class="bs-btn ghost" onclick={() => (draft = { ...c, index: i })}>{$t('settings.certs.edit')}</button>
          <button type="button" class="bs-btn ghost danger" onclick={() => clientCerts.update((l) => l.filter((_, j) => j !== i))}>{$t('common.delete')}</button>
        </span>
      </div>
    {/each}
  {/if}
  {#if draft}
    <div class="st-row st-col">
      <div class="st-copy"><span class="st-name">{$t('settings.certs.host')}</span><span class="st-desc">{$t('settings.certs.host.desc')}</span></div>
      <input class="st-text" type="text" spellcheck="false" placeholder="api.example.com" aria-label={$t('settings.certs.host.aria')} bind:value={draft.host} />
      <div class="st-file">
        <button type="button" class="bs-btn ghost" onclick={() => void pickInto('certPath')}>{$t('settings.certs.pickCert')}</button>
        <span class="st-desc">{draft.certPath ? fileName(draft.certPath) : $t('settings.certs.notPicked')}</span>
      </div>
      <div class="st-file">
        <button type="button" class="bs-btn ghost" onclick={() => void pickInto('keyPath')}>{$t('settings.certs.pickKey')}</button>
        <span class="st-desc">{draft.keyPath ? fileName(draft.keyPath) : $t('settings.certs.notPicked')}</span>
      </div>
      <div class="st-file">
        <button type="button" class="bs-btn" disabled={!draft.certPath || !draft.keyPath} onclick={saveDraft}>{$t('common.save')}</button>
        <button type="button" class="bs-btn ghost" onclick={() => (draft = null)}>{$t('common.cancel')}</button>
      </div>
    </div>
  {:else}
    {#snippet c2()}<button type="button" class="bs-btn ghost" onclick={() => (draft = { index: -1, host: '', certPath: '', keyPath: '' })}>{$t('settings.certs.addHost')}</button>{/snippet}
    {@render row($t('settings.certs.hostCert'), $clientCerts.length ? '' : $t('settings.certs.empty'), c2)}
  {/if}
</div>
{#if certError}<div class="st-err" role="alert">{certError}</div>{/if}
<p class="st-note">{$t('settings.certs.note')}</p>
