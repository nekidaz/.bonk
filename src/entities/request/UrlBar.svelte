<!-- The request address row (was `.bs-urlbar`): a <UrlField> and the Send button. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-urlbar', cls]} {...rest}>{@render children?.()}</div>

<style>
  @media (max-width: 480px) {
    .bs-urlbar:has(:global(.bs-grpc-picker)) {
      flex-wrap: wrap;
    }
  }

  .bs-urlbar {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* URL row · 48px capsule + Send */
  .bs-urlbar {
    display: flex;
    align-items: center;
    backdrop-filter: none;
    box-shadow: none;
    background: var(--canvas);
    flex: none;
    height: 48px;
    gap: 8px;
    padding: 0 20px;
  }

  :global(:root[data-density='compact'] .bs) .bs-urlbar {
    min-height: 34px;
    padding: 0 14px;
  }

  @media (max-width: 760px) {
    .bs-urlbar {
      padding-inline: 9px;
      padding-left: 12px;
      padding-right: 12px;
    }
  }

  /* S13: long URLs — one fading line at rest, a wrapping card on focus. */
  :global(.bs) .bs-urlbar {
    height: auto;
    min-height: 48px;
    align-items: flex-start;
  }
</style>
