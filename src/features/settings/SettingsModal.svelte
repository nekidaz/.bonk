<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { workspace } from '$entities/workspace';
  import { updater } from '$shared/updater';
  import { t } from '$shared/i18n';
  import '../../styles/settings.css';
  import SettingsGeneral from './SettingsGeneral.svelte';
  import SettingsRequests from './SettingsRequests.svelte';
  import SettingsCookies from './SettingsCookies.svelte';
  import SettingsProxy from './SettingsProxy.svelte';
  import SettingsCerts from './SettingsCerts.svelte';
  import SettingsGrpc from './SettingsGrpc.svelte';
  import SettingsAppearance from './SettingsAppearance.svelte';
  import SettingsHotkeys from './SettingsHotkeys.svelte';
  import SettingsData from './SettingsData.svelte';
  import SettingsMcp from './SettingsMcp.svelte';
  import SettingsVariables from './SettingsVariables.svelte';
  import { openSettingsFileTab } from './settingsFileTab.svelte';

  // Two-way bound from the parent (app/ `shell.settingsOpen` is the source of truth).
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
    {
      id: 'requests',
      label: 'settings.page.requests',
      icon: 'send',
      sub: 'settings.page.requests.sub',
      view: SettingsRequests,
    },
    {
      id: 'variables',
      label: 'settings.page.variables',
      icon: 'data_object',
      sub: 'settings.page.variables.sub',
      view: SettingsVariables,
    },
    {
      id: 'cookies',
      label: 'settings.page.cookies',
      icon: 'cookie',
      sub: 'settings.page.cookies.sub',
      view: SettingsCookies,
    },
    { id: 'proxy', label: 'settings.page.proxy', icon: 'lan', sub: 'settings.page.proxy.sub', view: SettingsProxy },
    { id: 'certs', label: 'settings.page.certs', icon: 'shield', sub: 'settings.page.certs.sub', view: SettingsCerts },
    { id: 'grpc', label: 'settings.page.grpc', icon: 'hub', sub: 'settings.page.grpc.sub', view: SettingsGrpc },
    { id: 'mcp', label: 'settings.page.mcp', icon: 'smart_toy', sub: 'settings.page.mcp.sub', view: SettingsMcp },
    {
      id: 'appearance',
      label: 'settings.page.appearance',
      icon: 'contrast',
      sub: 'settings.page.appearance.sub',
      view: SettingsAppearance,
    },
    {
      id: 'hotkeys',
      label: 'settings.page.hotkeys',
      icon: 'keyboard',
      sub: 'settings.page.hotkeys.sub',
      view: SettingsHotkeys,
    },
    { id: 'data', label: 'settings.page.data', icon: 'database', sub: 'settings.page.data.sub', view: SettingsData },
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
  <div class="bs-overlay st-overlay" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
    <div class="st-sheet">
      <nav class="st-nav" aria-label={t('settings.sections')}>
        <div class="st-kicker">{t('settings.kicker')}</div>
        <div class="st-ws" title={workspace.path}>
          {workspace.path.split('/').filter(Boolean).at(-1) ?? 'Local Workspace'}
        </div>
        <ul>
          {#each PAGES as p (p.id)}
            <li>
              <button
                type="button"
                class="st-item"
                class:on={pageId === p.id}
                aria-current={pageId === p.id ? 'page' : undefined}
                onclick={() => (pageId = p.id)}
              >
                <span class="material-symbols-outlined" style="font-size:16px" aria-hidden="true">{p.icon}</span>
                <span>{t(p.label)}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="st-ver">
          Bonk {appVersion}{#if updater.status === 'uptodate'}
            · {t('settings.update.uptodate')}{:else if updater.status === 'ready'}
            · {t('settings.update.available')}{:else if updater.status === 'checking'}
            · {t('settings.update.checking')}{:else if updater.status === 'error'}
            · {t('settings.update.error')}{/if}
        </div>
      </nav>

      <div class="st-main">
        <header class="st-head">
          <div>
            <h2>{t(page.label)}</h2>
            <p>{t(page.sub)}</p>
          </div>
          <div style="display:flex;gap:4px">
            <button
              type="button"
              class="st-x"
              title={t('settingsFile.open')}
              aria-label={t('settingsFile.open')}
              onclick={() => {
                close();
                openSettingsFileTab();
              }}
            >
              <span class="material-symbols-outlined" style="font-size:18px" aria-hidden="true">data_object</span>
            </button>
            <button type="button" class="st-x" aria-label={t('common.close')} onclick={close}>
              <span class="material-symbols-outlined" style="font-size:18px" aria-hidden="true">close</span>
            </button>
          </div>
        </header>
        <div class="st-body">
          {#if page.view}<page.view />{:else}<SettingsGeneral {appVersion} />{/if}
        </div>
      </div>
    </div>
  </div>
{/if}
