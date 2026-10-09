import { writable, get } from 'svelte/store';
import type { Tab } from '$shared/model';

/** Open tabs: the list, the active id, and the lowest-level mutators every other slice uses. */

// No tabs until the user opens one: the main panel shows the welcome / "no open tabs" screen.
export const tabs = writable<Tab[]>([]);
export const activeTabId = writable<string>('');

export function updateActiveTab(fn: (tab: Tab) => Tab): void {
  const id = get(activeTabId);
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

/** Update a specific tab by id, regardless of which tab is currently active. */
export function updateTabById(id: string, fn: (tab: Tab) => Tab): void {
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
