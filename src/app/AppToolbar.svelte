<script lang="ts">
  import { WorkspaceMenu } from '$features/workspace-menu/components';
  import { EnvironmentSelector } from '$entities/environment/components';
  import { UpdatePill } from '$features/updater/components';
  import { t } from '$shared/i18n';
  let {
    workspaceMenuOpen = $bindable(),
    onSearch,
    onSettings,
  }: {
    workspaceMenuOpen: boolean;
    onSearch: () => void;
    onSettings: () => void;
  } = $props();
</script>

<div class="bs-tb" data-tauri-drag-region>
  <div class="bs-tb-left">
    <WorkspaceMenu bind:open={workspaceMenuOpen} {onSettings} />
  </div>
  <button class="bs-toolbar-search" type="button" aria-label={t('nav.toolbar.searchAria')} onclick={onSearch}>
    <span class="material-symbols-outlined" aria-hidden="true">search</span>
    <span class="bs-toolbar-search-input">{t('nav.toolbar.search')}</span>
    <span class="bs-toolbar-search-input short">{t('nav.toolbar.searchShort')}</span>
    <kbd>⌘K</kbd>
  </button>
  <div class="bs-tb-right">
    <EnvironmentSelector />
    <UpdatePill />
    <button class="bs-ti" title={t('nav.toolbar.settings')} aria-label={t('nav.toolbar.settings')} onclick={onSettings}
      ><span class="material-symbols-outlined">settings</span></button
    >
  </div>
</div>
