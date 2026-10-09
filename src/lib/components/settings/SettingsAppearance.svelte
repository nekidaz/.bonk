<script lang="ts">
  import { t } from '../../i18n';
  import { theme, setTheme, isDarkTheme, THEME_OPTIONS, type Theme } from '../../theme';
  import { themeFollowSystem, uiFontSize, codeFont, codeFontSize, density, UI_FONT_SIZES, CODE_FONTS, type Density } from '../../stores';
  import { requestLayout, afterSend, sideOnWide, foldArraysOver, FOLD_ARRAYS_MIN, FOLD_ARRAYS_MAX, type AfterSend, type RequestLayout } from '../../stores';
  import { row, number, select, seg, sw, commit } from './ui.svelte';

  const LAYOUTS: RequestLayout[] = ['stack', 'side', 'focus'];

  const mode = $derived($themeFollowSystem ? 'system' : isDarkTheme($theme) ? 'dark' : 'light');
  function setMode(m: string): void {
    themeFollowSystem.set(m === 'system');
    if (m === 'light' && isDarkTheme($theme)) setTheme('smooth-light');
    if (m === 'dark' && !isDarkTheme($theme)) setTheme('smooth-dark');
  }
  function pickPalette(t: Theme): void {
    themeFollowSystem.set(false);
    setTheme(t);
  }
</script>

<div class="st-group">{$t('settings.appearance.theme')}</div>
<div class="st-card">
  {#snippet m()}{@render seg($t('settings.appearance.theme.label'), mode, [{ label: $t('settings.appearance.light'), value: 'light' }, { label: $t('settings.appearance.dark'), value: 'dark' }, { label: $t('settings.appearance.system'), value: 'system' }], setMode)}{/snippet}
  {@render row($t('settings.appearance.mode'), '', m)}
</div>
<div class="st-card st-pad">
  <div class="bs-theme-grid st-themes" role="radiogroup" aria-label={$t('settings.appearance.palette')}>
    {#each THEME_OPTIONS as t (t.value)}
      <button type="button" class="bs-theme-option" role="radio" aria-checked={$theme === t.value} class:on={$theme === t.value} onclick={() => pickPalette(t.value)}>
        <span class="bs-theme-preview" style:--theme-chrome={t.preview.chrome} style:--theme-canvas={t.preview.canvas} style:--theme-accent={t.preview.accent} aria-hidden="true"></span>
        <span class="bs-theme-label">{t.label}</span>
        <span class="material-symbols-outlined bs-theme-check" style="font-size:13px" aria-hidden="true">check</span>
      </button>
    {/each}
  </div>
</div>

<div class="st-group">{$t('settings.appearance.text')}</div>
<div class="st-card">
  {#snippet fs()}{@render seg($t('settings.appearance.uiSize'), String($uiFontSize), UI_FONT_SIZES.map((n) => ({ label: String(n), value: String(n) })), (v) => uiFontSize.set(Number(v)))}{/snippet}
  {@render row($t('settings.appearance.uiSize'), '', fs)}
  {#snippet cf()}{@render select($t('settings.appearance.codeFont'), $codeFont, CODE_FONTS.map((f) => ({ label: f, value: f })), (v) => codeFont.set(v))}{/snippet}
  {@render row($t('settings.appearance.codeFont'), '', cf)}
  {#snippet cs()}{@render number($t('settings.appearance.codeSize.aria'), $codeFontSize, 'px', 10, 20, (e) => commit(e, 10, 20, 12, 1, (n) => codeFontSize.set(n)))}{/snippet}
  {@render row($t('settings.appearance.codeSize'), '', cs)}
</div>

<div class="st-group">{$t('settings.appearance.density')}</div>
<div class="st-card">
  {#snippet dn()}{@render seg($t('settings.appearance.density.label'), $density, [{ label: $t('settings.appearance.compact'), value: 'compact' }, { label: $t('settings.appearance.normal'), value: 'normal' }], (v) => density.set(v as Density))}{/snippet}
  {@render row($t('settings.appearance.rows'), $t('settings.appearance.rows.desc'), dn)}
</div>

<div class="st-group">{$t('settings.appearance.layout')}</div>
<div class="st-card st-pad">
  <div class="st-layouts" role="radiogroup" aria-label={$t('settings.appearance.layout')}>
    {#each LAYOUTS as l (l)}
      <button type="button" class="st-layout" role="radio" aria-checked={$requestLayout === l} class:on={$requestLayout === l} onclick={() => requestLayout.set(l)}>
        <span class="st-layout-pic {l}" aria-hidden="true"><i></i><i></i></span>
        <span class="st-name">{$t(`settings.appearance.layout.${l}`)}</span>
        <span class="st-desc">{$t(`settings.appearance.layout.${l}.desc`)}</span>
      </button>
    {/each}
  </div>
</div>
<div class="st-card">
  {#snippet as()}{@render seg($t('settings.appearance.afterSend'), $afterSend, [{ label: $t('settings.appearance.afterSend.keep'), value: 'keep' }, { label: $t('settings.appearance.afterSend.expand'), value: 'expand' }], (v) => afterSend.set(v as AfterSend))}{/snippet}
  {@render row($t('settings.appearance.afterSend'), $t('settings.appearance.afterSend.desc'), as)}
  {#snippet wide()}{@render sw($t('settings.appearance.sideOnWide'), $sideOnWide, (v) => sideOnWide.set(v))}{/snippet}
  {@render row($t('settings.appearance.sideOnWide'), $t('settings.appearance.sideOnWide.desc'), wide)}
  {#snippet fold()}{@render number($t('settings.appearance.foldArrays'), $foldArraysOver, $t('settings.appearance.foldArrays.unit'), FOLD_ARRAYS_MIN, FOLD_ARRAYS_MAX, (e) => commit(e, FOLD_ARRAYS_MIN, FOLD_ARRAYS_MAX, 50, 1, (n) => foldArraysOver.set(n)))}{/snippet}
  {@render row($t('settings.appearance.foldArrays'), $t('settings.appearance.foldArrays.desc'), fold)}
</div>
