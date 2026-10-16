<script lang="ts">
  import { t } from '$shared/i18n';
  import { filePick, certFileInfo } from '$shared/ipc';
  import {
    trustSystemCas,
    clientCerts,
    p12Passwords,
    setP12Password,
    forgetP12Password,
    fileName,
    type HostCert,
    requestPrefs,
  } from '$shared/settings';
  import { row, sw, seg } from './ui.svelte';
  import { Button } from '$shared/ui/components';
  import TextField from './TextField.svelte';
  import Row from './Row.svelte';

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
    if (path && !requestPrefs.trustedCaPaths.current.includes(path))
      requestPrefs.trustedCaPaths.current = [...requestPrefs.trustedCaPaths.current, path];
  }

  // "<subject CN> · до <date>" per CA file; falls back to the path when the file can't be parsed.
  let caInfo = $state<Record<string, string>>({});
  $effect(() => {
    for (const path of requestPrefs.trustedCaPaths.current) {
      if (caInfo[path] !== undefined) continue;
      caInfo[path] = path;
      certFileInfo(path)
        .then(
          ([cn, notAfter]) =>
            (caInfo[path] =
              `${cn || fileName(path)} · ${t('settings.certs.until')} ${new Date(notAfter * 1000).toLocaleDateString(t('app.dateLocale'))}`),
        )
        .catch(() => {});
    }
  });

  // Inline editor for one per-host identity; index -1 = new.
  let draft = $state<(HostCert & { index: number; mode: 'pem' | 'p12'; password: string }) | null>(null);
  const newDraft = () => ({ index: -1, host: '', certPath: '', keyPath: '', mode: 'pem' as const, password: '' });
  const editDraft = (c: HostCert, index: number) => ({
    ...c,
    index,
    mode: c.p12Path ? ('p12' as const) : ('pem' as const),
    password: c.p12Path ? (p12Passwords.current[c.p12Path] ?? '') : '',
  });
  const ready = $derived(!!draft && (draft.mode === 'p12' ? !!draft.p12Path : !!draft.certPath && !!draft.keyPath));
  async function pickInto(field: 'certPath' | 'keyPath' | 'p12Path'): Promise<void> {
    certError = '';
    const path = await pickPem();
    if (path && draft) draft[field] = path;
  }
  async function saveDraft(): Promise<void> {
    if (!draft) return;
    const { index, mode, password, p12Path, ...rest } = draft;
    const host = rest.host.trim();
    const old = index >= 0 ? clientCerts.current[index]?.p12Path : undefined;
    const entry: HostCert =
      mode === 'p12' && p12Path
        ? { host, certPath: '', keyPath: '', p12Path }
        : { host, certPath: rest.certPath, keyPath: rest.keyPath };
    if (entry.p12Path) await setP12Password(entry.p12Path, password);
    clientCerts.current =
      index < 0 ? [...clientCerts.current, entry] : clientCerts.current.map((c, i) => (i === index ? entry : c));
    if (old && old !== entry.p12Path) forgetP12Password(old);
    draft = null;
  }
  function removeCert(i: number): void {
    const old = clientCerts.current[i]?.p12Path;
    clientCerts.current = clientCerts.current.filter((_, j) => j !== i);
    if (old) forgetP12Password(old);
  }
</script>

<div class="st-group">{t('settings.certs.cas')}</div>
<div class="st-card">
  {#snippet sys()}{@render sw(
      t('settings.certs.system'),
      trustSystemCas.current,
      (v) => (trustSystemCas.current = v),
    )}{/snippet}
  {@render row(
    t('settings.certs.system'),
    trustSystemCas.current ? t('settings.certs.system.on') : t('settings.certs.system.off'),
    sys,
  )}
  {#each requestPrefs.trustedCaPaths.current as path (path)}
    <Row>
      <div class="st-copy">
        <span class="st-name">{fileName(path)}</span><span class="st-desc" title={path}>{caInfo[path] ?? path}</span>
      </div>
      <Button
        variant="ghost-danger"
        onclick={() =>
          (requestPrefs.trustedCaPaths.current = requestPrefs.trustedCaPaths.current.filter((x) => x !== path))}
        >{t('common.delete')}</Button
      >
    </Row>
  {/each}
  {#snippet c1()}<Button variant="ghost" onclick={() => void addCa()}>{t('settings.certs.addCa')}</Button>{/snippet}
  {@render row(t('settings.certs.ownCa'), t('settings.certs.ownCa.desc'), c1)}
</div>

<div class="st-group">{t('settings.certs.client')}</div>
<div class="st-card">
  {#if clientCerts.current.length}
    <div class="st-certs st-certs-head">
      <span>{t('settings.certs.col.host')}</span><span>{t('settings.certs.col.cert')}</span><span
        >{t('settings.certs.col.key')}</span
      ><span></span>
    </div>
    {#each clientCerts.current as c, i (i)}
      <div class="st-certs">
        <span class="st-name" title={c.host}>{c.host || t('settings.certs.anyHost')}</span>
        <span class="st-desc" title={c.p12Path ?? c.certPath}>{fileName(c.p12Path ?? c.certPath)}</span>
        <span class="st-desc" title={c.p12Path ? '' : c.keyPath}
          >{c.p12Path
            ? `${t('settings.certs.pw')} ${p12Passwords.current[c.p12Path] ? '••••' : '—'}`
            : fileName(c.keyPath)}</span
        >
        <span class="st-file">
          <Button variant="ghost" onclick={() => (draft = editDraft(c, i))}>{t('settings.certs.edit')}</Button>
          <Button variant="ghost-danger" onclick={() => removeCert(i)}>{t('common.delete')}</Button>
        </span>
      </div>
    {/each}
  {/if}
  {#if draft}
    <Row class="st-col">
      <div class="st-copy">
        <span class="st-name">{t('settings.certs.host')}</span><span class="st-desc"
          >{t('settings.certs.host.desc')}</span
        >
      </div>
      <TextField
        type="text"
        spellcheck="false"
        placeholder="api.example.com"
        aria-label={t('settings.certs.host.aria')}
        bind:value={draft.host}
      />
      {@render seg(
        t('settings.certs.client'),
        draft.mode,
        [
          { label: t('settings.certs.fmt.pem'), value: 'pem' },
          { label: t('settings.certs.fmt.p12'), value: 'p12' },
        ],
        (v) => {
          if (draft) draft.mode = v === 'p12' ? 'p12' : 'pem';
        },
      )}
      {#if draft.mode === 'p12'}
        <div class="st-file">
          <Button variant="ghost" onclick={() => void pickInto('p12Path')}>{t('settings.certs.pickP12')}</Button>
          <span class="st-desc">{draft.p12Path ? fileName(draft.p12Path) : t('settings.certs.notPicked')}</span>
        </div>
        <TextField
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder={t('settings.certs.password')}
          aria-label={t('settings.certs.password')}
          bind:value={draft.password}
        />
      {:else}
        <div class="st-file">
          <Button variant="ghost" onclick={() => void pickInto('certPath')}>{t('settings.certs.pickCert')}</Button>
          <span class="st-desc">{draft.certPath ? fileName(draft.certPath) : t('settings.certs.notPicked')}</span>
        </div>
        <div class="st-file">
          <Button variant="ghost" onclick={() => void pickInto('keyPath')}>{t('settings.certs.pickKey')}</Button>
          <span class="st-desc">{draft.keyPath ? fileName(draft.keyPath) : t('settings.certs.notPicked')}</span>
        </div>
      {/if}
      <div class="st-file">
        <Button disabled={!ready} onclick={() => void saveDraft()}>{t('common.save')}</Button>
        <Button variant="ghost" onclick={() => (draft = null)}>{t('common.cancel')}</Button>
      </div>
    </Row>
  {:else}
    {#snippet c2()}<Button variant="ghost" onclick={() => (draft = newDraft())}>{t('settings.certs.addHost')}</Button
      >{/snippet}
    {@render row(t('settings.certs.hostCert'), clientCerts.current.length ? '' : t('settings.certs.empty'), c2)}
  {/if}
</div>
{#if certError}<div class="st-err" role="alert">{certError}</div>{/if}
<p class="st-note">{t('settings.certs.note')}</p>

<style>
  .st-file {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
  }

  /* Settings → Сертификаты: per-host mTLS table (host | certificate | key | actions). */
  .st-certs {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
  }

  .st-certs + .st-certs {
    border-top: 1px solid var(--color-border-subtle);
  }

  :global(.st-card) > .st-certs-head + .st-certs {
    border-top: 1px solid var(--color-border-subtle);
  }

  .st-certs :global(span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .st-certs-head {
    padding-top: 11px;
    font: var(--font-size-caption) var(--font-ui);
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
  }
</style>
