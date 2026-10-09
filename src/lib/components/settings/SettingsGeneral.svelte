<script lang="ts">
  import { uiLanguage, startupOpen, autoUpdateCheck, openInNewTab, confirmCloseUnsaved, type UiLanguage } from '../../stores';
  import { t } from '../../i18n';
  import { updateStatus } from '../../updater';
  import SettingsWorkspace from './SettingsWorkspace.svelte';
  import { row, sw, select } from './ui.svelte';

  let { appVersion }: { appVersion: string } = $props();

  const updateNote = $derived(
    $updateStatus === 'checking' ? $t('settings.update.checking')
    : $updateStatus === 'available' ? $t('settings.update.available')
    : $updateStatus === 'uptodate' ? $t('settings.update.uptodate')
    : $updateStatus === 'error' ? $t('settings.update.error')
    : $t('settings.update.startup'),
  );
</script>

<div class="st-group">{$t('settings.general.app')}</div>
<div class="st-card">
  {#snippet lang()}{@render select($t('settings.general.language'), $uiLanguage, [{ label: 'Русский', value: 'ru' }, { label: 'English', value: 'en' }], (v) => uiLanguage.set(v as UiLanguage))}{/snippet}
  {@render row($t('settings.general.language'), '', lang)}
  {#snippet start()}{@render select($t('settings.general.startup'), $startupOpen, [{ label: $t('settings.general.startup.last'), value: 'last' }, { label: $t('settings.general.startup.empty'), value: 'empty' }], (v) => startupOpen.set(v as 'last' | 'empty'))}{/snippet}
  {@render row($t('settings.general.startup'), '', start)}
  {#snippet upd()}{@render sw($t('settings.general.updates'), $autoUpdateCheck, (v) => autoUpdateCheck.set(v))}{/snippet}
  {@render row($t('settings.general.updates'), `Bonk ${appVersion} · ${updateNote}`, upd)}
</div>

<div class="st-group">{$t('settings.general.tabs')}</div>
<div class="st-card">
  {#snippet nt()}{@render sw($t('settings.general.newTab'), $openInNewTab, (v) => openInNewTab.set(v))}{/snippet}
  {@render row($t('settings.general.newTab'), $t('settings.general.newTab.desc'), nt)}
  {#snippet cc()}{@render sw($t('settings.general.confirmClose'), $confirmCloseUnsaved, (v) => confirmCloseUnsaved.set(v))}{/snippet}
  {@render row($t('settings.general.confirmClose'), '', cc)}
</div>

<div class="st-group">{$t('settings.general.workspace')}</div>
<SettingsWorkspace />
