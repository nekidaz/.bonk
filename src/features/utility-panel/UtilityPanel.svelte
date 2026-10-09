<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$shared/i18n';
  import { cancelRequest, terminalDefaultCwd, terminalRun } from '$shared/ipc';
  import { snapPanelSize, type UtilityMode } from '$shared/ui';
  import { consoleStatus, formatElapsed, matchesConsoleFilter, shortCwd } from './utilPanel';
  import { clearAppConsole, appConsole } from '$entities/request';
  import { workspace } from '$entities/workspace';

  type TerminalLine = {
    id: string;
    kind: 'command' | 'stdout' | 'stderr' | 'meta';
    text: string;
    /** Directory the command was run in (shown before ❯). */
    cwd?: string;
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
  let runId: string | null = null;
  let filter = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let terminalOutputEl = $state<HTMLDivElement | null>(null);
  let consoleOutputEl = $state<HTMLDivElement | null>(null);
  let commandHistory = $state<string[]>([]);
  let historyIndex = $state(0);
  let currentDirectory = $state('');
  let homeDirectory = $state('');
  let directoryInitialized = $state(false);
  let lines = $state<TerminalLine[]>([{ id: crypto.randomUUID(), kind: 'meta', text: t('util.terminal.welcome') }]);

  const directoryLabel = $derived(
    currentDirectory
      ? homeDirectory && currentDirectory === homeDirectory
        ? '~'
        : currentDirectory
      : workspace.path || '~',
  );
  const issueCount = $derived(appConsole.entries.filter((entry) => !entry.ok).length);
  // C1: newest first.
  const visibleConsoleEntries = $derived(
    (mode === 'issues' ? appConsole.entries.filter((entry) => !entry.ok) : appConsole.entries)
      .filter((entry) => matchesConsoleFilter(entry, filter))
      .reverse(),
  );
  const promptDir = $derived(shortCwd(currentDirectory || workspace.path, homeDirectory));

  function addLine(kind: TerminalLine['kind'], text: string, cwd?: string): void {
    if (!text) return;
    lines = [...lines, { id: crypto.randomUUID(), kind, text, cwd }];
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
    addLine('command', next, promptDir);
    running = true;
    runId = crypto.randomUUID();
    try {
      const result = await terminalRun(currentDirectory || workspace.path || null, next, runId ?? undefined);
      currentDirectory = result.cwd;
      addLine('stdout', result.stdout.replace(/\s+$/, ''));
      addLine('stderr', result.stderr.replace(/\s+$/, ''));
      if (result.status !== 0)
        addLine('meta', t('util.terminal.exited', { code: result.status, ms: result.elapsedMs }));
    } catch (error) {
      const text = String(error);
      if (text === 'interrupted') addLine('meta', '^C');
      else addLine('stderr', text.includes('__TAURI_INTERNALS__') ? t('util.terminal.desktop_only') : text);
    } finally {
      running = false;
      runId = null;
      await tick();
      inputEl?.focus();
    }
  }

  /** ⌘K clears (and must not open the global command palette); ⌃C interrupts the running command. */
  function terminalShortcuts(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      lines = [];
    } else if (key === 'c' && event.ctrlKey && !event.metaKey) {
      if (running && runId) {
        event.preventDefault();
        event.stopPropagation();
        void cancelRequest(runId).catch(() => {});
      } else if (!window.getSelection()?.toString()) {
        // Like a shell: abandon the line being typed (keeps Ctrl+C = copy when text is selected).
        event.preventDefault();
        if (command) addLine('command', `${command}^C`, promptDir);
        command = '';
      }
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
    const root = workspace.path;
    void terminalDefaultCwd()
      .then((home) => {
        homeDirectory = home;
        currentDirectory = root || home;
      })
      .catch(() => {
        currentDirectory = root;
      });
  });

  $effect(() => {
    void lines.length;
    void tick().then(() => terminalOutputEl?.scrollTo({ top: terminalOutputEl.scrollHeight }));
  });

  $effect(() => {
    void appConsole.entries.length;
    void tick().then(() => consoleOutputEl?.scrollTo({ top: 0 }));
  });
</script>

<section
  class="bs-utility-panel"
  class:collapsing={collapsePreview}
  style="height:{height}px"
  aria-label={t('util.aria')}
>
  <div
    class="bs-utility-resize"
    role="separator"
    aria-label={t('util.resize_aria')}
    onpointerdown={startResize}
    ondblclick={() => {
      height = 220;
      onResizeEnd();
    }}
  ></div>
  <header class="bs-utility-head">
    <div class="bs-utility-tabs" role="tablist" aria-label={t('util.aria')}>
      <button
        type="button"
        role="tab"
        class:on={mode === 'console'}
        aria-selected={mode === 'console'}
        onclick={() => onSelect('console')}
      >
        {t('util.tab.console')}
        {#if appConsole.entries.length}<span class="bs-utility-count">{appConsole.entries.length}</span>{/if}
      </button>
      <button
        type="button"
        role="tab"
        class:on={mode === 'terminal'}
        aria-selected={mode === 'terminal'}
        onclick={() => onSelect('terminal')}
      >
        {t('util.tab.terminal')}
      </button>
      <button
        type="button"
        role="tab"
        class:on={mode === 'issues'}
        aria-selected={mode === 'issues'}
        onclick={() => onSelect('issues')}
      >
        {t('util.tab.issues')}
        {#if issueCount}<span class="bs-utility-count error">{issueCount}</span>{/if}
      </button>
    </div>
    <div class="bs-spacer"></div>
    {#if mode !== 'terminal'}
      <label class="bs-utility-filter">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          type="search"
          bind:value={filter}
          placeholder={t('util.filter.placeholder')}
          aria-label={t('util.filter.placeholder')}
          autocomplete="off"
          spellcheck="false"
        />
      </label>
    {/if}
    {#if mode === 'terminal'}<span class="bs-utility-context" title={currentDirectory}>{directoryLabel}</span>{/if}
    <button class="bs-utility-action" type="button" onclick={clearCurrent}>{t('util.clear')}</button>
    <button
      class="bs-utility-icon"
      type="button"
      aria-label={t('util.clear_aria')}
      title={t('util.clear')}
      onclick={clearCurrent}
    >
      <span class="material-symbols-outlined">delete_outline</span>
    </button>
    <button
      class="bs-utility-icon"
      type="button"
      aria-label={t('util.close_aria')}
      title={t('common.close')}
      onclick={onClose}
    >
      <span class="material-symbols-outlined">close</span>
    </button>
  </header>

  {#if mode === 'terminal'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bs-terminal-body" onkeydown={terminalShortcuts}>
      <div class="bs-terminal-output" bind:this={terminalOutputEl} role="log" aria-live="polite">
        {#each lines as line (line.id)}
          <div
            class="bs-terminal-line"
            class:command={line.kind === 'command'}
            class:stderr={line.kind === 'stderr'}
            class:meta={line.kind === 'meta'}
          >
            {#if line.kind === 'command'}{#if line.cwd}<span class="cwd">{line.cwd}</span>{/if}<span class="prompt"
                >❯</span
              >{/if}
            <pre>{line.text}</pre>
          </div>
        {/each}
      </div>
      <form class="bs-terminal-prompt" onsubmit={runCommand}>
        <span class="workspace" title={currentDirectory}>{promptDir}</span><span class="prompt">❯</span>
        <input
          bind:this={inputEl}
          bind:value={command}
          aria-label={t('util.terminal.command_aria')}
          autocomplete="off"
          spellcheck="false"
          readonly={running}
          placeholder={running ? t('util.terminal.running') : t('util.terminal.placeholder')}
          onkeydown={terminalKeydown}
        />
        {#if running}<span class="bs-terminal-running material-symbols-outlined">progress_activity</span>{/if}
      </form>
      <div class="bs-terminal-hint">{t('util.terminal.hint')}</div>
    </div>
  {:else}
    <div class="bs-console-output" bind:this={consoleOutputEl} role="log" aria-live="polite">
      {#if visibleConsoleEntries.length === 0}
        <div class="bs-utility-empty">
          <span class="material-symbols-outlined">data_object</span>
          <div>{mode === 'issues' ? t('util.empty.issues') : t('util.empty.console')}</div>
        </div>
      {:else}
        {#each visibleConsoleEntries as entry (entry.id)}
          {@const st = consoleStatus(entry)}
          <article class="bs-console-entry" class:error={!entry.ok}>
            <div class="bs-console-row">
              <time>{timeLabel(entry.at)}</time>
              <span class="protocol">{entry.protocol === 'grpc' ? 'gRPC' : 'HTTP'}</span>
              <span class="method">{entry.method}</span>
              <span class="url" title={entry.url}>{entry.url || '—'}</span>
              <span class="status {st.tone}">{st.label}</span>
              <span class="elapsed">{formatElapsed(entry.elapsedMs)}</span>
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
  .bs-utility-panel.collapsing {
    height: 0 !important;
    min-height: 0;
    border-top-color: var(--accent);
  }
  .bs-utility-resize {
    position: absolute;
    z-index: 4;
    top: -4px;
    left: 0;
    right: 0;
    height: 8px;
    cursor: row-resize;
  }
  .bs-utility-resize:hover {
    background: linear-gradient(
      to bottom,
      transparent calc(50% - 1px),
      var(--accent) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    );
  }
  .bs-utility-head {
    flex: 0 0 34px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px 0 10px;
    background: var(--tb);
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-utility-tabs {
    align-self: stretch;
    display: flex;
    align-items: stretch;
    gap: 14px;
  }
  .bs-utility-tabs button {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px;
    color: var(--t2);
    font-size: 11.5px;
  }
  .bs-utility-tabs button::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: transparent;
  }
  .bs-utility-tabs button.on {
    color: var(--text);
  }
  .bs-utility-tabs button.on::after {
    background: var(--accent);
  }
  .bs-utility-count {
    min-width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    padding: 0 4px;
    color: var(--t2);
    background: var(--hover);
    border-radius: 8px;
    font-size: 9px;
  }
  .bs-utility-count.error {
    color: var(--red);
  }
  .bs-utility-context {
    max-width: 240px;
    overflow: hidden;
    color: var(--t3);
    font-family: var(--mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-utility-action {
    height: 22px;
    padding: 0 7px;
    color: var(--t2) !important;
    border-radius: 3px;
    font-size: 10.5px !important;
  }
  .bs-utility-icon {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    color: var(--t3) !important;
    border-radius: 3px;
  }
  .bs-utility-action:hover,
  .bs-utility-icon:hover {
    color: var(--text) !important;
    background: var(--hover);
  }
  .bs-utility-icon .material-symbols-outlined {
    font-size: 14px;
  }
  .bs-terminal-body {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    font-family: var(--mono);
  }
  .bs-terminal-output {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 9px 12px 4px;
    scrollbar-gutter: stable;
  }
  .bs-terminal-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 19px;
    color: var(--t2);
    font-size: 11.5px;
    line-height: 1.55;
  }
  .bs-terminal-line.command {
    color: var(--text);
  }
  .bs-terminal-line.stderr {
    color: var(--red);
  }
  .bs-terminal-line.meta {
    color: var(--t3);
  }
  .bs-terminal-line pre,
  .bs-console-detail {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
  }
  .prompt {
    flex: none;
    color: var(--green);
    font-weight: 700;
  }
  .bs-terminal-prompt {
    flex: 0 0 32px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 12px;
    border-top: 1px solid var(--sepsoft);
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .bs-terminal-prompt .workspace {
    max-width: 200px;
    overflow: hidden;
    color: var(--accent);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-terminal-prompt input {
    min-width: 0;
    flex: 1;
    height: 100%;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: 0;
    font: inherit;
  }
  .bs-terminal-prompt input::placeholder {
    color: var(--t3);
  }
  .bs-terminal-running {
    color: var(--accent);
    font-size: 14px;
    animation: bs-terminal-spin 900ms linear infinite;
  }
  @keyframes bs-terminal-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .bs-console-output {
    min-height: 0;
    flex: 1;
    overflow: auto;
    font-family: var(--mono);
    scrollbar-gutter: stable;
  }
  .bs-console-entry {
    padding: 7px 11px;
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-console-row {
    display: grid;
    grid-template-columns: 64px 42px minmax(70px, auto) minmax(140px, 1fr) auto 62px;
    align-items: center;
    gap: 9px;
    min-height: 18px;
    font-size: 10.5px;
  }
  .bs-console-row time,
  .bs-console-row .elapsed {
    color: var(--t3);
  }
  .bs-console-row .protocol {
    color: var(--purple);
    font-weight: 700;
  }
  .bs-console-row .method {
    color: var(--green);
    font-weight: 700;
  }
  .bs-console-row .url {
    overflow: hidden;
    color: var(--t2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-console-row .status {
    justify-self: end;
    height: 17px;
    padding: 0 7px;
    border-radius: 999px;
    color: var(--green);
    background: color-mix(in srgb, var(--green) 14%, transparent);
    font-weight: 700;
    line-height: 17px;
    white-space: nowrap;
  }
  .bs-console-row .status.info,
  .bs-console-row .status.muted {
    color: var(--t2);
    background: var(--hover);
  }
  .bs-console-row .status.warn {
    color: var(--orange, var(--yellow, #d9a441));
    background: color-mix(in srgb, var(--orange, var(--yellow, #d9a441)) 14%, transparent);
  }
  .bs-console-row .status.err {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
  }
  .bs-utility-filter {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 220px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--sepsoft);
    border-radius: 999px;
    color: var(--t3);
  }
  .bs-utility-filter:focus-within {
    border-color: var(--t3);
  }
  .bs-utility-filter .material-symbols-outlined {
    font-size: 13px;
  }
  .bs-utility-filter input {
    min-width: 0;
    flex: 1;
    height: 100%;
    padding: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: 0;
    box-shadow: none;
    font: 10.5px var(--mono);
  }
  .bs-utility-filter input::-webkit-search-cancel-button {
    display: none;
  }
  .bs-terminal-line .cwd {
    flex: none;
    color: var(--accent);
  }
  .bs-terminal-hint {
    flex: none;
    padding: 3px 12px 6px;
    color: var(--t3);
    font-size: 10px;
  }
  .bs-console-detail {
    margin: 4px 0 0 117px;
    color: var(--t2);
    font-size: 10.5px;
    line-height: 1.5;
  }
  .bs-console-detail.error {
    color: var(--red);
  }
  .bs-utility-empty {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 7px;
    color: var(--t3);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 11.5px;
  }
  .bs-utility-empty .material-symbols-outlined {
    font-size: 24px;
  }
</style>
