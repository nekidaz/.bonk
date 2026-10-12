<script lang="ts">
  // Everything that floats over the window: the popover menu, dialogs and sheets, the toast,
  // the command palette and the update banner. Which one is open lives in `shell`.
  import { tabs } from '$entities/tab';
  import { openWorkspaceFolder } from '$entities/workspace';
  import { environments, openEnvironmentsTab } from '$entities/environment';
  import { DynamicCatalog } from '$entities/environment/components';
  import { SaveRequestDialog, ProductionGuard, SessionsDialog } from '$entities/request/components';
  import { closeSessions, sessionRuntime } from '$entities/request';
  import { AskHost } from '$entities/input/components';
  import { applyPreset, openRunnerTab, runner } from '$features/runner';
  import { MoveDialog, FolderAuthDialog } from '$features/sidebar/components';
  import { SettingsModal } from '$features/settings/components';
  import { CookieJarSheet } from '$features/cookie-jar/components';
  import { cookieJar } from '$entities/cookies';
  import { ImportDialog, ImportDropZone } from '$features/import/components';
  import { UpdateBanner } from '$features/updater/components';
  import { CommandPalette, type PaletteCommand } from '$features/command-palette/components';
  import { BranchMenu, CloneDialog, StashMenu, SwitchDialog } from '$features/git/components';
  import { ConfirmDialog } from '$shared/ui/components';
  import { t } from '$shared/i18n';
  import { formatBinding, hotkeys } from '$shared/settings';
  import AppPopoverMenu from './AppPopoverMenu.svelte';
  import SendInputPrompt from './SendInputPrompt.svelte';
  import SessionSignInPrompt from './SessionSignInPrompt.svelte';
  import {
    addReq,
    collAddFolder,
    exportOpenApi,
    importCurlFromClipboard,
    importFrom,
    importDone,
    importOpenApi,
    importUpdated,
    newFolderHere,
    newRequestHere,
    nodeAuth,
    nodeCopyCurl,
    nodeDelete,
    nodeDuplicate,
    nodeMove,
    nodeRename,
    nodeSaveHere,
    openSaveDialog,
    pasteCurl,
    smartSave,
    switchTo,
    tabCopyCurl,
    tabRename,
    tabReveal,
    toggleCodePanel,
    updateFromSpec,
  } from './actions';
  import { layout } from './layout.svelte';
  import { shell } from './shell.svelte';

  const keys = (id: string): string => formatBinding(hotkeys.current[id] ?? '').join('');
  const paletteCommands: PaletteCommand[] = $derived([
    {
      label: shell.activeFolderName ? t('palette.cmd.newIn', { folder: shell.activeFolderName }) : t('palette.cmd.new'),
      icon: 'add',
      shortcut: keys('newRequest'),
      run: () => newRequestHere(),
    },
    {
      label: shell.activeFolderName
        ? t('palette.cmd.curlIn', { folder: shell.activeFolderName })
        : t('palette.cmd.curl'),
      icon: 'terminal',
      run: () => void pasteCurl(),
    },
    { label: t('palette.cmd.openapi'), icon: 'upload_file', run: importOpenApi },
    { label: t('palette.cmd.envs'), icon: 'layers', shortcut: keys('env'), run: openEnvironmentsTab },
    {
      label: t('palette.cmd.workspace'),
      icon: 'folder_managed',
      shortcut: keys('workspaceMenu'),
      run: () => (shell.workspaceMenuOpen = true),
    },
    { label: t('palette.cmd.runner'), icon: 'play_arrow', run: openRunnerTab },
    { label: t('cookies.title'), icon: 'cookie', run: () => cookieJar.open() },
    { label: t('palette.cmd.sidebar'), icon: 'left_panel_open', shortcut: keys('sidebar'), run: layout.toggleSidebar },
    {
      label: t('palette.cmd.response'),
      icon: 'bottom_panel_open',
      run: () => {
        layout.responseHidden = !layout.responseHidden;
        layout.requestHidden = false;
      },
    },
    { label: t('palette.cmd.code'), icon: 'code', shortcut: keys('codePanel'), run: () => toggleCodePanel() },
    {
      label: t('palette.cmd.folder'),
      icon: 'folder_open',
      shortcut: keys('openFolder'),
      run: () => void openWorkspaceFolder(),
    },
    {
      label: t('palette.cmd.settings'),
      icon: 'settings',
      shortcut: keys('settings'),
      run: () => (shell.settingsOpen = true),
    },
  ]);
</script>

<AppPopoverMenu
  menu={shell.menu}
  closeMenu={shell.closeMenu}
  tab={tabs.active}
  folderName={shell.activeFolderName}
  inHistory={shell.sidebarPanel === 'history'}
  onNewHere={newRequestHere}
  onNewFolderHere={newFolderHere}
  onSwitch={switchTo}
  onAddRequest={addReq}
  onAddFolder={collAddFolder}
  onSaveHere={nodeSaveHere}
  onRename={nodeRename}
  onDuplicate={nodeDuplicate}
  onMove={nodeMove}
  onAuth={nodeAuth}
  onDelete={nodeDelete}
  onCopyCurl={nodeCopyCurl}
  onImportCurl={() => void importCurlFromClipboard()}
  onImport={importFrom}
  onUpdateFromSpec={updateFromSpec}
  onExportOpenApi={exportOpenApi}
  onRenameTab={tabRename}
  onCopyCurlTab={tabCopyCurl}
  onSaveTab={() => void smartSave()}
  onSaveAsTab={() => openSaveDialog(true)}
  onRevealTab={tabReveal}
/>

<SaveRequestDialog onSaved={shell.flashSaved} />

<DynamicCatalog />
<AskHost />
<SendInputPrompt />
<SessionSignInPrompt />
<CookieJarSheet onCleared={(text) => shell.showToast({ text, icon: 'delete_sweep' })} />

<BranchMenu />
<StashMenu />
<SwitchDialog />
<CloneDialog />

<ConfirmDialog />

<ProductionGuard />

{#if sessionRuntime.dialog}
  <SessionsDialog auth={sessionRuntime.dialog.auth} where={sessionRuntime.dialog.where} onClose={closeSessions} />
{/if}

{#if shell.toast}
  <div class="bs-toast" role="status">
    <span class="material-symbols-outlined" aria-hidden="true" style:color={shell.toast.iconColor}
      >{shell.toast.icon ?? 'check_circle'}</span
    >
    <span class="text">{shell.toast.text}</span>
    {#if shell.toast.action}<button type="button" onclick={shell.toastAction}>{shell.toast.action.label}</button>{/if}
    {#if shell.toast.undo}<button type="button" onclick={shell.undoToast}
        >{shell.toast.undoLabel ?? t('app.toast.undo')} ⌘Z</button
      >{/if}
  </div>
{/if}

<CommandPalette bind:open={shell.paletteOpen} commands={paletteCommands} />

<MoveDialog bind:open={shell.moveOpen} sourceId={shell.moveSourceId ?? ''} />
<FolderAuthDialog
  bind:folderId={shell.authFolderId}
  onSaved={(text) => shell.showToast({ text })}
  onOpenRunner={(name) => {
    // Flow · Сессия: the sign-in scenario's setup, in the environment the session is kept for.
    const preset = runner.presets.find((p) => p.name === name);
    openRunnerTab();
    if (preset) applyPreset({ ...preset, envId: environments.activeId });
  }}
/>

<SettingsModal bind:open={shell.settingsOpen} />
<ImportDialog onImported={importDone} onUpdated={importUpdated} />
<ImportDropZone />
<UpdateBanner />
