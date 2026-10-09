<script lang="ts">
  import { uiLanguage, type UiLanguage, t } from '$shared/i18n';
  import { startupOpen, autoUpdateCheck, openInNewTab, confirmCloseUnsaved } from '$shared/settings';
  import {
    updateStatus,
    updateVersion,
    updateCurrent,
    updateProgress,
    installUpdate,
    openReleaseNotes,
  } from '$shared/updater';
  import SettingsWorkspace from './SettingsWorkspace.svelte';
  import { row, sw, select } from './ui.svelte';

  let { appVersion }: { appVersion: string } = $props();

  const ready = $derived($updateStatus === 'ready' || $updateStatus === 'installing');
  const updateNote = $derived(
    ready
      ? t('settings.update.ready', { cur: $updateCurrent || appVersion, v: $updateVersion })
      : $updateStatus === 'checking'
        ? `Bonk ${appVersion} · ${t('settings.update.checking')}`
        : $updateStatus === 'downloading'
          ? `Bonk ${appVersion} · ${t('settings.update.downloading', { v: $updateVersion, pct: Math.round($updateProgress * 100) })}`
          : $updateStatus === 'uptodate'
            ? `Bonk ${appVersion} · ${t('settings.update.uptodate')}`
            : $updateStatus === 'error'
              ? `Bonk ${appVersion} · ${t('settings.update.error')}`
              : `Bonk ${appVersion} · ${t('settings.update.startup')}`,
  );
</script>

<div class="st-group">{t('settings.general.app')}</div>
<div class="st-card">
  {#snippet lang()}{@render select(
      t('settings.general.language'),
      uiLanguage.current,
      [
        { label: 'Русский', value: 'ru' },
        { label: 'English', value: 'en' },
      ],
      (v) => (uiLanguage.current = v as UiLanguage),
    )}{/snippet}
  {@render row(t('settings.general.language'), '', lang)}
  {#snippet start()}{@render select(
      t('settings.general.startup'),
      startupOpen.current,
      [
        { label: t('settings.general.startup.last'), value: 'last' },
        { label: t('settings.general.startup.empty'), value: 'empty' },
      ],
      (v) => (startupOpen.current = v as 'last' | 'empty'),
    )}{/snippet}
  {@render row(t('settings.general.startup'), '', start)}
  <div class="st-row">
    <div class="st-copy">
      <span class="st-name">{t('settings.general.updates')}</span><span class="st-desc" class:st-ok={ready}
        >{updateNote}</span
      >
    </div>
    {#if ready}
      <div class="st-upd">
        <button type="button" class="st-upd-link" onclick={openReleaseNotes}>{t('update.whatsNew')}</button>
        <button type="button" class="st-upd-restart" disabled={$updateStatus === 'installing'} onclick={installUpdate}>
          <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>{$updateStatus === 'installing'
            ? t('update.restarting')
            : t('update.restart')}
        </button>
      </div>
    {/if}
    {@render sw(t('settings.general.updates'), autoUpdateCheck.current, (v) => (autoUpdateCheck.current = v))}
  </div>
</div>

<div class="st-group">{t('settings.general.tabs')}</div>
<div class="st-card">
  {#snippet nt()}{@render sw(
      t('settings.general.newTab'),
      openInNewTab.current,
      (v) => (openInNewTab.current = v),
    )}{/snippet}
  {@render row(t('settings.general.newTab'), t('settings.general.newTab.desc'), nt)}
  {#snippet cc()}{@render sw(
      t('settings.general.confirmClose'),
      confirmCloseUnsaved.current,
      (v) => (confirmCloseUnsaved.current = v),
    )}{/snippet}
  {@render row(t('settings.general.confirmClose'), '', cc)}
</div>

<div class="st-group">{t('settings.general.workspace')}</div>
<SettingsWorkspace />
