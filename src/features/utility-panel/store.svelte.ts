import { untrack } from 'svelte';
import { appConsole } from '$entities/request';
import { openIssues, type IssueFacets, type IssueGroupBy, type IssueKind, type IssueSort } from './issues';
import type { ConsoleQuick } from './utilPanel';

/** View state of the Console and Issues tabs (filters, grouping, CT12 expanded mode). */
class UtilityUi {
  consoleFilter = $state('');
  consoleQuick = $state<ConsoleQuick>('all');
  /** CT2: the console row opened in place. */
  openEntry = $state<string | null>(null);

  issuesFilter = $state('');
  issuesKind = $state<IssueKind | 'all'>('all');
  groupBy = $state<IssueGroupBy>('cause');
  sort = $state<IssueSort>('count');
  hideOld = $state(false);
  facets = $state.raw<IssueFacets>({});
  openGroup = $state<string | null>(null);
  /** CT12: Issues take the whole height, facets on the left (⇧⌘J). */
  expanded = $state(false);
  /** “Clear all” in Issues hides everything before this moment; the console keeps it. */
  clearedAt = $state(0);
  /** Causes the user muted (“Mute”). */
  muted = $state.raw<ReadonlySet<string>>(new Set());

  /** Open failures, oldest first (the footer chip, the Issues tab count). */
  issues = $derived(openIssues(appConsole.entries, this.clearedAt, this.muted));

  mute(causes: string[]): void {
    this.muted = new Set([...untrack(() => this.muted), ...causes]);
  }
}
export const utilityUi = new UtilityUi();
