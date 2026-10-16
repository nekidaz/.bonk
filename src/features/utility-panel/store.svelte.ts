import { untrack } from 'svelte';
import { appConsole } from '$entities/request';
import { workspace } from '$entities/workspace';
import { t } from '$shared/i18n';
import { cancelRequest, terminalDefaultCwd, terminalRun } from '$shared/ipc';
import { openIssues, type IssueFacets, type IssueGroupBy, type IssueKind, type IssueSort } from './issues';
import { shortCwd, type ConsoleQuick } from './utilPanel';

export type TerminalLine = {
  id: string;
  kind: 'command' | 'stdout' | 'stderr' | 'meta';
  text: string;
  /** Directory the command was run in (shown before ❯). */
  cwd?: string;
};

/** CT6: a command handed over from the console, waiting for Enter (or Esc). */
export interface TerminalInsert {
  command: string;
  /** `BONK_*` → secret value; reaches the shell's environment, never the command text. */
  env: Record<string, string>;
  title: string;
  envName?: string;
}

const MAX_LINES = 5_000;
const line = (kind: TerminalLine['kind'], text: string, cwd?: string): TerminalLine => ({
  id: crypto.randomUUID(),
  kind,
  text,
  cwd,
});

/**
 * The panel's shell session. Lives outside the component so output, history and a running
 * command survive closing the panel (⌘J) and switching tabs.
 */
class Terminal {
  lines = $state.raw<TerminalLine[]>([line('meta', t('util.terminal.welcome'))]);
  history = $state.raw<string[]>([]);
  /** Empty until `init()` resolves; then the directory commands run in. */
  cwd = $state('');
  home = $state('');
  running = $state.raw<{ command: string; startedAt: number; runId: string } | null>(null);
  insert = $state.raw<TerminalInsert | null>(null);
  #started = false;

  promptDir = $derived(shortCwd(this.cwd || workspace.path, this.home));

  init(): void {
    if (this.#started) return;
    this.#started = true;
    const root = workspace.path;
    void terminalDefaultCwd()
      .then((home) => {
        this.home = home;
        this.cwd ||= root || home;
      })
      .catch(() => (this.cwd ||= root));
  }

  add(kind: TerminalLine['kind'], text: string, cwd?: string): void {
    this.lines = [...untrack(() => this.lines), line(kind, text, cwd)].slice(-MAX_LINES);
  }

  clear(): void {
    this.lines = [];
  }

  /** Run `command` (or the pending insert); output streams in line by line. */
  async run(command: string, env?: Record<string, string>): Promise<void> {
    const next = command.trim();
    if (!next || untrack(() => this.running)) return;
    this.history = [...untrack(() => this.history).filter((x) => x !== next), next].slice(-100);
    if (next === 'clear') {
      this.clear();
      return;
    }
    const dir = untrack(() => this.promptDir);
    this.add('command', next, dir);
    const runId = crypto.randomUUID();
    this.running = { command: next, startedAt: Date.now(), runId };
    try {
      const result = await terminalRun(
        untrack(() => this.cwd) || workspace.path || null,
        next,
        (out) => this.add(out.stderr ? 'stderr' : 'stdout', out.text),
        { runId, env },
      );
      this.cwd = result.cwd;
      if (result.status !== 0)
        this.add('meta', t('util.terminal.exited', { code: result.status, ms: result.elapsedMs }));
    } catch (error) {
      const text = String(error);
      if (text === 'interrupted') this.add('meta', '^C');
      else this.add('stderr', text.includes('__TAURI_INTERNALS__') ? t('util.terminal.desktop_only') : text);
    } finally {
      this.running = null;
    }
  }

  runInsert(): void {
    const pending = untrack(() => this.insert);
    if (!pending) return;
    this.insert = null;
    void this.run(pending.command, pending.env);
  }

  interrupt(): void {
    const id = untrack(() => this.running)?.runId;
    if (id) void cancelRequest(id).catch(() => {});
  }
}
export const terminal = new Terminal();

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
  /** «Очистить» in Issues hides everything before this moment; the console keeps it. */
  clearedAt = $state(0);
  /** Causes the user muted («Не показывать»). */
  muted = $state.raw<ReadonlySet<string>>(new Set());

  /** Open failures, oldest first (the footer chip, the Issues tab count). */
  issues = $derived(openIssues(appConsole.entries, this.clearedAt, this.muted));

  mute(causes: string[]): void {
    this.muted = new Set([...untrack(() => this.muted), ...causes]);
  }
}
export const utilityUi = new UtilityUi();
