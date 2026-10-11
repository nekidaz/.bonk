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
  // Flow · Темы TH3: a Zed / VS Code theme, picked or dropped on the window, opens the import dialog.
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
<!-- Flow · Темы TH1: every card is a mini app in its own palette (data-theme on the card); «Как в системе» picks a
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
