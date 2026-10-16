<script lang="ts">
  // Flow · Themes TH3: a Zed / VS Code theme file → the token mapping, a preview in the theme's own colours,
  // and “Add theme”, which writes ~/.bonk/themes/<slug>.json and switches to it. Covers the settings sheet.
  import { untrack } from 'svelte';
  import { t } from '$shared/i18n';
  import { themeSave, type ImportFile } from '$shared/ipc';
  import { customThemes, pickTheme, serializeCustomTheme, themeCssText, THEME_TOKENS } from '$shared/settings';
  import { parseThemeFile, ThemeImportError, themeSlug, type ImportedThemeFile } from './themeImport';
  import { seg, themePic } from './ui.svelte';
  import { Button } from '$shared/ui/components';
  import CloseX from './CloseX.svelte';

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
      <CloseX type="button" aria-label={t('common.close')} onclick={close}>
        <span class="material-symbols-outlined" style="font-size:18px" aria-hidden="true">close</span>
      </CloseX>
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
        <Button variant="ghost" onclick={onpick}>{t('settings.themeImport.other')}</Button>
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
      <Button variant="ghost" onclick={close}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={!v || saving} onclick={save}>{t('settings.themeImport.save')}</Button>
    </footer>
  </div>
{/if}

<style>
  /* Flow · Themes TH3: theme import. Covers the settings sheet (position: relative above). */
  .thi {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: var(--color-raised);
    color: var(--color-text);
    outline: 0;
  }

  .thi-head {
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 24px 14px 28px;
  }

  .thi-head :global(h2) {
    margin: 4px 0 0;
    font: 600 18px/22px var(--font-ui);
  }

  .thi-eyebrow {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    white-space: pre;
  }

  .thi-body {
    flex: 1;
    min-height: 0;
    display: flex;
    border-top: 1px solid var(--color-border-subtle);
  }

  .thi-map {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px 16px 28px;
  }

  .thi-file {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
  }

  .thi-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    height: 26px;
    padding: 0 10px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .thi-chip :global(.material-symbols-outlined) {
    font-size: 14px;
    color: var(--color-text-secondary);
  }

  .thi-meta {
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
    white-space: nowrap;
  }

  .thi-table {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }

  .thi-row {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 120px;
    gap: 12px;
    align-items: center;
    height: 30px;
    padding: 0 16px;
    border-top: 1px solid var(--color-border-subtle);
    font: var(--font-size-caption) var(--font-code);
    color: var(--color-text-secondary);
  }

  .thi-row > :global(span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thi-row.thi-th {
    position: sticky;
    top: 0;
    border-top: 0;
    background: var(--color-field);
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: 0.6px;
  }

  .thi-row :global(.computed) {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .thi-row :global(.tok) {
    color: var(--sk);
  }

  .thi-row .hex {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-muted);
  }

  .thi-row .hex :global(i) {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  .thi-warn {
    flex: none;
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    font: var(--font-size-caption)/16px var(--font-ui);
  }

  .thi-warn :global(.material-symbols-outlined) {
    flex: none;
    font-size: 15px;
    color: var(--color-warning);
  }

  .thi-preview {
    flex: 0 0 300px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    box-sizing: border-box;
    background: var(--color-panel);
  }

  .thi-preview :global(p) {
    margin: 0;
    color: var(--color-text-secondary);
    font: var(--font-size-caption)/16px var(--font-ui);
  }

  .thi-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    border-top: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }

  .thi-empty :global(.material-symbols-outlined) {
    font-size: 28px;
    color: var(--color-danger);
  }

  .thi-foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px 12px 28px;
    border-top: 1px solid var(--color-border-subtle);
  }

  .thi-note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  .thi-note.err {
    color: var(--color-danger);
  }
</style>
