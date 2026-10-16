// Window-level keyboard: Escape for menus / expanded mode, ⌘Z for the toast's undo, ⌥⌘2…9 for
// recent workspaces, and every rebindable command (Settings → Hotkeys) routed to its action.
import { tabs } from '$entities/tab';
import { addFolder, openWorkspaceFolder, switchWorkspace, workspace } from '$entities/workspace';
import { closeAllTabs, newTab, reopenClosedTab, requestCloseTab } from '$features/tabs';
import { commandFor, eventToBinding, hotkeys, zoomBy } from '$shared/settings';
import { expandTarget, focusMode, nextTabIndex, recentWorkspaceChoices } from '$shared/ui';
import {
  newFolderHere,
  newRequestHere,
  openSaveDialog,
  smartSave,
  toggleCodePanel,
  toggleIssuesFull,
  toggleUtilityPanel,
} from './actions';
import { layout } from './layout.svelte';
import { shell } from './shell.svelte';

export function globalKeydown(e: KeyboardEvent): void {
  const active = tabs.active;
  if (e.key === 'Escape') {
    const trigger = shell.menu.kind
      ? shell.menuTrigger
      : document.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]');
    if (!trigger && !shell.menu.kind) {
      // Esc leaves expanded mode; CodeMirror's own Esc (find panel, completion) prevents default first.
      if (focusMode.current && !e.defaultPrevented && !document.querySelector('.bs-modal, .bs-overlay')) {
        e.preventDefault();
        focusMode.current = null;
      }
      return;
    }
    e.preventDefault();
    shell.closeMenu();
    shell.httpMethodOpen = shell.grpcMethodOpen = shell.workspaceMenuOpen = false;
    trigger?.focus();
    return;
  }
  if (
    shell.toast?.undo &&
    (e.metaKey || e.ctrlKey) &&
    e.code === 'KeyZ' &&
    !e.shiftKey &&
    !(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable], .cm-editor'))
  ) {
    e.preventDefault();
    shell.undoToast();
    return;
  }
  // ⌥⌘2…⌥⌘9: jump to the n-th recent workspace from the switcher (S37).
  const recentKey = /^Mod\+Alt\+([2-9])$/.exec(eventToBinding(e) ?? '');
  const recentPath = recentKey && recentWorkspaceChoices(workspace.recent, workspace.path)[Number(recentKey[1]) - 2];
  if (recentPath) {
    e.preventDefault();
    shell.workspaceMenuOpen = false;
    void switchWorkspace(recentPath);
    return;
  }
  const id = commandFor(e, hotkeys.current);
  if (!id) return;
  if (
    id === 'send' &&
    !(
      (active?.protocol === 'http' || active?.protocol === 'grpc') &&
      !(e.target instanceof Element && e.target.closest('.bs-modal'))
    )
  )
    return;
  e.preventDefault();
  switch (id) {
    case 'send':
      (document.querySelector('.bs-send') as HTMLButtonElement | null)?.click();
      break;
    case 'save':
      void smartSave();
      break;
    case 'saveAs':
      if (active?.protocol === 'http' || active?.protocol === 'grpc') openSaveDialog(true);
      break;
    case 'codePanel':
      toggleCodePanel();
      break;
    case 'newRequest':
      newRequestHere('http');
      break;
    case 'newGrpc':
      newRequestHere('grpc');
      break;
    case 'newCollection':
      void addFolder();
      break;
    case 'newFolder':
      newFolderHere();
      break;
    case 'palette':
      shell.paletteOpen = !shell.paletteOpen;
      break;
    case 'env':
      document.querySelector<HTMLButtonElement>('.bs-toolbar-env-button')?.click();
      break;
    case 'sidebar':
    case 'sidebarAlt':
      layout.toggleSidebar();
      break;
    case 'showCollections':
      layout.showSidebar('collections');
      break;
    case 'showHistory':
      layout.showSidebar('history');
      break;
    case 'utilityPanel':
      toggleUtilityPanel();
      break;
    case 'terminal':
      toggleUtilityPanel('terminal');
      break;
    case 'issues':
      toggleUtilityPanel('issues');
      break;
    case 'issuesFull':
      toggleIssuesFull();
      break;
    case 'workspaceMenu':
      shell.workspaceMenuOpen = !shell.workspaceMenuOpen;
      break;
    case 'openFolder':
      void openWorkspaceFolder();
      break;
    case 'settings':
      shell.settingsOpen = true;
      break;
    case 'zoomIn':
      zoomBy(0.1);
      break;
    case 'zoomOut':
      zoomBy(-0.1);
      break;
    case 'zoomReset':
      zoomBy(0);
      break;
    case 'closeTab':
      void requestCloseTab(tabs.activeId);
      break;
    case 'closeAllTabs':
      void closeAllTabs();
      break;
    case 'newTab':
      newTab();
      break;
    case 'reopenTab':
      reopenClosedTab();
      break;
    case 'expand':
      if (layout.requestTab)
        focusMode.current = expandTarget(focusMode.current, !!document.activeElement?.closest('.bs-resp-host'));
      break;
    case 'toggleResponse':
      if (layout.sideBySide) break;
      if (layout.respStrip) layout.showResponse();
      else {
        focusMode.current = null;
        layout.responseHidden = true;
        layout.requestHidden = false;
      }
      break;
    case 'toggleRequest':
      if (layout.sideBySide) break;
      if (layout.reqStrip || focusMode.current === 'response') layout.showRequest();
      else {
        focusMode.current = null;
        layout.requestHidden = true;
        layout.responseHidden = false;
      }
      break;
    case 'nextTab':
    case 'prevTab': {
      const i = tabs.list.findIndex((t) => t.id === tabs.activeId);
      const next = i < 0 ? undefined : nextTabIndex(id === 'prevTab' ? 'ArrowLeft' : 'ArrowRight', i, tabs.list.length);
      if (next !== undefined) tabs.activeId = tabs.list[next].id;
      break;
    }
  }
}
