<script lang="ts">
  // Flow · Темы TH3: a Zed / VS Code theme file → the token mapping, a preview in the theme's own colours,
  // and «Добавить тему», which writes ~/.bonk/themes/<slug>.json and switches to it. Covers the settings sheet.
  import { untrack } from 'svelte';
  import { t } from '$shared/i18n';
  import { themeSave, type ImportFile } from '$shared/ipc';
  import { customThemes, pickTheme, serializeCustomTheme, themeCssText, THEME_TOKENS } from '$shared/settings';
  import { parseThemeFile, ThemeImportError, themeSlug, type ImportedThemeFile } from './themeImport';
  import { seg, themePic } from './ui.svelte';

  let { file = $bindable(), onpick }: { file: ImportFile | null; onpick: () => void } = $props();

  const parsed = $derived.by((): ImportedThemeFile | { error: 'json' | 'format' } => {
    if (!file) return { error: 'format' };
    try {
      return parseThemeFile(file.text, file.name);
    } catch (e) {
      return { error: e instanceof ThemeImportError ? e.code : 'format' };
    }
  });
  let index = $state(0);
  let saving = $state(false);
  let saveError = $state('');
  $effect(() => {
    void file;
    untrack(() => {
      index = 0;
      saveError = '';
    });
  });

  const variants = $derived('variants' in parsed ? parsed.variants : []);
  const v = $derived(variants[index] ?? variants[0]);
  const source = $derived('source' in parsed && parsed.source === 'vscode' ? 'VS Code' : 'Zed');
  const slug = $derived(v ? themeSlug(v.name) : '');

  function close(): void {
    file = null;
  }

  async function save(): Promise<void> {
    if (!v || saving) return;
    saving = true;
    saveError = '';
    const theme = { slug, name: v.name, dark: v.dark, colors: v.colors };
    try {
      await themeSave(slug, serializeCustomTheme(theme));
      customThemes.put(theme);
      pickTheme(`custom:${slug}`);
      close();
    } catch (e) {
      saveError = String(e);
    } finally {
      saving = false;
    }
  }

  // Esc closes this dialog only; the settings sheet checks defaultPrevented.
  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

{#if file}
  <div
    class="thi"
    role="dialog"
    aria-modal="true"
    aria-labelledby="thi-title"
    tabindex="-1"
    onkeydown={keydown}
    {@attach (el) => el.focus()}
  >
    <header class="thi-head">
      <div>
        <div class="thi-eyebrow">{t('settings.themeImport.eyebrow', { source })}</div>
        <h2 id="thi-title">{v?.name ?? file.name}</h2>
      </div>
      <button type="button" class="st-x" aria-label={t('common.close')} onclick={close}>
        <span class="material-symbols-outlined" style="font-size:18px" aria-hidden="true">close</span>
      </button>
    </header>

    {#if v}
      <div class="thi-body">
        <div class="thi-map">
          <div class="thi-file">
            <button type="button" class="thi-chip" title={t('settings.themeImport.other')} onclick={onpick}>
              <span class="material-symbols-outlined" aria-hidden="true">description</span>{file.name}
            </button>
            <span class="thi-meta">{t('settings.themeImport.kind', { source })}</span>
            <span class="st-spacer"></span>
            {#if variants.length > 1}
              {@render seg(
                t('settings.themeImport.variant'),
                String(index),
                variants.map((x, i) => ({ label: x.name, value: String(i) })),
                (i) => (index = Number(i)),
              )}
            {/if}
          </div>
          <div class="thi-table" role="table" aria-label={t('settings.themeImport.mapping')}>
            <div class="thi-row thi-th" role="row">
              <span role="columnheader">{t('settings.themeImport.key', { source })}</span>
              <span role="columnheader">→ {t('settings.themeImport.token')}</span>
              <span role="columnheader">{t('settings.themeImport.color')}</span>
            </div>
            {#each v.rows as r (r.token)}
              <div class="thi-row" role="row">
                <span role="cell" class:computed={!r.key}>{r.key ?? t('settings.themeImport.computed')}</span>
                <span role="cell" class="tok">{r.token}</span>
                <span role="cell" class="hex"><i style:background={r.color}></i>{r.color}</span>
              </div>
            {/each}
          </div>
          {#if v.missing.length}
            <div class="thi-warn">
              <span class="material-symbols-outlined" aria-hidden="true">warning</span>
              {t('settings.themeImport.missing', {
                n: THEME_TOKENS.length - v.missing.length,
                total: THEME_TOKENS.length,
                list: v.missing.join(', '),
                base: v.dark ? 'Bonk Dark' : 'Bonk Light',
              })}
            </div>
          {/if}
        </div>
        <aside class="thi-preview">
          <div class="thi-eyebrow">{t('settings.themeImport.preview')}</div>
          {@render themePic(v.dark ? 'smooth-dark' : 'smooth-light', themeCssText(v.colors))}
          <p>{t('settings.themeImport.previewNote')}</p>
        </aside>
      </div>
    {:else}
      <div class="thi-empty">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <p>{t(`settings.themeImport.err.${'error' in parsed ? parsed.error : 'format'}`, { name: file.name })}</p>
        <button type="button" class="bs-btn ghost" onclick={onpick}>{t('settings.themeImport.other')}</button>
      </div>
    {/if}

    <footer class="thi-foot">
      {#if saveError}
        <span class="thi-note err">{saveError}</span>
      {:else if v}
        <span class="thi-note">{t('settings.themeImport.savePath', { path: `~/.bonk/themes/${slug}.json` })}</span>
      {:else}
        <span class="thi-note"></span>
      {/if}
      <button type="button" class="bs-btn ghost" onclick={close}>{t('common.cancel')}</button>
      <button type="button" class="bs-btn primary" disabled={!v || saving} onclick={save}
        >{t('settings.themeImport.save')}</button
      >
    </footer>
  </div>
{/if}
