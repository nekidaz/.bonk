<script lang="ts">
  import { uiLanguage, type UiLanguage, t } from '$shared/i18n';
  import { startupOpen, autoUpdateCheck, openInNewTab, confirmCloseUnsaved } from '$shared/settings';
  import { installUpdate, openReleaseNotes, updater } from '$shared/updater';
  import SettingsWorkspace from './SettingsWorkspace.svelte';
  import { row, sw, select } from './ui.svelte';

  let { appVersion }: { appVersion: string } = $props();

  const ready = $derived(updater.status === 'ready' || updater.status === 'installing');
  const updateNote = $derived(
    ready
      ? t('settings.update.ready', { cur: updater.currentVersion || appVersion, v: updater.version })
      : updater.status === 'checking'
        ? `Bonk ${appVersion} · ${t('settings.update.checking')}`
        : updater.status === 'downloading'
          ? `Bonk ${appVersion} · ${t('settings.update.downloading', { v: updater.version, pct: Math.round(updater.progress * 100) })}`
          : updater.status === 'uptodate'
            ? `Bonk ${appVersion} · ${t('settings.update.uptodate')}`
            : updater.status === 'error'
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
        <button type="button" class="st-upd-restart" disabled={updater.status === 'installing'} onclick={installUpdate}>
          <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>{updater.status === 'installing'
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
