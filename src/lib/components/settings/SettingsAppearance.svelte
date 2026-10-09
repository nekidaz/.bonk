<script lang="ts">
  import { t } from '../../i18n';
  import { theme, setTheme, isDarkTheme } from '../../theme';
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
  const MODES = ['light', 'dark', 'system'] as const;
</script>

<div class="st-group">{$t('settings.appearance.theme')}</div>
<!-- S32.5: three cards with a mini app preview; «Как в системе» follows the OS (App.svelte). -->
<div class="st-card st-pad">
  <div class="st-modes" role="radiogroup" aria-label={$t('settings.appearance.theme')}>
    {#each MODES as m (m)}
      <button type="button" class="st-mode" role="radio" aria-checked={mode === m} class:on={mode === m} onclick={() => setMode(m)}>
        <span class="st-mode-pic {m}" aria-hidden="true">
          {#if m !== 'system'}<i class="side"><b></b><b></b><b></b></i><i class="main"><b class="title"></b><b class="url"><b></b></b><b></b><b></b></i>{/if}
        </span>
        <span class="st-mode-label"><span class="radio"></span>{$t(`settings.appearance.${m}`)}</span>
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
  {@render row($t('settings.appearance.density.label'), $t('settings.appearance.density.desc'), dn)}
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
