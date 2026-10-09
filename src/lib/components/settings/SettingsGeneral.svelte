<script lang="ts">
  import {
    uiLanguage,
    startupOpen,
    autoUpdateCheck,
    openInNewTab,
    confirmCloseUnsaved,
    type UiLanguage,
  } from '../../stores';
  import { t } from '../../i18n';
  import {
    updateStatus,
    updateVersion,
    updateCurrent,
    updateProgress,
    installUpdate,
    openReleaseNotes,
  } from '../../updater';
  import SettingsWorkspace from './SettingsWorkspace.svelte';
  import { row, sw, select } from './ui.svelte';

  let { appVersion }: { appVersion: string } = $props();

  const ready = $derived($updateStatus === 'ready' || $updateStatus === 'installing');
  const updateNote = $derived(
    ready
      ? $t('settings.update.ready', { cur: $updateCurrent || appVersion, v: $updateVersion })
      : $updateStatus === 'checking'
        ? `Bonk ${appVersion} · ${$t('settings.update.checking')}`
        : $updateStatus === 'downloading'
          ? `Bonk ${appVersion} · ${$t('settings.update.downloading', { v: $updateVersion, pct: Math.round($updateProgress * 100) })}`
          : $updateStatus === 'uptodate'
            ? `Bonk ${appVersion} · ${$t('settings.update.uptodate')}`
            : $updateStatus === 'error'
              ? `Bonk ${appVersion} · ${$t('settings.update.error')}`
              : `Bonk ${appVersion} · ${$t('settings.update.startup')}`,
  );
</script>

<div class="st-group">{$t('settings.general.app')}</div>
<div class="st-card">
  {#snippet lang()}{@render select(
      $t('settings.general.language'),
      $uiLanguage,
      [
        { label: 'Русский', value: 'ru' },
        { label: 'English', value: 'en' },
      ],
      (v) => uiLanguage.set(v as UiLanguage),
    )}{/snippet}
  {@render row($t('settings.general.language'), '', lang)}
  {#snippet start()}{@render select(
      $t('settings.general.startup'),
      $startupOpen,
      [
        { label: $t('settings.general.startup.last'), value: 'last' },
        { label: $t('settings.general.startup.empty'), value: 'empty' },
      ],
      (v) => startupOpen.set(v as 'last' | 'empty'),
    )}{/snippet}
  {@render row($t('settings.general.startup'), '', start)}
  <div class="st-row">
    <div class="st-copy">
      <span class="st-name">{$t('settings.general.updates')}</span><span class="st-desc" class:st-ok={ready}
        >{updateNote}</span
      >
    </div>
    {#if ready}
      <div class="st-upd">
        <button type="button" class="st-upd-link" onclick={openReleaseNotes}>{$t('update.whatsNew')}</button>
        <button type="button" class="st-upd-restart" disabled={$updateStatus === 'installing'} onclick={installUpdate}>
          <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>{$updateStatus === 'installing'
            ? $t('update.restarting')
            : $t('update.restart')}
        </button>
      </div>
    {/if}
    {@render sw($t('settings.general.updates'), $autoUpdateCheck, (v) => autoUpdateCheck.set(v))}
  </div>
</div>

<div class="st-group">{$t('settings.general.tabs')}</div>
<div class="st-card">
  {#snippet nt()}{@render sw($t('settings.general.newTab'), $openInNewTab, (v) => openInNewTab.set(v))}{/snippet}
  {@render row($t('settings.general.newTab'), $t('settings.general.newTab.desc'), nt)}
  {#snippet cc()}{@render sw($t('settings.general.confirmClose'), $confirmCloseUnsaved, (v) =>
      confirmCloseUnsaved.set(v),
    )}{/snippet}
  {@render row($t('settings.general.confirmClose'), '', cc)}
</div>

<div class="st-group">{$t('settings.general.workspace')}</div>
<SettingsWorkspace />
