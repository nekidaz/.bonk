<script lang="ts">
  // Flow · Терминал (CT4–CT6): the user's shell (terminal.svelte.ts) mounted in the panel.
  import { untrack } from 'svelte';
  import '@xterm/xterm/css/xterm.css';
  import { terminal } from './terminal.svelte';

  let host = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const el = host;
    if (el) return untrack(() => terminal.attach(el));
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
<div class="bs-terminal" bind:this={host} onkeydown={keys}></div>

<style>
  .bs-terminal {
    min-height: 0;
    flex: 1;
    padding: 6px 4px 4px 14px;
    overflow: hidden;
  }
  .bs-terminal :global(.xterm) {
    height: 100%;
  }
</style>
