<!-- The title row of a Source Control view (was `.bs-ghead`): `.crumb`, `.ttl`/<h2>, actions. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-ghead', cls]} {...rest}>{@render children?.()}</div>

<style>
  /* The header above a git view: crumb + title on the left, actions on the right.
     In a narrow window the actions wrap under the title instead of running off the edge. */
  .bs-ghead {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
    padding: 12px 20px 14px;
  }

  .bs-ghead :global(.ttl) {
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .bs-ghead :global(.crumb) {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bs-ghead :global(.row) {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .bs-ghead :global(h2) {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font: 600 22px/27px var(--font-ui);
    letter-spacing: -0.5px;
  }
</style>
