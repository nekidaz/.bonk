import { tick } from 'svelte';
import { openSavedRequest, type AppConsoleEntry } from '$entities/request';
import { tabs } from '$entities/tab';
import { findNode, workspace } from '$entities/workspace';

/** «Открыть запрос»: its tab if still open, else the saved request. False when neither exists. */
export function openEntry(e: Pick<AppConsoleEntry, 'tabId' | 'nodeId'>): boolean {
  if (e.tabId && tabs.list.some((x) => x.id === e.tabId)) {
    tabs.activeId = e.tabId;
    return true;
  }
  const node = e.nodeId ? findNode(workspace.tree, e.nodeId) : undefined;
  if (node?.kind !== 'request') return false;
  openSavedRequest(node);
  return true;
}

/** «Повторить»: open it and press Send, as the History «Повторить» does. */
export async function retryEntry(e: Pick<AppConsoleEntry, 'tabId' | 'nodeId'>): Promise<void> {
  if (!openEntry(e)) return;
  await tick();
  document.querySelector<HTMLButtonElement>('.bs-send')?.click();
}
