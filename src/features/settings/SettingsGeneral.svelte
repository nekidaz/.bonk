<script lang="ts">
  import { uiLanguage, type UiLanguage, t } from '$shared/i18n';
  import { startupOpen, autoUpdateCheck, openInNewTab, confirmCloseUnsaved } from '$shared/settings';
  import { installUpdate, openReleaseNotes, updater } from '$shared/updater';
  import SettingsWorkspace from './SettingsWorkspace.svelte';
  import { row, sw, select } from './ui.svelte';
  import Row from './Row.svelte';

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
  <Row>
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
  </Row>
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

<style>
  .st-desc.st-ok {
    color: var(--green);
  }

  .st-upd {
    flex: none;
    display: flex;
    align-items: center;
    gap: 16px;
    margin-left: auto;
  }

  .st-upd .st-upd-link {
    font: 500 12px var(--font-ui);
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .st-upd .st-upd-link:hover {
    color: var(--color-text);
  }

  .st-upd .st-upd-restart {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 12px 0 10px;
    border-radius: 999px;
    background: var(--color-action);
    color: var(--color-on-action);
    font: 500 12px var(--font-ui);
    cursor: pointer;
  }

  .st-upd .st-upd-restart:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .st-upd-restart :global(.material-symbols-outlined) {
    font-size: 16px;
  }
</style>
