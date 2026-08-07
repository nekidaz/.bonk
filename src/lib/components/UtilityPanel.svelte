<script lang="ts">
  import { tick } from 'svelte';
  import { terminalDefaultCwd, terminalRun } from '../api';
  import { snapPanelSize, type UtilityMode } from '../domain/appShell';
  import { appConsoleEntries, clearAppConsole, workspacePath } from '../stores';

  type TerminalLine = {
    id: string;
    kind: 'command' | 'stdout' | 'stderr' | 'meta';
    text: string;
  };

  let {
    mode,
    height = $bindable(220),
    onSelect,
    onClose,
    onResizeEnd = () => {},
  }: {
    mode: UtilityMode;
    height?: number;
    onSelect: (mode: UtilityMode) => void;
    onClose: () => void;
    onResizeEnd?: () => void;
  } = $props();

  const PANEL_MIN = 140;
  const PANEL_COLLAPSE_AT = 80;
  let collapsePreview = $state(false);
  let command = $state('');
  let running = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let terminalOutputEl = $state<HTMLDivElement | null>(null);
  let consoleOutputEl = $state<HTMLDivElement | null>(null);
  let commandHistory = $state<string[]>([]);
  let historyIndex = $state(0);
  let currentDirectory = $state('');
  let homeDirectory = $state('');
  let directoryInitialized = $state(false);
  let lines = $state<TerminalLine[]>([
    { id: crypto.randomUUID(), kind: 'meta', text: 'Bonk Terminal · system shell.' },
  ]);

  const directoryLabel = $derived(
    currentDirectory
      ? (homeDirectory && currentDirectory === homeDirectory ? '~' : currentDirectory)
      : ($workspacePath || '~'),
  );
  const issueCount = $derived($appConsoleEntries.filter((entry) => !entry.ok).length);
  const visibleConsoleEntries = $derived(
    mode === 'issues' ? $appConsoleEntries.filter((entry) => !entry.ok) : $appConsoleEntries,
  );

  function addLine(kind: TerminalLine['kind'], text: string): void {
    if (!text) return;
    lines = [...lines, { id: crypto.randomUUID(), kind, text }];
  }

  function clearCurrent(): void {
    if (mode === 'terminal') lines = [];
    else clearAppConsole();
  }

  async function runCommand(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const next = command.trim();
    if (!next || running) return;
    command = '';
    commandHistory = [...commandHistory.filter((item) => item !== next), next].slice(-100);
    historyIndex = commandHistory.length;
    if (next === 'clear') {
      lines = [];
      return;
    }
    addLine('command', next);
    running = true;
    try {
      const result = await terminalRun(currentDirectory || ($workspacePath || null), next);
      currentDirectory = result.cwd;
      addLine('stdout', result.stdout.replace(/\s+$/, ''));
      addLine('stderr', result.stderr.replace(/\s+$/, ''));
      if (result.status !== 0) addLine('meta', `Process exited with code ${result.status} · ${result.elapsedMs} ms`);
    } catch (error) {
      const text = String(error);
      addLine(
        'stderr',
        text.includes('__TAURI_INTERNALS__')
          ? 'Terminal commands are available in the Bonk desktop app.'
          : text,
      );
    } finally {
      running = false;
      await tick();
      inputEl?.focus();
    }
  }

  function terminalKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (commandHistory.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') historyIndex = Math.max(0, historyIndex - 1);
    else historyIndex = Math.min(commandHistory.length, historyIndex + 1);
    command = historyIndex < commandHistory.length ? commandHistory[historyIndex] : '';
  }

  function startResize(event: PointerEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const maxHeight = Math.max(PANEL_MIN, window.innerHeight - 180);
    const onMove = (moveEvent: PointerEvent) => {
      const next = startHeight + startY - moveEvent.clientY;
      const snapped = snapPanelSize(next, PANEL_MIN, maxHeight, PANEL_COLLAPSE_AT);
      collapsePreview = snapped.collapsed;
      height = snapped.collapsed ? startHeight : snapped.size;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const collapse = collapsePreview;
      collapsePreview = false;
      if (collapse) onClose();
      else onResizeEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function timeLabel(value: number): string {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  $effect(() => {
    if (mode !== 'terminal') return;
    void tick().then(() => inputEl?.focus());
  });

  $effect(() => {
    if (directoryInitialized) return;
    directoryInitialized = true;
    const workspace = $workspacePath;
    void terminalDefaultCwd()
      .then((home) => {
        homeDirectory = home;
        currentDirectory = workspace || home;
      })
      .catch(() => {
        currentDirectory = workspace;
      });
  });

  $effect(() => {
    void lines.length;
    void tick().then(() => terminalOutputEl?.scrollTo({ top: terminalOutputEl.scrollHeight }));
  });

  $effect(() => {
    void $appConsoleEntries.length;
    void tick().then(() => consoleOutputEl?.scrollTo({ top: consoleOutputEl.scrollHeight }));
  });
</script>

<section class="bs-utility-panel" class:collapsing={collapsePreview} style="height:{height}px" aria-label="Developer tools">
  <div class="bs-utility-resize" role="separator" aria-label="Resize developer tools" onpointerdown={startResize}></div>
  <header class="bs-utility-head">
    <div class="bs-utility-tabs" role="tablist" aria-label="Developer tools">
      <button type="button" role="tab" class:on={mode === 'console'} aria-selected={mode === 'console'} onclick={() => onSelect('console')}>
        Console
        {#if $appConsoleEntries.length}<span class="bs-utility-count">{$appConsoleEntries.length}</span>{/if}
      </button>
      <button type="button" role="tab" class:on={mode === 'terminal'} aria-selected={mode === 'terminal'} onclick={() => onSelect('terminal')}>
        Terminal
      </button>
      <button type="button" role="tab" class:on={mode === 'issues'} aria-selected={mode === 'issues'} onclick={() => onSelect('issues')}>
        Issues
        {#if issueCount}<span class="bs-utility-count error">{issueCount}</span>{/if}
      </button>
    </div>
    <div class="bs-spacer"></div>
    {#if mode === 'terminal'}<span class="bs-utility-context" title={currentDirectory}>{directoryLabel}</span>{/if}
    <button class="bs-utility-action" type="button" onclick={clearCurrent}>Clear</button>
    <button class="bs-utility-icon" type="button" aria-label="Clear developer tools" title="Clear" onclick={clearCurrent}>
      <span class="material-symbols-outlined">delete_outline</span>
    </button>
    <button class="bs-utility-icon" type="button" aria-label="Close developer tools" title="Close" onclick={onClose}>
      <span class="material-symbols-outlined">close</span>
    </button>
  </header>

  {#if mode === 'terminal'}
    <div class="bs-terminal-body">
      <div class="bs-terminal-output" bind:this={terminalOutputEl} role="log" aria-live="polite">
        {#each lines as line (line.id)}
          <div class="bs-terminal-line" class:command={line.kind === 'command'} class:stderr={line.kind === 'stderr'} class:meta={line.kind === 'meta'}>
            {#if line.kind === 'command'}<span class="prompt">❯</span>{/if}<pre>{line.text}</pre>
          </div>
        {/each}
      </div>
      <form class="bs-terminal-prompt" onsubmit={runCommand}>
        <span class="workspace" title={currentDirectory}>{directoryLabel}</span><span class="prompt">❯</span>
        <input
          bind:this={inputEl}
          bind:value={command}
          aria-label="Terminal command"
          autocomplete="off"
          spellcheck="false"
          disabled={running}
          placeholder={running ? 'Running…' : 'Type a command and press Enter'}
          onkeydown={terminalKeydown}
        />
        {#if running}<span class="bs-terminal-running material-symbols-outlined">progress_activity</span>{/if}
      </form>
    </div>
  {:else}
    <div class="bs-console-output" bind:this={consoleOutputEl} role="log" aria-live="polite">
      {#if visibleConsoleEntries.length === 0}
        <div class="bs-utility-empty">
          <span class="material-symbols-outlined">data_object</span>
          <div>{mode === 'issues' ? 'No issues detected.' : 'Request events will appear here.'}</div>
        </div>
      {:else}
        {#each visibleConsoleEntries as entry (entry.id)}
          <article class="bs-console-entry" class:error={!entry.ok}>
            <div class="bs-console-row">
              <time>{timeLabel(entry.at)}</time>
              <span class="protocol">{entry.protocol === 'grpc' ? 'RPC' : 'HTTP'}</span>
              <span class="method">{entry.method}</span>
              <span class="url" title={entry.url}>{entry.url || '—'}</span>
              <span class="status">{entry.status}</span>
              <span class="elapsed">{entry.elapsedMs} ms</span>
            </div>
            {#if entry.message}<pre class="bs-console-detail error">{entry.message}</pre>{/if}
            {#each entry.logs ?? [] as log}<pre class="bs-console-detail">{log}</pre>{/each}
          </article>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .bs-utility-panel {
    position: relative;
    flex: none;
    min-height: 140px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: var(--canvas, var(--surface));
    border-top: 1px solid var(--sep);
  }
  .bs-utility-panel.collapsing { height: 0 !important; min-height: 0; border-top-color: var(--accent); }
  .bs-utility-resize { position: absolute; z-index: 4; top: -3px; left: 0; right: 0; height: 6px; cursor: row-resize; }
  .bs-utility-resize:hover { background: var(--accent); opacity: .4; }
  .bs-utility-head { flex: 0 0 34px; display: flex; align-items: center; gap: 5px; padding: 0 7px 0 10px; background: var(--tb); border-bottom: 1px solid var(--sepsoft); }
  .bs-utility-tabs { align-self: stretch; display: flex; align-items: stretch; gap: 14px; }
  .bs-utility-tabs button { position: relative; display: flex; align-items: center; gap: 6px; padding: 0 2px; color: var(--t2); font-size: 11.5px; }
  .bs-utility-tabs button::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: transparent; }
  .bs-utility-tabs button.on { color: var(--text); }
  .bs-utility-tabs button.on::after { background: var(--accent); }
  .bs-utility-count { min-width: 16px; height: 16px; display: grid; place-items: center; padding: 0 4px; color: var(--t2); background: var(--hover); border-radius: 8px; font-size: 9px; }
  .bs-utility-count.error { color: var(--red); }
  .bs-utility-context { max-width: 240px; overflow: hidden; color: var(--t3); font-family: var(--mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .bs-utility-action { height: 22px; padding: 0 7px; color: var(--t2) !important; border-radius: 3px; font-size: 10.5px !important; }
  .bs-utility-icon { width: 22px; height: 22px; display: grid; place-items: center; color: var(--t3) !important; border-radius: 3px; }
  .bs-utility-action:hover, .bs-utility-icon:hover { color: var(--text) !important; background: var(--hover); }
  .bs-utility-icon .material-symbols-outlined { font-size: 14px; }
  .bs-terminal-body { min-height: 0; flex: 1; display: flex; flex-direction: column; font-family: var(--mono); }
  .bs-terminal-output { min-height: 0; flex: 1; overflow: auto; padding: 9px 12px 4px; scrollbar-gutter: stable; }
  .bs-terminal-line { display: flex; align-items: flex-start; gap: 8px; min-height: 19px; color: var(--t2); font-size: 11.5px; line-height: 1.55; }
  .bs-terminal-line.command { color: var(--text); }
  .bs-terminal-line.stderr { color: var(--red); }
  .bs-terminal-line.meta { color: var(--t3); }
  .bs-terminal-line pre, .bs-console-detail { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  .prompt { flex: none; color: var(--green); font-weight: 700; }
  .bs-terminal-prompt { flex: 0 0 32px; display: flex; align-items: center; gap: 7px; padding: 0 12px; border-top: 1px solid var(--sepsoft); font-family: var(--mono); font-size: 11.5px; }
  .bs-terminal-prompt .workspace { max-width: 200px; overflow: hidden; color: var(--accent); text-overflow: ellipsis; white-space: nowrap; }
  .bs-terminal-prompt input { min-width: 0; flex: 1; height: 100%; color: var(--text); background: transparent; border: 0; outline: 0; font: inherit; }
  .bs-terminal-prompt input::placeholder { color: var(--t3); }
  .bs-terminal-running { color: var(--accent); font-size: 14px; animation: bs-terminal-spin 900ms linear infinite; }
  @keyframes bs-terminal-spin { to { transform: rotate(360deg); } }
  .bs-console-output { min-height: 0; flex: 1; overflow: auto; font-family: var(--mono); scrollbar-gutter: stable; }
  .bs-console-entry { padding: 7px 11px; border-bottom: 1px solid var(--sepsoft); }
  .bs-console-row { display: grid; grid-template-columns: 64px 42px minmax(70px, auto) minmax(140px, 1fr) auto 62px; align-items: center; gap: 9px; min-height: 18px; font-size: 10.5px; }
  .bs-console-row time, .bs-console-row .elapsed { color: var(--t3); }
  .bs-console-row .protocol { color: var(--purple); font-weight: 700; }
  .bs-console-row .method { color: var(--green); font-weight: 700; }
  .bs-console-row .url { overflow: hidden; color: var(--t2); text-overflow: ellipsis; white-space: nowrap; }
  .bs-console-row .status { color: var(--green); font-weight: 700; }
  .bs-console-entry.error .status { color: var(--red); }
  .bs-console-detail { margin: 4px 0 0 117px; color: var(--t2); font-size: 10.5px; line-height: 1.5; }
  .bs-console-detail.error { color: var(--red); }
  .bs-utility-empty { height: 100%; display: grid; place-content: center; justify-items: center; gap: 7px; color: var(--t3); font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11.5px; }
  .bs-utility-empty .material-symbols-outlined { font-size: 24px; }
</style>
