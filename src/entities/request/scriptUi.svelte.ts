import { untrack } from 'svelte';
import type { ScriptStage } from '$shared/model';

/** “Go to line” for one tab's script editor: the editor opens the stage, reveals the line, clears it. */
export type ScriptJump = { tabId: string; stage: ScriptStage; line?: number };

/**
 * Script tab state shared across panes: the response pane jumps to a line (SC4/SC6), and the expanded
 * mode's top bar (FocusBar, SC8) shows and switches the stage of the editor below it.
 */
class ScriptUi {
  /** Stage shown per tab id (default: pre-request). */
  stages = $state.raw<Record<string, ScriptStage>>({});
  /** Tab ids whose request pane shows the Scripts tab right now. */
  open = $state.raw<Record<string, boolean>>({});
  jump = $state.raw<ScriptJump | null>(null);
  /** Tab ids whose expanded editor shows the results panel (SC9): it replaces the response strip. */
  runPanel = $state.raw<Record<string, boolean>>({});
}
export const scriptUi = new ScriptUi();

export const scriptStage = (tabId: string): ScriptStage => scriptUi.stages[tabId] ?? 'pre';

export function setScriptStage(tabId: string, stage: ScriptStage): void {
  scriptUi.stages = { ...untrack(() => scriptUi.stages), [tabId]: stage };
}

export function setScriptsOpen(tabId: string, open: boolean): void {
  const cur = untrack(() => scriptUi.open);
  if (!!cur[tabId] === open) return;
  const { [tabId]: _old, ...rest } = cur;
  scriptUi.open = open ? { ...rest, [tabId]: true } : rest;
}

export function revealScriptLine(tabId: string, stage: ScriptStage, line?: number): void {
  scriptUi.jump = { tabId, stage, line };
}

export function setScriptRunPanel(tabId: string, open: boolean): void {
  const cur = untrack(() => scriptUi.runPanel);
  if (!!cur[tabId] === open) return;
  const { [tabId]: _old, ...rest } = cur;
  scriptUi.runPanel = open ? { ...rest, [tabId]: true } : rest;
}
