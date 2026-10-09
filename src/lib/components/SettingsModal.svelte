<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { workspacePath } from '../stores';
  import { updateStatus } from '../updater';
  import { t } from '../i18n';
  import '../../styles/settings.css';
  import SettingsGeneral from './settings/SettingsGeneral.svelte';
  import SettingsRequests from './settings/SettingsRequests.svelte';
  import SettingsProxy from './settings/SettingsProxy.svelte';
  import SettingsCerts from './settings/SettingsCerts.svelte';
  import SettingsGrpc from './settings/SettingsGrpc.svelte';
  import SettingsAppearance from './settings/SettingsAppearance.svelte';
  import SettingsHotkeys from './settings/SettingsHotkeys.svelte';
  import SettingsData from './settings/SettingsData.svelte';
  import SettingsMcp from './settings/SettingsMcp.svelte';

  // Two-way bound from the parent (App.svelte holds the source of truth).
  let { open = $bindable() }: { open: boolean } = $props();

  // From the running Tauri app (tauri.conf.json); blank in browser-only previews.
  let appVersion = $state('');
  onMount(async () => {
    try {
      appVersion = await getVersion();
    } catch {
      // getVersion is unavailable outside the Tauri runtime.
    }
  });

  // S32–S32.7: one component per section; the sheet is only nav + header.
  type Page = { id: string; label: string; icon: string; sub: string; view?: Component };
  const PAGES: Page[] = [
    { id: 'general', label: 'settings.page.general', icon: 'tune', sub: 'settings.page.general.sub' },
    { id: 'requests', label: 'settings.page.requests', icon: 'send', sub: 'settings.page.requests.sub', view: SettingsRequests },
    { id: 'proxy', label: 'settings.page.proxy', icon: 'lan', sub: 'settings.page.proxy.sub', view: SettingsProxy },
    { id: 'certs', label: 'settings.page.certs', icon: 'shield', sub: 'settings.page.certs.sub', view: SettingsCerts },
    { id: 'grpc', label: 'settings.page.grpc', icon: 'hub', sub: 'settings.page.grpc.sub', view: SettingsGrpc },
    { id: 'appearance', label: 'settings.page.appearance', icon: 'contrast', sub: 'settings.page.appearance.sub', view: SettingsAppearance },
    { id: 'hotkeys', label: 'settings.page.hotkeys', icon: 'keyboard', sub: 'settings.page.hotkeys.sub', view: SettingsHotkeys },
    { id: 'data', label: 'settings.page.data', icon: 'database', sub: 'settings.page.data.sub', view: SettingsData },
    { id: 'mcp', label: 'settings.page.mcp', icon: 'smart_toy', sub: 'settings.page.mcp.sub', view: SettingsMcp },
  ];
  let pageId = $state('general');
  const page = $derived(PAGES.find((p) => p.id === pageId) ?? PAGES[0]);

  function close(): void {
    open = false;
  }

  // Escape closes, unless a section is capturing keys (hotkey recorder) and stopped it.
  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }

  // Focus goes back to whatever opened the sheet.
  let opener: HTMLElement | null = null;
  $effect(() => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (opener) {
      opener.focus();
      opener = null;
    }
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="bs-overlay st-overlay" role="dialog" aria-modal="true" aria-label={$t('settings.title')}>
    <div class="st-sheet">
      <nav class="st-nav" aria-label={$t('settings.sections')}>
        <div class="st-kicker">{$t('settings.kicker')}</div>
        <div class="st-ws" title={$workspacePath}>{$workspacePath.split('/').filter(Boolean).at(-1) ?? 'Local Workspace'}</div>
        <ul>
          {#each PAGES as p (p.id)}
            <li>
              <button type="button" class="st-item" class:on={pageId === p.id} aria-current={pageId === p.id ? 'page' : undefined} onclick={() => (pageId = p.id)}>
                <span class="material-symbols-outlined" style="font-size:16px" aria-hidden="true">{p.icon}</span>
                <span>{$t(p.label)}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="st-ver">
          Bonk {appVersion}{#if $updateStatus === 'uptodate'} · {$t('settings.update.uptodate')}{:else if $updateStatus === 'available'} · {$t('settings.update.available')}{:else if $updateStatus === 'checking'} · {$t('settings.update.checking')}{:else if $updateStatus === 'error'} · {$t('settings.update.error')}{/if}
        </div>
      </nav>

      <div class="st-main">
        <header class="st-head">
          <div>
            <h2>{$t(page.label)}</h2>
            <p>{$t(page.sub)}</p>
          </div>
          <button type="button" class="st-x" aria-label={$t('common.close')} onclick={close}>
            <span class="material-symbols-outlined" style="font-size:18px" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="st-body">
          {#if page.view}<page.view />{:else}<SettingsGeneral {appVersion} />{/if}
        </div>
      </div>
    </div>
  </div>
{/if}
