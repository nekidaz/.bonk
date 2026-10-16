// What the shell's menus, buttons and shortcuts do: tree-node and tab actions, saving, importing.
// Plain functions over `shell` / `layout` state and the entities (no state of their own).
import { tick } from 'svelte';
import { tabs } from '$entities/tab';
import {
  addFolder,
  duplicateNode,
  exportOpenApiFolder,
  findNode,
  importWindow,
  parentId,
  removeNode,
  renameNode,
  revealNode,
  withInheritedAuth,
  workspace,
} from '$entities/workspace';
import {
  addRequestToFolder,
  applyCurlToActiveTab,
  openSavedRequest,
  requestSaveDialog,
  restoreSavedRequest,
  saveActiveRequest,
} from '$entities/request';
import { currentVarScope } from '$entities/environment';
import { duplicateTab, newTab, setActiveProtocol } from '$features/tabs';
import { t, tp } from '$shared/i18n';
import type { ImportResult } from '$features/import';
import { methodColor, toCurl, type RequestProtocol } from '$shared/model';
import { terminalOpen } from '$shared/ipc';
import { requestConfirm, type UtilityMode } from '$shared/ui';
import { utilityUi } from '$features/utility-panel';
import { saveSettingsDraft } from '$features/settings';
import { layout } from './layout.svelte';
import { shell } from './shell.svelte';

// ---- Tree node actions (operate on shell.menu.nodeId when present) ----

export function collAddFolder(): void {
  if (shell.menu.nodeId) void addFolder(shell.menu.nodeId);
  else void addFolder();
  shell.closeMenu();
}
export function nodeRename(): void {
  const n = shell.menu.nodeId ? findNode(workspace.tree, shell.menu.nodeId) : undefined;
  if (!n || !shell.menu.nodeId) {
    shell.closeMenu();
    return;
  }
  shell.editingNodeId = shell.menu.nodeId;
  shell.editValue = n.name;
  shell.closeMenu();
}
export function commitInlineRename(): void {
  const v = shell.editValue.trim();
  const id = shell.editingNodeId;
  shell.editingNodeId = undefined;
  if (v && id) void renameNode(id, v);
}
export function inlineRenameKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitInlineRename();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    shell.editingNodeId = undefined;
  }
}
export async function nodeDelete(): Promise<void> {
  const id = shell.menu.nodeId;
  const isFolder = shell.menu.isFolder;
  shell.closeMenu();
  if (!id) return;
  const name = findNode(workspace.tree, id)?.name ?? t('app.node.thisItem');
  const msg = isFolder ? t('app.node.deleteFolder', { name }) : t('app.node.deleteItem', { name });
  if (await requestConfirm(msg, t('common.delete'))) await removeNode(id);
}
export function nodeSaveHere(): void {
  if (shell.menu.nodeId) void saveActiveRequest(shell.menu.nodeId);
  shell.closeMenu();
}
export function nodeDuplicate(): void {
  if (shell.menu.nodeId) void duplicateNode(shell.menu.nodeId);
  shell.closeMenu();
}
export function nodeAuth(): void {
  shell.authFolderId = shell.menu.nodeId;
  shell.closeMenu();
}
export function nodeMove(): void {
  shell.moveSourceId = shell.menu.nodeId;
  shell.moveOpen = true;
  shell.closeMenu();
}
export function addReq(p: RequestProtocol): void {
  void addRequestToFolder(shell.menu.nodeId, p);
  shell.closeMenu();
}
export function nodeOpen(): void {
  const n = shell.menu.nodeId ? findNode(workspace.tree, shell.menu.nodeId) : undefined;
  shell.closeMenu();
  if (n?.kind === 'request') openSavedRequest(n);
}
export function nodeCopyCurl(): void {
  const n = shell.menu.nodeId ? findNode(workspace.tree, shell.menu.nodeId) : undefined;
  shell.closeMenu();
  if (n?.kind !== 'request') return;
  const tab = { id: n.id, protocol: 'http' as const, title: n.name, request: n.request, params: n.params };
  void navigator.clipboard.writeText(toCurl(withInheritedAuth(tab, n.id), currentVarScope(true)));
}
export function exportOpenApi(format: 'json' | 'yaml'): void {
  const id = shell.menu.nodeId;
  shell.closeMenu();
  if (id) void exportOpenApiFolder(id, format);
}
/** Run a tree action against `id` (keyboard shortcuts on a focused row reuse the menu handlers). */
function nodeAction(id: string, isFolder: boolean, run: () => void): void {
  shell.menu = { kind: null, x: 0, y: 0, nodeId: id, isFolder };
  run();
}
export function treeKeydown(e: KeyboardEvent, id: string, isFolder: boolean): void {
  const mod = e.metaKey || e.ctrlKey;
  const act =
    e.key === 'F2'
      ? nodeRename
      : mod && e.key.toLowerCase() === 'd'
        ? nodeDuplicate
        : (e.key === 'Backspace' || e.key === 'Delete') && !isFolder
          ? nodeDelete
          : mod && e.altKey && e.code === 'KeyC' && !isFolder
            ? nodeCopyCurl
            : mod && e.key === 'Enter' && !isFolder
              ? nodeOpen
              : undefined;
  if (!act) return;
  e.preventDefault();
  e.stopPropagation();
  nodeAction(id, isFolder, act);
}

// ---- New requests, import ----

export function newRequestHere(kind: RequestProtocol = 'http'): void {
  if (shell.activeFolderId) void addRequestToFolder(shell.activeFolderId, kind);
  else newTab(kind);
}
export function newFolderHere(): void {
  void addFolder(shell.activeFolderId);
}
// One import window for every format (IM1): the format is sniffed from the content, not the menu item.
export function importOpenApi(): void {
  shell.closeMenu();
  importWindow.open();
}
export const importFrom = (): void => importOpenApi();
// «Обновить из спецификации» on a collection made by import (IM8).
export function updateFromSpec(folderId: string): void {
  shell.closeMenu();
  importWindow.open({ update: folderId });
}
// IM7: the toast with the result; «Открыть» opens the first imported request.
export function importDone(r: ImportResult): void {
  const env = r.envs.created.length ? ` · ${t('import.done.env', { names: r.envs.created.join(', ') })}` : '';
  const first = r.first;
  shell.showToast({
    text: `${t('import.done', { n: `${r.requests} ${tp(r.requests, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])}`, name: r.name })}${env}`,
    ...(first ? { action: { label: t('import.done.open'), run: () => openSavedRequest(first) } } : {}),
  });
}
export function importUpdated(name: string, n: number): void {
  shell.showToast({
    text: t('import.done.upd', {
      n: `${n} ${tp(n, ['запрос', 'запроса', 'запросов'], ['request', 'requests'])}`,
      name,
    }),
  });
}
// cURL import = paste into the URL bar of a fresh request (HttpUrlBar turns `curl …` into a request).
export async function pasteCurl(): Promise<void> {
  newTab();
  await tick();
  document.querySelector<HTMLElement>('.bs-urlfield .cm-content')?.focus();
}
// Clipboard cURL → a fresh request; without clipboard access, focus the URL bar for a manual paste.
export async function importCurlFromClipboard(): Promise<void> {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* no clipboard permission */
  }
  if (/^\s*curl\s/i.test(text)) {
    newTab();
    applyCurlToActiveTab(text);
  } else await pasteCurl();
}

// ---- Tab actions (request header ⋯ menu: node actions run against the active tab's saved request) ----

export function tabRename(): void {
  shell.closeMenu();
  void tick().then(() => document.querySelector<HTMLElement>('.bs-reqhead .nm.rename')?.click());
}
/** cURL of the tab as it is now (unsaved edits included), unlike the tree action that copies the file. */
export function tabCopyCurl(): void {
  shell.closeMenu();
  const active = tabs.active;
  if (active?.protocol !== 'http') return;
  void navigator.clipboard.writeText(toCurl(withInheritedAuth(active, active.savedPath), currentVarScope(true)));
}
// S17b: a right-click makes the tab active, so the menu's request actions reuse the active-tab handlers.
export function tabContext(e: MouseEvent, id: string): void {
  e.preventDefault();
  e.stopPropagation();
  tabs.activeId = id;
  shell.openMenu('tab', e, id);
}
export function tabKeydown(e: KeyboardEvent, id: string): void {
  const mod = e.metaKey || e.ctrlKey;
  const act =
    e.key === 'F2'
      ? tabRename
      : mod && e.altKey && e.code === 'KeyC'
        ? tabCopyCurl
        : mod && !e.altKey && e.code === 'KeyD'
          ? () => duplicateTab(id)
          : undefined;
  if (!act) return;
  e.preventDefault();
  e.stopPropagation();
  tabs.activeId = id;
  act();
}
export function tabReveal(): void {
  shell.closeMenu();
  const id = tabs.active?.savedPath;
  if (!id) return;
  layout.showSidebar('collections');
  revealNode(id);
  void tick().then(() => document.querySelector<HTMLElement>('.bs-tree .bs-trow.sel')?.focus());
}
export function switchTo(kind: RequestProtocol): void {
  shell.closeMenu();
  const prev = setActiveProtocol(kind);
  if (!prev) return;
  const name = (p: RequestProtocol) => (p === 'grpc' ? 'gRPC' : 'HTTP');
  shell.showToast({
    text: t('app.toast.protocol', { kind: name(kind) }),
    undo: () => tabs.update((list) => list.map((x) => (x.id === prev.id ? prev : x))),
    undoLabel: t('app.toast.protocolUndo', { kind: name(prev.protocol as RequestProtocol) }),
    icon: 'swap_horiz',
    iconColor: methodColor(kind === 'grpc' ? 'GRPC' : 'GET'),
  });
}

// ---- Saving ----

/** Save-to dialog (SaveRequestDialog flashes the Save button itself); `copy` = Save As. */
export function openSaveDialog(copy = false): void {
  void requestSaveDialog(copy);
}

/**
 * Smart save: if the active tab is already backed by a collection file
 * (`savedPath` set), overwrite it in place — no modal. If it's a new,
 * unsaved request, open the destination picker so the user chooses where
 * it lands. Bound to the Save button and ⌘/Ctrl+S.
 */
export async function smartSave(): Promise<void> {
  const active = tabs.active;
  if (active?.protocol === 'settings') {
    try {
      await saveSettingsDraft();
    } catch (e) {
      shell.showToast({ text: String(e), icon: 'error', iconColor: 'var(--color-danger)' });
    }
    return;
  }
  if (!active || (active.protocol !== 'http' && active.protocol !== 'grpc')) return;
  if (active.savedPath) {
    const prev = findNode(workspace.tree, active.savedPath);
    const folder = parentId(active.savedPath);
    try {
      await saveActiveRequest(folder, active.title);
      shell.flashSaved();
      shell.showToast({
        text: t('app.toast.savedIn', {
          where:
            (folder && findNode(workspace.tree, folder)?.name) ||
            (workspace.path.split('/').filter(Boolean).at(-1) ?? t('app.toast.workspace')),
        }),
        undo: prev?.kind === 'request' ? () => void restoreSavedRequest(prev) : undefined,
      });
    } catch (err) {
      console.error('workspace: smartSave failed', err);
    }
  } else {
    openSaveDialog();
  }
}

// ---- Panels ----

export function toggleCodePanel(): void {
  const active = tabs.active;
  if (!shell.codePanelAvailable || !active) return;
  shell.codePanelTabId = shell.codeOpen ? undefined : active.id;
}

let lastUtilityMode: UtilityMode = 'console';

/** Open the panel on `mode`, or close it if it's showing that tab. No `mode` (⌘J): toggle on the last tab. */
export function toggleUtilityPanel(mode?: UtilityMode): void {
  const current = shell.utilityMode;
  if (current) lastUtilityMode = current;
  shell.utilityMode = current && (!mode || current === mode) ? null : (mode ?? lastUtilityMode);
  if (shell.utilityMode) queueMicrotask(layout.clampResponseToViewport);
  else utilityUi.expanded = false;
}

/** The user's own terminal app in the workspace folder; with `command`, runs it there (CT6). */
export function openTerminal(command?: string, env?: Record<string, string>): void {
  terminalOpen(workspace.path || null, command, env).catch((error) =>
    shell.showToast({ text: String(error), icon: 'error', iconColor: 'var(--red)' }),
  );
}

/** ⇧⌘J: Issues on the whole height, and back (CT12). */
export function toggleIssuesFull(): void {
  const full = shell.utilityMode === 'issues' && utilityUi.expanded;
  shell.utilityMode = 'issues';
  utilityUi.expanded = !full;
}
