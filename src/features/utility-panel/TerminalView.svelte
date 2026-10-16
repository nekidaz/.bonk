<script lang="ts">
  // Flow · Terminal (CT4–CT6): the active shell session (terminal.svelte.ts) mounted in the panel.
  import { untrack } from 'svelte';
  import '@xterm/xterm/css/xterm.css';
  import { t } from '$shared/i18n';
  import { terminal } from './terminal.svelte';

  let host = $state<HTMLDivElement | null>(null);

  // Opening the tab with no session starts one; after the last is killed, the empty state stays.
  if (terminal.sessions.length === 0) terminal.add();

  $effect(() => {
    const session = terminal.active;
    const el = host;
    if (!session || !el) return;
    untrack(() => session.mount(el));
    const resize = new ResizeObserver(() => session.refit(el));
    resize.observe(el);
    return () => {
      resize.disconnect();
      session.unmount();
    };
  });

  /** ⌘K clears the screen (and must not open the global command palette). */
  function keys(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 'k' || !event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    terminal.clear();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bs-terminal" bind:this={host} hidden={!terminal.active} onkeydown={keys}></div>
{#if !terminal.active}
  <div class="bs-utility-empty">
    <span class="material-symbols-outlined" aria-hidden="true">terminal</span>
    <div>{t('util.terminal.empty')}</div>
    <button type="button" class="bs-chip" onclick={() => terminal.add()}>{t('util.terminal.new')}</button>
  </div>
{/if}

<style>
  .bs-terminal {
    min-height: 0;
    flex: 1;
    padding: 6px 4px 4px 14px;
    overflow: hidden;
  }
  .bs-terminal[hidden] {
    display: none;
  }
  .bs-terminal :global(.xterm) {
    height: 100%;
  }
</style>
