import { untrack } from 'svelte';
import type { Tab } from '$shared/model';

/**
 * Open tabs: the list, the active id, and the lowest-level mutators every other slice uses.
 * `list` is replaced on every change, never mutated in place (`$state.raw`), like the old store.
 * The mutators read the current list untracked, so calling one inside an $effect
 * doesn't make that effect depend on (and re-run for) its own write.
 */
class Tabs {
  // No tabs until the user opens one: the main panel shows the welcome / "no open tabs" screen.
  list = $state.raw<Tab[]>([]);
  /** Id of the focused tab; '' when none. */
  activeId = $state('');
  /** The focused tab, if any. */
  active = $derived(this.list.find((t) => t.id === this.activeId));

  /** Replace the list with `fn(list)`. */
  update(fn: (list: Tab[]) => Tab[]): void {
    this.list = fn(untrack(() => this.list));
  }

  /** Apply `fn` to the focused tab. */
  updateActive(fn: (tab: Tab) => Tab): void {
    const id = untrack(() => this.activeId);
    this.updateById(id, fn);
  }

  /** Apply `fn` to tab `id`, whichever tab is focused. */
  updateById(id: string, fn: (tab: Tab) => Tab): void {
    this.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
  }
}
export const tabs = new Tabs();

// HMR (dev only): app/persistence hydrate() fills this singleton once at startup.
// A partial hot swap would recreate it EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
