import { tabs } from '$entities/tab';
import { findNode, parentId, workspace } from '$entities/workspace';
import { appMenuWidth, type AppMenuKind, type AppMenuState, type UtilityMode } from '$shared/ui';

/** S09b: confirmation toast after a save, with a one-step undo (⌘Z while it is visible).
 *  P3/P4 bring their own icon (swap_horiz in the new protocol's colour) and undo label (“Back to HTTP”). */
export type Toast = {
  text: string;
  undo?: () => void;
  undoLabel?: string;
  /** A follow-up that isn't an undo (no ⌘Z): “Open” after an import. */
  action?: { label: string; run: () => void };
  icon?: string;
  iconColor?: string;
};

/**
 * View state of the app shell (one window): which menu, popover and dialog is open, the toast,
 * the sidebar's inline rename. The pieces of src/app/ read and write it directly; panes and
 * their sizes live in `layout` (layout.svelte.ts).
 */
class Shell {
  /** The popover menu (tree / tab / protocol switch …) and where it opened. */
  menu = $state<AppMenuState>({ kind: null, x: 0, y: 0 });
  /** Escape returns focus here (Mono: menus close on Escape, focus goes back to the trigger). */
  menuTrigger: HTMLElement | null = null;

  paletteOpen = $state(false);
  settingsOpen = $state(false);
  moveOpen = $state(false);
  moveSourceId = $state<string | undefined>(undefined);
  authFolderId = $state<string | undefined>(undefined);
  workspaceMenuOpen = $state(false);
  // The method pickers' open state lives here because App's `<svelte:window onpointerdown>`
  // resets it on outside-click; it's bound into HttpRequestEditor / GrpcEditor.
  httpMethodOpen = $state(false);
  grpcMethodOpen = $state(false);

  // Folder of the active saved request: the palette and menus offer "new request" right next to it.
  activeFolderId = $derived(tabs.active?.savedPath ? parentId(tabs.active.savedPath) : undefined);
  activeFolderName = $derived(this.activeFolderId ? findNode(workspace.tree, this.activeFolderId)?.name : undefined);

  sidebarPanel = $state<'collections' | 'history' | 'git'>('collections');
  searchTerm = $state('');
  // Inline rename of a tree node (window.prompt is unavailable in the Tauri webview)
  editingNodeId = $state<string | undefined>(undefined);
  editValue = $state('');

  // Code snippets belong to the request tab that opened them. Keeping the tab
  // id (instead of one global boolean) prevents the panel jumping between tabs.
  codePanelTabId = $state<string | undefined>(undefined);
  codePanelAvailable = $derived(tabs.active?.protocol === 'http' || tabs.active?.protocol === 'grpc');
  codeOpen = $derived(this.codePanelAvailable && this.codePanelTabId === tabs.active?.id);
  utilityMode = $state<UtilityMode | null>(null);
  utilityPanelHeight = $state(220);

  toast = $state<Toast | null>(null);
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Brief "Saved ✓" feedback on the Save button after a successful write. */
  savedFlash = $state(false);
  #savedFlashTimer: ReturnType<typeof setTimeout> | undefined;

  // Methods are arrow fields so they can be handed to components as callbacks (`{shell.closeMenu}`).
  openMenu = (kind: Exclude<AppMenuKind, null>, e: MouseEvent, nodeId?: string, isFolder?: boolean): void => {
    this.menuTrigger = e.currentTarget as HTMLElement;
    const r = this.menuTrigger.getBoundingClientRect();
    const w = appMenuWidth(kind);
    const at =
      e.type === 'contextmenu'
        ? { x: e.clientX, y: e.clientY, flipY: e.clientY }
        : { x: r.left, y: r.bottom + 8, flipY: r.top - 8 };
    this.menu = { kind, x: Math.min(at.x, window.innerWidth - w - 8), y: at.y, flipY: at.flipY, nodeId, isFolder };
  };

  closeMenu = (): void => {
    this.menu = { kind: null, x: 0, y: 0 };
  };

  showToast = (next: Toast): void => {
    this.toast = next;
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => (this.toast = null), 5000);
  };

  toastAction = (): void => {
    this.toast?.action?.run();
    this.toast = null;
  };

  undoToast = (): void => {
    this.toast?.undo?.();
    this.toast = null;
  };

  flashSaved = (): void => {
    this.savedFlash = true;
    if (this.#savedFlashTimer) clearTimeout(this.#savedFlashTimer);
    this.#savedFlashTimer = setTimeout(() => (this.savedFlash = false), 1200);
  };
}
export const shell = new Shell();
