<script lang="ts">
  // Flow · Консоль, терминал, Issues: one bottom panel, three tabs. ⌘J opens/closes it; the height
  // drags past the top edge and is remembered; ⇧⌘J (or ⤢) gives Issues the whole height.
  import { t } from '$shared/i18n';
  import { snapPanelSize, type UtilityMode } from '$shared/ui';
  import { appConsole, clearAppConsole } from '$entities/request';
  import ConsoleView from './ConsoleView.svelte';
  import IssuesView from './IssuesView.svelte';
  import TerminalView from './TerminalView.svelte';
  import { utilityUi } from './store.svelte';
  import { terminal } from './terminal.svelte';
  import { Spacer } from '$shared/ui/components';

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
  const TABS: UtilityMode[] = ['console', 'terminal', 'issues'];
  let collapsePreview = $state(false);

  // CT12 applies to the Issues tab only.
  const full = $derived(mode === 'issues' && utilityUi.expanded);

  function clearCurrent(): void {
    if (mode === 'issues') utilityUi.clearedAt = Date.now();
    else clearAppConsole();
  }

  /** ⌘K clears the open tab (it must not open the command palette from here). */
  function keys(event: KeyboardEvent): void {
    if (mode === 'terminal' || event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey)
      return;
    event.preventDefault();
    event.stopPropagation();
    clearCurrent();
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
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="bs-utility-panel"
  class:collapsing={collapsePreview}
  class:expanded={full}
  style:height={full ? null : `${height}px`}
  aria-label={t('util.aria')}
  onkeydown={keys}
>
  {#if !full}
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
  {/if}
  <header class="bs-utility-head">
    <div class="bs-utility-tabs" role="tablist" aria-label={t('util.aria')}>
      {#each TABS as tab (tab)}
        <button
          type="button"
          role="tab"
          class:on={mode === tab}
          aria-selected={mode === tab}
          onclick={() => onSelect(tab)}
        >
          {t(`util.tab.${tab}`)}
          {#if tab === 'console' && appConsole.entries.length}<span class="bs-utility-count"
              >{appConsole.entries.length}</span
            >{/if}
          {#if tab === 'terminal' && terminal.alive}<span class="bs-utility-live" aria-hidden="true"></span>{/if}
          {#if tab === 'issues' && utilityUi.issues.length}<span class="bs-utility-count error"
              >{utilityUi.issues.length}</span
            >{/if}
        </button>
      {/each}
    </div>
    <Spacer />
    {#if mode === 'terminal'}
      {#if terminal.sessions.length > 1}
        <div class="bs-utility-sessions" role="tablist" aria-label={t('util.terminal.sessions')}>
          {#each terminal.sessions as session, i (session.key)}
            <button
              type="button"
              role="tab"
              class="bs-chip"
              class:on={session.key === terminal.activeKey}
              class:dead={!session.alive}
              aria-selected={session.key === terminal.activeKey}
              onclick={() => (terminal.activeKey = session.key)}>{session.shell || 'shell'} {i + 1}</button
            >
          {/each}
        </div>
      {/if}
      <button class="bs-chip bs-utility-clear" type="button" onclick={() => terminal.clear()}>{t('util.clear')}</button>
      <button
        class="bs-utility-icon"
        type="button"
        aria-label={t('util.terminal.new')}
        title={t('util.terminal.new')}
        onclick={() => terminal.add()}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        class="bs-utility-icon"
        type="button"
        aria-label={t('util.terminal.kill')}
        title={t('util.terminal.kill')}
        disabled={!terminal.active}
        onclick={() => terminal.kill()}
      >
        <span class="material-symbols-outlined">delete_outline</span>
      </button>
    {:else}
      <label class="bs-utility-filter">
        <span class="material-symbols-outlined" aria-hidden="true">filter_list</span>
        {#if mode === 'issues'}
          <input
            type="search"
            bind:value={utilityUi.issuesFilter}
            placeholder={t('issues.filter')}
            aria-label={t('issues.filter')}
            autocomplete="off"
            spellcheck="false"
          />
        {:else}
          <input
            type="search"
            bind:value={utilityUi.consoleFilter}
            placeholder={t('util.filter.placeholder')}
            aria-label={t('util.filter.placeholder')}
            autocomplete="off"
            spellcheck="false"
          />
        {/if}
      </label>
    {/if}
    {#if mode === 'issues'}
      <button
        class="bs-utility-icon"
        type="button"
        aria-label={t(utilityUi.expanded ? 'issues.collapse' : 'issues.expand')}
        title={t(utilityUi.expanded ? 'issues.collapse' : 'issues.expand')}
        onclick={() => (utilityUi.expanded = !utilityUi.expanded)}
      >
        <span class="material-symbols-outlined">{utilityUi.expanded ? 'close_fullscreen' : 'open_in_full'}</span>
      </button>
    {/if}
    {#if mode !== 'terminal'}
      <button
        class="bs-utility-icon"
        type="button"
        aria-label={t('util.clear_aria')}
        title={t('util.clear')}
        onclick={clearCurrent}
      >
        <span class="material-symbols-outlined">delete_outline</span>
      </button>
    {/if}
    <button
      class="bs-utility-icon"
      type="button"
      aria-label={t('util.close_aria')}
      title={t('common.close')}
      onclick={() => {
        utilityUi.expanded = false;
        onClose();
      }}
    >
      <span class="material-symbols-outlined">close</span>
    </button>
  </header>

  {#if mode === 'terminal'}
    <TerminalView />
  {:else if mode === 'issues'}
    <IssuesView />
  {:else}
    <ConsoleView onTerminal={() => onSelect('terminal')} />
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
  .bs-utility-panel.expanded {
    height: 100%;
  }
  .bs-utility-panel.collapsing {
    /* Beats the inline `height` the resizer sets. */
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
    flex: 0 0 40px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 10px;
  }
  .bs-utility-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-control);
    background: var(--inset);
  }
  .bs-utility-tabs button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--t2);
    font-size: 12px;
  }
  .bs-utility-tabs button:hover {
    color: var(--text);
  }
  .bs-utility-tabs button.on {
    color: var(--text);
    background: var(--hover2);
    font-weight: 600;
  }
  .bs-utility-count {
    min-width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    padding: 0 5px;
    color: var(--t2);
    background: var(--hover);
    border-radius: 9px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 400;
  }
  .bs-utility-count.error {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 16%, transparent);
  }
  .bs-utility-live {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
  }
  .bs-utility-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--sepsoft);
    border-radius: 999px;
    color: var(--t3);
    background: var(--inset);
  }
  .bs-utility-filter .material-symbols-outlined {
    font-size: 14px;
  }
  .bs-utility-filter {
    width: 200px;
  }
  .bs-utility-sessions {
    display: flex;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
  }
  .bs-utility-sessions .dead {
    color: var(--t3);
  }
  .bs-utility-clear {
    border: 1px solid var(--sepsoft);
  }
  .bs-utility-icon:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .bs-utility-filter:focus-within {
    border-color: var(--t3);
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
    font-size: 12px;
  }
  .bs-utility-filter input::-webkit-search-cancel-button {
    display: none;
  }
  .bs-utility-icon {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    color: var(--t3);
    border-radius: var(--radius-sm);
  }
  .bs-utility-icon:hover {
    color: var(--text);
    background: var(--hover);
  }
  .bs-utility-icon .material-symbols-outlined {
    font-size: 15px;
  }
  /* Shared by the three views. */
  .bs-utility-panel :global(.bs-chip) {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 9px;
    border-radius: var(--radius-control);
    color: var(--t2);
    font-size: 11.5px;
  }
  .bs-utility-panel :global(.bs-chip:hover) {
    color: var(--text);
    background: var(--hover);
  }
  .bs-utility-panel :global(.bs-chip.on) {
    color: var(--text);
    background: var(--hover2);
    font-weight: 600;
  }
  .bs-utility-panel :global(.bs-utility-empty) {
    height: 100%;
    min-height: 80px;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 7px;
    color: var(--t3);
    font-family: var(--font-ui);
    font-size: 11.5px;
  }
  .bs-utility-panel :global(.bs-utility-empty .material-symbols-outlined) {
    font-size: 24px;
  }
</style>
