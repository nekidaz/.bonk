import { untrack } from 'svelte';
import { tabs } from '$entities/tab';
import { workspace } from '$entities/workspace';
import { afterSend, requestLayout, SIDE_BY_SIDE_MIN, sideOnWide } from '$shared/settings';
import { focusMode, snapPanelSize } from '$shared/ui';
import { loadState, saveState } from '$shared/persist';
import { shell } from './shell.svelte';

// Resizable panels (Postman-style). Persisted across restarts.
// S33: 220–420 px, narrower than 180 collapses; double-click restores the default.
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 264;
const SIDEBAR_COLLAPSE_AT = 180;
// S35: below this window width the sidebar gives up width first (down to SIDEBAR_MIN),
// then the main area adapts. Pure CSS, so it tracks window resizes for free.
const SQUEEZE_BELOW = 1100;
// Flow · Размеры окна: at the 720 px minimum (anything up to this) the request folds into its strip.
const COMPACT_MAX = 760;
const PANE_MIN = 120; // min height for both the request pane and the response
const RESPONSE_COLLAPSE_AT = 72;
const RESPONSE_DEFAULT_HEIGHT = null; // null = default flex:1

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * The window's panes: sidebar (shown, width), request/response split, side-by-side and
 * expanded modes. `startEffects()` (called once by App) ties it to the active tab and workspace.
 */
class Layout {
  // S34: hidden by the user (⌘\, or dragged past the collapse edge); persisted.
  sidebarHidden = $state(false);
  // Width shown in the S33 tooltip while the handle is dragged.
  sidebarDragWidth = $state<number | null>(null);
  // S36: the Runner tab auto-hides the sidebar without touching the user's choice;
  // showing it there explicitly (⌘\, grip) holds until the tab changes.
  runnerReveal = $state(false);
  // The Runner and the G8 three-way merge need the width: the sidebar steps aside for them.
  sidebarShown = $derived(
    !this.sidebarHidden &&
      (tabs.active?.protocol !== 'runner' || this.runnerReveal) &&
      tabs.active?.git?.view !== 'merge',
  );
  sidebarWidth = $state(SIDEBAR_DEFAULT);
  sidebarCssWidth = $derived(
    `clamp(${SIDEBAR_MIN}px, calc(${this.sidebarWidth}px + 100vw - ${SQUEEZE_BELOW}px), ${this.sidebarWidth}px)`,
  );
  // Width is remembered per workspace.
  sidebarWidths = $state.raw<Record<string, number>>({});

  responseHeight = $state<number | null>(RESPONSE_DEFAULT_HEIGHT);
  // Panel open/close animates via CSS; drags must track the pointer 1:1, so
  // this flag turns the transitions off for the duration of a drag.
  panelDragging = $state(false);
  responseHidden = $state(false);
  /** The response dragged all the way up: the request editor hides (URL bar and tabs stay). */
  requestHidden = $state(false);

  // ---- Layout (S32.5b, E1–E7) ----
  requestTab = $derived(tabs.active?.protocol === 'http' || tabs.active?.protocol === 'grpc');
  innerWidth = $state(window.innerWidth);
  /** E7: request | response side by side — chosen, or automatic on a wide window. Expanded mode wins. */
  sideBySide = $derived(
    this.requestTab &&
      !focusMode.current &&
      (requestLayout.current === 'side' || (sideOnWide.current && this.innerWidth >= SIDE_BY_SIDE_MIN)),
  );
  /** In stacked layouts a hidden pane folds into its 44 px strip. */
  respStrip = $derived(!this.sideBySide && (this.responseHidden || focusMode.current === 'request'));
  reqStrip = $derived(!this.sideBySide && this.requestHidden && !focusMode.current);

  /** Restore the saved panel sizes (after hydrate). */
  async load(): Promise<void> {
    this.sidebarWidths = await loadState<Record<string, number>>('sidebarWidths', {});
    this.sidebarHidden = await loadState('sidebarHidden', false);
    const savedResponseHeight = await loadState<number | null>('responseHeight', null);
    this.responseHeight = savedResponseHeight == null ? null : Math.max(PANE_MIN, savedResponseHeight);
    shell.utilityPanelHeight = clamp(
      await loadState('utilityPanelHeight', 220),
      140,
      Math.max(140, window.innerHeight - 180),
    );
  }

  /** The reactions to the active tab and workspace. Call once during App's init; they stop when it unmounts. */
  startEffects(): void {
    $effect(() => {
      void tabs.activeId;
      untrack(() => (this.runnerReveal = false));
    });
    $effect(() => {
      this.sidebarWidth = clamp(this.sidebarWidths[workspace.path] ?? SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX);
    });
    // Shrinking to the minimum window folds the request into its strip (⌄ opens it); widening unfolds it.
    let compact = false;
    $effect(() => {
      const now = this.innerWidth <= COMPACT_MAX;
      if (now === compact) return;
      compact = now;
      untrack(() => (this.requestHidden = now));
    });
    // Expanded mode belongs to the tab it was opened on.
    let focusTabId: string | undefined;
    $effect(() => {
      const id = tabs.active?.id;
      if (id !== focusTabId) {
        focusTabId = id;
        untrack(() => (focusMode.current = null));
      }
    });
    // Entering expanded mode brings that pane back from its strip.
    $effect(() => {
      const m = focusMode.current;
      untrack(() => {
        if (m === 'request') this.requestHidden = false;
        else if (m === 'response') this.responseHidden = false;
      });
    });
    // A fresh response (not a tab switch): auto-focus and «После отправки: раскрыть ответ» give it the height.
    let seenResponse: { tab?: string; res?: unknown } = {};
    $effect(() => {
      const active = tabs.active;
      const res = active?.protocol === 'grpc' ? active.grpcResult : active?.response;
      const id = active?.id;
      if (
        res &&
        id &&
        seenResponse.tab === id &&
        seenResponse.res !== res &&
        !this.sideBySide &&
        (requestLayout.current === 'focus' || afterSend.current === 'expand')
      ) {
        untrack(() => {
          this.responseHidden = false;
          this.requestHidden = true;
        });
      }
      seenResponse = { tab: id, res };
    });
  }

  // Methods below are arrow fields so components can take them as callbacks (`onclick={layout.showRequest}`).
  setSidebarShown = (show: boolean): void => {
    this.sidebarHidden = !show;
    this.runnerReveal = show;
    void saveState('sidebarHidden', this.sidebarHidden);
  };
  toggleSidebar = (): void => {
    this.setSidebarShown(!this.sidebarShown);
  };
  showSidebar = (panel: 'collections' | 'history' | 'flows' | 'git'): void => {
    shell.sidebarPanel = panel;
    this.setSidebarShown(true);
  };
  saveSidebarWidth = (): void => {
    this.sidebarWidths = { ...this.sidebarWidths, [workspace.path]: this.sidebarWidth };
    void saveState('sidebarWidths', this.sidebarWidths);
  };

  /**
   * Auto-focus: the pane being worked in fills, the other folds into its strip.
   * Flow · Скрипты SC7: a big script does this in every stacked layout.
   */
  autoFocusIn = (e: FocusEvent): void => {
    const el = e.target instanceof Element ? e.target : null;
    if (this.sideBySide || focusMode.current) return;
    if (el?.closest('.bs-scripts[data-big]')) {
      this.requestHidden = false;
      this.responseHidden = true;
      return;
    }
    if (requestLayout.current !== 'focus') return;
    if (el?.closest('.bs-reqpane')) {
      this.requestHidden = false;
      this.responseHidden = true;
    } else if (el?.closest('.bs-resp-host') && !el.closest('.bs-resizer-row')) {
      this.responseHidden = false;
      this.requestHidden = true;
    }
  };
  showResponse = (): void => {
    focusMode.current = null;
    this.responseHidden = false;
    if (requestLayout.current === 'focus') this.requestHidden = true;
  };
  showRequest = (): void => {
    focusMode.current = null;
    this.requestHidden = false;
    if (requestLayout.current === 'focus') this.responseHidden = true;
  };

  // Keep the request pane's PANE_MIN guarantee when the window shrinks: a fixed
  // response height set earlier could otherwise collapse the request pane to 0.
  clampResponseToViewport = (): void => {
    if (this.responseHeight == null) return;
    const resp = document.querySelector('.bs-resp-host') as HTMLElement | null;
    const column = resp?.parentElement as HTMLElement | null;
    if (!column) return;
    const max = column.getBoundingClientRect().height - PANE_MIN;
    this.responseHeight = clamp(this.responseHeight, PANE_MIN, Math.max(PANE_MIN, max));
  };

  /**
   * Shared pointer-drag plumbing. Listeners live on `window` so the drag keeps
   * tracking even when the cursor leaves the thin handle, and `setPointerCapture`
   * is best-effort (some environments reject it for synthetic pointers).
   */
  #beginDrag(e: PointerEvent, cursor: string, onMove: (ev: PointerEvent) => void, onDone: () => void): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is an enhancement; the window listeners drive the drag.
    }
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    this.panelDragging = true;
    // Coalesce pointermove bursts to one layout per frame; more events than
    // frames otherwise re-runs full app layout mid-frame and the drag stutters.
    let pending: PointerEvent | null = null;
    let raf = 0;
    const move = (ev: PointerEvent): void => {
      pending = ev;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending) onMove(pending);
          pending = null;
        });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (raf) cancelAnimationFrame(raf);
      if (pending) onMove(pending);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      this.panelDragging = false;
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Drag the sidebar's right edge to resize it; from the hidden-state grip, drag it open. */
  startSidebarDrag = (e: PointerEvent): void => {
    const startX = e.clientX;
    const startWidth = this.sidebarWidth;
    const startShown = this.sidebarShown;
    const before = { hidden: this.sidebarHidden, reveal: this.runnerReveal };
    this.#beginDrag(
      e,
      'col-resize',
      (ev) => {
        const snapped = snapPanelSize(
          (startShown ? startWidth : 0) + (ev.clientX - startX),
          SIDEBAR_MIN,
          SIDEBAR_MAX,
          SIDEBAR_COLLAPSE_AT,
        );
        // Collapsing keeps the pre-drag width so reopening restores the user's
        // layout; a grip pull that never got wide enough changes nothing.
        this.sidebarHidden = snapped.collapsed ? startShown || before.hidden : false;
        this.runnerReveal = snapped.collapsed ? !startShown && before.reveal : true;
        this.sidebarWidth = snapped.collapsed ? startWidth : snapped.size;
        this.sidebarDragWidth = snapped.collapsed ? null : snapped.size;
      },
      () => {
        this.sidebarDragWidth = null;
        this.saveSidebarWidth();
        void saveState('sidebarHidden', this.sidebarHidden);
      },
    );
  };

  /** Drag the response panel's top border to resize the request/response split. */
  startSplitDrag = (e: PointerEvent): void => {
    const handle = e.currentTarget as HTMLElement;
    const resp = handle.closest('.bs-resp-host') as HTMLElement | null;
    const column = resp?.parentElement as HTMLElement | null;
    if (!resp || !column) return;
    const startY = e.clientY;
    // Seed from the live height so the first drag from default (flex:1) is smooth.
    const liveHeight = this.responseHeight ?? resp.getBoundingClientRect().height;
    // A collapsed response opens from zero, following the pointer.
    const startHeight = this.responseHidden ? 0 : resp.getBoundingClientRect().height;
    // The space the split shares; the request pane is 0 tall while hidden.
    const reqPane = column.querySelector('.bs-reqpane') as HTMLElement | null;
    const total = reqPane
      ? startHeight + reqPane.getBoundingClientRect().height
      : column.getBoundingClientRect().height;
    this.#beginDrag(
      e,
      'row-resize',
      (ev) => {
        const raw = startHeight - (ev.clientY - startY);
        // Past the top snap edge the request editor hides and the response fills.
        this.requestHidden = total - raw <= RESPONSE_COLLAPSE_AT;
        if (this.requestHidden) {
          this.responseHidden = false;
          return;
        }
        // Otherwise the request pane keeps PANE_MIN, and the response collapses past its own snap edge.
        const snapped = snapPanelSize(raw, PANE_MIN, Math.max(PANE_MIN, total - PANE_MIN), RESPONSE_COLLAPSE_AT);
        this.responseHidden = snapped.collapsed;
        this.responseHeight = snapped.collapsed ? liveHeight : snapped.size;
      },
      () => void saveState('responseHeight', this.responseHeight),
    );
  };

  // Double-click on a resize handle restores the panel's default size.
  resetSidebarWidth = (): void => {
    this.sidebarWidth = SIDEBAR_DEFAULT;
    this.saveSidebarWidth();
  };
  resetResponseSize = (): void => {
    this.responseHidden = false;
    this.requestHidden = false;
    this.responseHeight = RESPONSE_DEFAULT_HEIGHT;
    void saveState('responseHeight', this.responseHeight);
  };
}
export const layout = new Layout();
