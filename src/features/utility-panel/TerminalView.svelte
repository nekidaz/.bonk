<script lang="ts">
  // Flow · Терминал (CT4–CT6): the system shell in the workspace folder. Output streams in; a
  // long command blocks input and shows ■ Остановить; a request handed over from the console waits
  // for Enter with its secrets in `$BONK_*` variables.
  import { tick } from 'svelte';
  import { t } from '$shared/i18n';
  import { formatElapsed } from './utilPanel';
  import { terminal } from './store.svelte';
  import { Spacer } from '$shared/ui/components';

  let command = $state('');
  let historyIndex = $state(terminal.history.length);
  let inputEl = $state<HTMLInputElement | null>(null);
  let outputEl = $state<HTMLDivElement | null>(null);
  let now = $state(Date.now());

  const insertVars = $derived(Object.keys(terminal.insert?.env ?? {}).map((k) => `$${k}`));

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (terminal.running) return;
    if (!command.trim() && terminal.insert) {
      terminal.runInsert();
      return;
    }
    const next = command;
    command = '';
    void terminal.run(next).then(() => {
      historyIndex = terminal.history.length;
      void tick().then(() => inputEl?.focus());
    });
    historyIndex = terminal.history.length;
  }

  /** ⌘K clears (and must not open the global command palette); ⌃C interrupts or drops the line. */
  function keys(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      terminal.clear();
    } else if (key === 'c' && event.ctrlKey && !event.metaKey) {
      if (terminal.running) {
        event.preventDefault();
        event.stopPropagation();
        terminal.interrupt();
      } else if (!window.getSelection()?.toString()) {
        // Like a shell: abandon the line being typed (keeps Ctrl+C = copy when text is selected).
        event.preventDefault();
        if (command) terminal.add('command', `${command}^C`, terminal.promptDir);
        command = '';
        terminal.insert = null;
      }
    } else if (event.key === 'Escape' && terminal.insert) {
      event.preventDefault();
      event.stopPropagation();
      terminal.insert = null;
    }
  }

  function historyKeys(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const list = terminal.history;
    if (list.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') historyIndex = Math.max(0, historyIndex - 1);
    else historyIndex = Math.min(list.length, historyIndex + 1);
    command = historyIndex < list.length ? list[historyIndex] : '';
  }

  /** `$BONK_TOKEN` stands out in the pending command (CT6). */
  function parts(text: string): { text: string; v: boolean }[] {
    return text.split(/(\$BONK_[A-Z0-9_]+)/).map((p, i) => ({ text: p, v: i % 2 === 1 }));
  }

  $effect(() => {
    if (!terminal.running) {
      void tick().then(() => inputEl?.focus());
      return;
    }
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(id);
  });

  $effect(() => {
    void terminal.lines.length;
    void terminal.insert;
    void tick().then(() => outputEl?.scrollTo({ top: outputEl.scrollHeight }));
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bs-terminal-body" onkeydown={keys}>
  <div class="bs-terminal-output" bind:this={outputEl} role="log" aria-live="polite">
    <div class="bs-terminal-lines">
      {#each terminal.lines as line (line.id)}
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
      {#if terminal.insert}
        <div class="bs-terminal-note">
          <span class="material-symbols-outlined" aria-hidden="true">input</span>
          <span
            >{t('util.terminal.inserted', { title: terminal.insert.title })}{terminal.insert.envName
              ? ` · ${terminal.insert.envName}`
              : ''}.
            {#if insertVars.length}{t('util.terminal.secretVars', { vars: insertVars.join(', ') })}{/if}</span
          >
        </div>
        <div class="bs-terminal-line command pending">
          <span class="cwd">{terminal.promptDir}</span><span class="prompt">❯</span>
          <pre>{#each parts(terminal.insert.command) as p, i (i)}{#if p.v}<span class="var">{p.text}</span
                >{:else}{p.text}{/if}{/each}</pre>
        </div>
      {/if}
    </div>
  </div>
  {#if terminal.running}
    <div class="bs-terminal-running">
      <span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span>
      <span class="label">{t('util.terminal.runningLabel')}</span>
      <span class="cmd">{terminal.running.command}</span>
      <span class="time">{formatElapsed(Math.max(0, now - terminal.running.startedAt))}</span>
      <Spacer />
      <span class="blocked">{t('util.terminal.blocked')}</span>
      <button type="button" class="stop" onclick={() => terminal.interrupt()}
        ><span class="material-symbols-outlined" aria-hidden="true">stop</span>{t('util.terminal.stop')}
        <kbd>⌃C</kbd></button
      >
    </div>
  {:else}
    <form class="bs-terminal-prompt" onsubmit={submit}>
      <span class="workspace" title={terminal.cwd}>{terminal.promptDir}</span><span class="prompt">❯</span>
      <input
        bind:this={inputEl}
        bind:value={command}
        aria-label={t('util.terminal.command_aria')}
        autocomplete="off"
        spellcheck="false"
        placeholder={terminal.insert ? t('util.terminal.insertHint') : t('util.terminal.hint')}
        onkeydown={historyKeys}
      />
    </form>
  {/if}
</div>

<style>
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
    display: flex;
    flex-direction: column;
    overflow: auto;
    padding: 9px 16px 2px;
    scrollbar-gutter: stable;
  }
  /* CT4: output sits on the prompt, like a real terminal. */
  .bs-terminal-lines {
    margin-top: auto;
  }
  .bs-terminal-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 18px;
    color: var(--text);
    font-size: 11.5px;
    line-height: 1.55;
  }
  .bs-terminal-line.command:not(:first-child) {
    margin-top: 6px;
  }
  .bs-terminal-line.stderr {
    color: var(--red);
  }
  .bs-terminal-line.meta {
    color: var(--t3);
  }
  .bs-terminal-line pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .cwd,
  .workspace {
    flex: none;
    color: var(--t3);
  }
  .prompt {
    flex: none;
    color: var(--accent);
    font-weight: 700;
  }
  .var {
    padding: 0 3px;
    border-radius: var(--radius-xs);
    color: var(--green);
    background: color-mix(in srgb, var(--green) 14%, transparent);
  }
  .bs-terminal-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px -6px 4px;
    padding: 5px 8px;
    border-radius: var(--radius-md);
    color: var(--text);
    background: color-mix(in srgb, var(--green) 12%, transparent);
    font-family: var(--font-ui);
    font-size: 11.5px;
  }
  .bs-terminal-note .material-symbols-outlined {
    color: var(--green);
    font-size: 15px;
  }
  .bs-terminal-prompt {
    flex: 0 0 30px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 16px 4px;
    font-size: 11.5px;
  }
  .bs-terminal-prompt .workspace {
    max-width: 200px;
    overflow: hidden;
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
    box-shadow: none;
    font: inherit;
    caret-shape: block;
  }
  .bs-terminal-prompt input::placeholder {
    color: var(--t3);
  }
  .bs-terminal-running {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 8px 8px;
    padding: 4px 6px 4px 12px;
    border-radius: var(--radius-md);
    background: var(--hover);
    font-size: 11.5px;
  }
  .bs-terminal-running .spin {
    color: var(--accent);
    font-size: 15px;
    animation: bs-terminal-spin 900ms linear infinite;
  }
  .bs-terminal-running .label {
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
  }
  .bs-terminal-running .cmd,
  .bs-terminal-running .time {
    color: var(--t3);
    white-space: nowrap;
  }
  .bs-terminal-running .cmd {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bs-terminal-running .time {
    color: var(--t2);
  }
  .bs-terminal-running .blocked {
    color: var(--t3);
    font-family: var(--font-ui);
    white-space: nowrap;
  }
  .stop {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
    font-family: var(--font-ui);
    font-size: 12px;
  }
  .stop:hover {
    background: color-mix(in srgb, var(--red) 22%, transparent);
  }
  .stop .material-symbols-outlined {
    font-size: 13px;
  }
  .stop kbd {
    font: inherit;
    opacity: 0.8;
  }
  @keyframes bs-terminal-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bs-terminal-running .spin {
      animation: none;
    }
  }
</style>
