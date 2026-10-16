<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { t } from '$shared/i18n';
  import { importReadFile, themeImportPick, type ImportFile } from '$shared/ipc';
  import {
    theme,
    allThemes,
    themeCssText,
    themeInfo,
    pickTheme,
    deleteCustomTheme,
    type ThemeInfo,
    themeFollowSystem,
    systemLightTheme,
    systemDarkTheme,
    SHAPES,
    shapeOf,
    shapePref,
    fontOf,
    fontPref,
    type Theme,
    uiFontSize,
    codeFont,
    codeFontSize,
    density,
    UI_FONT_SIZES,
    CODE_FONTS,
    type Density,
    requestLayout,
    afterSend,
    sideOnWide,
    foldArraysOver,
    FOLD_ARRAYS_MIN,
    FOLD_ARRAYS_MAX,
    type AfterSend,
    type RequestLayout,
  } from '$shared/settings';
  import { row, number, select, seg, sw, commit, themePic } from './ui.svelte';
  import ThemeImportDialog from './ThemeImportDialog.svelte';

  const LAYOUTS: RequestLayout[] = ['stack', 'side', 'focus'];

  const shape = $derived(shapeOf(theme.current));
  const font = $derived(fontOf(theme.current));
  // Picking the theme's own shape goes back to following the theme.
  const setShape = (v: string) =>
    (shapePref.current = v === themeInfo(theme.current).shape ? 'theme' : (v as typeof shape));
  // Flow · Themes TH3: a Zed / VS Code theme, picked or dropped on the window, opens the import dialog.
  let importFile = $state.raw<ImportFile | null>(null);
  let pickError = $state('');
  async function pickThemeFile(): Promise<void> {
    pickError = '';
    try {
      importFile = (await themeImportPick()) ?? importFile;
    } catch (e) {
      pickError = String(e);
    }
  }
  // Tauri delivers dropped paths through the webview, not HTML5 drop events.
  $effect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const path = e.payload.type === 'drop' ? e.payload.paths.find((p) => /\.json$/i.test(p)) : undefined;
          if (!path) return;
          pickError = '';
          importReadFile(path).then(
            (f) => (importFile = f),
            (err) => (pickError = String(err)),
          );
        })
        .then((fn) => (cancelled ? fn() : (off = fn)))
        .catch(() => {});
    } catch {
      /* not inside Tauri (browser preview) */
    }
    return () => {
      cancelled = true;
      off?.();
    };
  });

  let armed = $state('');
  async function removeTheme(slug: string): Promise<void> {
    if (armed !== slug) {
      armed = slug;
      return;
    }
    armed = '';
    pickError = '';
    try {
      await deleteCustomTheme(slug);
    } catch (e) {
      pickError = String(e);
    }
  }

  const pairOptions = (dark: boolean) =>
    allThemes()
      .filter((x) => x.dark === dark)
      .map((x) => ({ label: x.name, value: x.id }));
</script>

<div class="st-group">{t('settings.appearance.theme')}</div>
<!-- Flow · Themes TH1: every card is a mini app in its own palette (data-theme on the card); “Follow system” picks a
     light and a dark theme (app/lifecycle.svelte.ts). -->
<!-- data-theme-drop: a dropped .json comes here, not to the collection import (features/import/DropZone). -->
<div class="st-card st-pad" data-theme-drop>
  <div class="st-themes" role="radiogroup" aria-label={t('settings.appearance.theme')}>
    {#snippet card(th: ThemeInfo)}
      <button
        type="button"
        class="st-theme"
        role="radio"
        aria-checked={theme.current === th.id}
        class:on={theme.current === th.id}
        onclick={() => pickTheme(th.id)}
      >
        {@render themePic(th.base, th.colors && themeCssText(th.colors))}
        <span class="st-mode-label"><span class="radio"></span>{th.name}</span>
      </button>
    {/snippet}
    {#each allThemes() as th (th.id)}
      {#if th.colors}
        {@const slug = th.id.slice('custom:'.length)}
        <!-- A user theme can be deleted: the first click arms the button, the second deletes the file. -->
        <div class="st-theme-cell">
          {@render card(th)}
          <button
            type="button"
            class="st-theme-del"
            class:armed={armed === slug}
            aria-label={t('settings.themes.delete', { name: th.name })}
            title={t('settings.themes.delete', { name: th.name })}
            onclick={() => removeTheme(slug)}
            onblur={() => (armed = '')}
          >
            {#if armed === slug}{t('settings.themes.deleteConfirm')}{:else}<span
                class="material-symbols-outlined"
                aria-hidden="true">delete</span
              >{/if}
          </button>
        </div>
      {:else}
        {@render card(th)}
      {/if}
    {/each}
  </div>
  <div class="st-theme-tools">
    <label class="st-inline">
      {@render sw(t('settings.appearance.system'), themeFollowSystem.current, (v) => (themeFollowSystem.current = v))}
      {t('settings.appearance.system')}:
    </label>
    {@render select(t('settings.appearance.systemLight'), systemLightTheme.current, pairOptions(false), (v) => {
      systemLightTheme.current = v as Theme;
    })}
    {@render select(t('settings.appearance.systemDark'), systemDarkTheme.current, pairOptions(true), (v) => {
      systemDarkTheme.current = v as Theme;
    })}
    <span class="st-spacer"></span>
    {#if pickError}<span class="st-error" title={pickError}>{pickError}</span>{/if}
    <button type="button" class="st-link" onclick={pickThemeFile}>
      <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>{t('settings.themeImport.open')}
    </button>
  </div>
</div>

<div class="st-group">{t('settings.appearance.shape')}</div>
<div class="st-card st-pad">
  <div class="st-themes" role="radiogroup" aria-label={t('settings.appearance.shape')}>
    {#each SHAPES as s (s)}
      <button
        type="button"
        class="st-theme"
        role="radio"
        aria-checked={shape === s}
        class:on={shape === s}
        onclick={() => setShape(s)}
      >
        <span class="st-shape-pic {s}" aria-hidden="true"><i><b></b><b></b></i></span>
        <span class="st-mode-label"
          ><span class="radio"></span>{t(`settings.appearance.shape.${s}`)}<span class="st-hint"
            >{t(`settings.appearance.shape.${s}.hint`)}</span
          ></span
        >
      </button>
    {/each}
  </div>
  <div class="st-theme-tools">
    <span class="st-name">{t('settings.appearance.uiFont')}</span>
    <span class="st-spacer"></span>
    {@render seg(
      t('settings.appearance.uiFont'),
      font,
      [
        { label: 'Inter', value: 'sans' },
        { label: 'JetBrains Mono', value: 'mono' },
      ],
      (v) => (fontPref.current = v as typeof font),
    )}
    <label class="st-inline">
      {@render sw(t('settings.appearance.fontFromTheme'), fontPref.current === 'theme', (v) => {
        fontPref.current = v ? 'theme' : font;
      })}
      {t('settings.appearance.fontFromTheme')}
    </label>
  </div>
</div>

<div class="st-group">{t('settings.appearance.text')}</div>
<div class="st-card">
  {#snippet fs()}{@render seg(
      t('settings.appearance.uiSize'),
      String(uiFontSize.current),
      UI_FONT_SIZES.map((n) => ({ label: String(n), value: String(n) })),
      (v) => (uiFontSize.current = Number(v)),
    )}{/snippet}
  {@render row(t('settings.appearance.uiSize'), '', fs)}
  {#snippet cf()}{@render select(
      t('settings.appearance.codeFont'),
      codeFont.current,
      CODE_FONTS.map((f) => ({ label: f, value: f })),
      (v) => (codeFont.current = v),
    )}{/snippet}
  {@render row(t('settings.appearance.codeFont'), '', cf)}
  {#snippet cs()}{@render number(t('settings.appearance.codeSize.aria'), codeFontSize.current, 'px', 10, 20, (e) =>
      commit(e, 10, 20, 12, 1, (n) => (codeFontSize.current = n)),
    )}{/snippet}
  {@render row(t('settings.appearance.codeSize'), '', cs)}
</div>

<div class="st-group">{t('settings.appearance.density')}</div>
<div class="st-card">
  {#snippet dn()}{@render seg(
      t('settings.appearance.density.label'),
      density.current,
      [
        { label: t('settings.appearance.compact'), value: 'compact' },
        { label: t('settings.appearance.normal'), value: 'normal' },
      ],
      (v) => (density.current = v as Density),
    )}{/snippet}
  {@render row(t('settings.appearance.density.label'), t('settings.appearance.density.desc'), dn)}
</div>

<div class="st-group">{t('settings.appearance.layout')}</div>
<div class="st-card st-pad">
  <div class="st-layouts" role="radiogroup" aria-label={t('settings.appearance.layout')}>
    {#each LAYOUTS as l (l)}
      <button
        type="button"
        class="st-layout"
        role="radio"
        aria-checked={requestLayout.current === l}
        class:on={requestLayout.current === l}
        onclick={() => (requestLayout.current = l)}
      >
        <span class="st-layout-pic {l}" aria-hidden="true"><i></i><i></i></span>
        <span class="st-name">{t(`settings.appearance.layout.${l}`)}</span>
        <span class="st-desc">{t(`settings.appearance.layout.${l}.desc`)}</span>
      </button>
    {/each}
  </div>
</div>
<div class="st-card">
  {#snippet as()}{@render seg(
      t('settings.appearance.afterSend'),
      afterSend.current,
      [
        { label: t('settings.appearance.afterSend.keep'), value: 'keep' },
        { label: t('settings.appearance.afterSend.expand'), value: 'expand' },
      ],
      (v) => (afterSend.current = v as AfterSend),
    )}{/snippet}
  {@render row(t('settings.appearance.afterSend'), t('settings.appearance.afterSend.desc'), as)}
  {#snippet wide()}{@render sw(
      t('settings.appearance.sideOnWide'),
      sideOnWide.current,
      (v) => (sideOnWide.current = v),
    )}{/snippet}
  {@render row(t('settings.appearance.sideOnWide'), t('settings.appearance.sideOnWide.desc'), wide)}
  {#snippet fold()}{@render number(
      t('settings.appearance.foldArrays'),
      foldArraysOver.current,
      t('settings.appearance.foldArrays.unit'),
      FOLD_ARRAYS_MIN,
      FOLD_ARRAYS_MAX,
      (e) => commit(e, FOLD_ARRAYS_MIN, FOLD_ARRAYS_MAX, 50, 1, (n) => (foldArraysOver.current = n)),
    )}{/snippet}
  {@render row(t('settings.appearance.foldArrays'), t('settings.appearance.foldArrays.desc'), fold)}
</div>

<ThemeImportDialog bind:file={importFile} onpick={pickThemeFile} />

<style>
  .st-theme-tools :global(.st-select) {
    min-width: 0;
    height: 26px;
  }

  .st-shape-pic.sharp :global(i) {
    border-radius: 6px;
  }

  .st-shape-pic.sharp :global(b) {
    border-radius: 5px;
  }

  .st-shape-pic.square :global(i) {
    border-radius: 0;
  }

  .st-shape-pic.square :global(b) {
    border-radius: 0;
  }

  /* S32.5b · Settings → Appearance → Layout */
  .st-layouts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .st-layout {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-panel);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--duration-hover) var(--ease-soft),
      background var(--duration-hover) var(--ease-soft);
  }

  .st-layout:hover {
    background: var(--color-hover);
  }

  .st-layout.on {
    border-color: var(--color-text);
  }

  .st-layout:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }

  .st-layout-pic {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    height: 44px;
    margin-bottom: 6px;
  }

  .st-layout-pic :global(i) {
    flex: 1;
    border-radius: 6px;
    background: var(--color-selected);
  }

  .st-layout.on .st-layout-pic :global(i:first-child) {
    background: var(--color-text-muted);
  }

  .st-layout-pic.side {
    flex-direction: row;
  }

  .st-layout-pic.focus :global(i:last-child) {
    flex: 0 0 8px;
  }

  @media (prefers-reduced-motion: reduce) {
    .st-layout {
      transition: none;
    }
  }

  /* Flow · Themes TH1: theme and shape cards, three per row. A theme card's picture carries data-theme, so every
     var() inside it resolves to that theme's palette (tokens.css). */
  .st-themes {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .st-theme {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  .st-theme:focus-visible {
    outline: 0;
  }

  .st-theme:focus-visible > :global(:first-child) {
    box-shadow: var(--focus-ring);
  }

  .st-shape-pic {
    display: flex;
    gap: 5px;
    height: 86px;
    padding: 6px;
    box-sizing: border-box;
    overflow: hidden;
    border-radius: 14px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    background: var(--color-app);
  }

  .st-theme.on > :global(:first-child) {
    outline: 2px solid var(--color-text);
    outline-offset: -2px;
  }

  /* Shape cards: a raised card with a field and a button, each at that shape's radii (tokens.css [data-shape]). */
  .st-shape-pic {
    height: 58px;
    align-items: center;
    padding: 10px;
    background: var(--color-panel);
  }

  .st-shape-pic :global(i) {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: 20px;
    background: var(--color-raised);
  }

  .st-shape-pic :global(b) {
    height: 14px;
    border-radius: 999px;
    background: var(--color-field);
  }

  .st-shape-pic :global(b:first-child) {
    flex: 1;
  }

  .st-shape-pic :global(b:last-child) {
    width: 24px;
    background: var(--color-action);
  }

  .st-mode-label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .st-mode-label .radio {
    flex: none;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 1.5px solid var(--color-border);
    border-radius: 50%;
  }

  .st-theme.on .st-mode-label {
    font-weight: 600;
  }

  .st-theme.on .st-mode-label .radio {
    border-color: var(--color-text);
    background: var(--color-text);
  }

  .st-hint {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  /* The row under the cards: “Follow system” with its light/dark pair, the UI font. */
  .st-theme-tools {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px -16px -16px;
    padding: 8px 16px;
    border-top: 1px solid var(--color-border-subtle);
  }

  .st-inline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
    cursor: pointer;
  }

  /* A user theme's card with its delete button in the picture's corner (shown on hover / focus, red once armed). */
  .st-theme-cell {
    position: relative;
    display: flex;
    min-width: 0;
  }

  .st-theme-cell > .st-theme {
    flex: 1;
  }

  .st-theme-del {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    align-items: center;
    height: 24px;
    min-width: 24px;
    justify-content: center;
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-raised);
    box-shadow: 0 0 0 1px var(--color-border-subtle);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--duration-hover);
  }

  .st-theme-del :global(.material-symbols-outlined) {
    font-size: 15px;
  }

  .st-theme-cell:hover .st-theme-del {
    opacity: 1;
  }

  .st-theme-del:focus-visible {
    opacity: 1;
  }

  .st-theme-del.armed {
    opacity: 1;
  }

  .st-theme-del:hover {
    color: var(--color-danger);
  }

  .st-theme-del.armed {
    color: var(--color-danger);
  }

  .st-theme-del.armed {
    background: var(--color-danger-soft);
    box-shadow: none;
    padding: 0 10px;
  }

  /* Flow · Themes: “Import a Zed / VS Code theme…” in the gallery's tools row. */
  .st-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
    cursor: pointer;
  }

  .st-link:hover {
    color: var(--color-text);
  }

  .st-link :global(.material-symbols-outlined) {
    font-size: 15px;
  }

  .st-error {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-danger);
    font: var(--font-size-caption) var(--font-ui);
  }
</style>
