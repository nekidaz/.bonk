<!--
  The top bar of the window (also the drag area of the native title bar): workspace menu, search
  (opens the ⌘K palette), environment picker, update pill, settings button.
-->
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

<style>
  /* Its font comes from the global `:root .bs kbd`, which always won here. */
  .bs-toolbar-search :global(kbd) {
    flex-shrink: 0;
    margin-left: auto;
  }

  .bs-ti :global(svg) {
    width: 17px;
    height: 17px;
  }

  :global(.dark) .bs-tb {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055);
  }

  .bs-ti:active {
    transform: scale(0.94);
  }

  .bs-tb::before {
    display: none;
  }

  .bs-tb {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }

  .bs-toolbar-search-input::placeholder {
    color: var(--t2);
  }

  /* Header · 54px: workspace · search · environment + settings */
  .bs-tb {
    flex-shrink: 0;
    position: relative;
    z-index: 85;
    backdrop-filter: none;
    height: 54px;
    padding: 0 4px 0 10px;
    display: grid;
    grid-template-columns: minmax(160px, 1fr) minmax(220px, 360px) minmax(160px, 1fr);
    gap: 16px;
    align-items: center;
    background: transparent;
    border: 0;
  }

  .bs-tb-left {
    justify-self: start;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .bs-tb-right {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    justify-content: flex-end;
  }

  .bs-toolbar-search :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  .bs-toolbar-search:focus-within {
    border-color: var(--color-border);
    box-shadow: var(--focus-ring);
  }

  .bs-toolbar-search:hover {
    border-color: var(--color-border);
  }

  /* WebKit centres button content; the design reads left to right with ⌘K pushed to the end. */
  .bs-toolbar-search {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 34px;
    padding: 0 14px;
    gap: 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    box-shadow: none;
    color: var(--color-text-muted);
    justify-content: flex-start;
    text-align: left;
  }

  .bs-toolbar-search-input {
    min-width: 0;
    width: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    outline: none;
    font: inherit;
    flex: 1;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    text-align: left;
  }

  .bs-toolbar-search :global(kbd) {
    color: var(--color-text-muted);
    opacity: 1;
  }

  .bs-ti {
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 120ms ease,
      color 120ms ease,
      transform 90ms ease;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--color-panel);
    color: var(--color-text-secondary);
  }

  .bs-ti:hover {
    background: var(--color-raised);
    color: var(--color-text);
  }

  .bs-ti :global(.material-symbols-outlined) {
    font-size: 18px;
  }

  :global(:root[data-density='compact']) .bs-tb {
    height: 42px;
  }

  :global(:root[data-density='compact']) .bs-toolbar-search {
    height: 28px;
  }

  :global(:root[data-density='compact']) .bs-ti {
    width: 28px;
    height: 28px;
  }

  .bs-toolbar-search :global(.short) {
    display: none;
  }

  @media (max-width: 1100px) {
    .bs-tb {
      grid-template-columns: minmax(120px, 1fr) minmax(180px, 360px) minmax(80px, 1fr);
      gap: 12px;
    }
  }

  @media (max-width: 900px) {
    .bs-tb {
      grid-template-columns: minmax(0, 1fr) 150px minmax(0, 1fr);
    }

    /* Only the avatar; the full name stays in the chip's tooltip. */
    .bs-toolbar-search .bs-toolbar-search-input {
      display: none;
    }

    .bs-toolbar-search :global(.short) {
      display: block;
    }
  }

  @media (max-width: 760px) {
    .bs-tb {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    }

    .bs-toolbar-search :global(.short) {
      display: none;
    }
  }

  /* Native macOS traffic lights overlay the header's left edge: start 14px after them (the mock's gap).
     --traffic-lights-right is their measured right edge (src/main.ts); without it (browser, tests) the
     62px fallback keeps the old 66px inset.
     The 10px is .bs-tb's own left padding. */
  :global(html[data-native-macos='true']) .bs-tb-left {
    padding-left: calc(var(--traffic-lights-right, 62px) + 14px - 10px);
  }

  /* S33–S35: resize grip + width tooltip; the hidden sidebar's pull-to-open grip. */
  :global(.bs) .bs-tb-left {
    gap: 14px;
  }
</style>
