<!--
  The big Send button at the end of the URL bar (was the global `.bs-send` class). The caller renders the
  `.go` label inside (text, optional icon and `<kbd>` hint) and sets state classes: `cancelling` while a
  request runs (Esc cancels), `stop` for a running gRPC stream.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & { ref?: HTMLButtonElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<button bind:this={ref} class={['bs-send', cls]} {...rest}>{@render children?.()}</button>

<style>
  :global(.bs) .bs-send.cancelling :global(.go) {
    color: var(--color-text);
  }

  :global(.bs) .bs-send:not(.cancelling) :global(.go kbd) {
    color: var(--color-on-action);
    font: var(--font-size-micro) var(--font-code);
    opacity: 0.6;
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs button.bs-send` (same elements, same specificity), so it lives here. */
  :global(:where(.bs)) button.bs-send:active {
    background: var(--primary-press);
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs button.bs-send` (same elements, same specificity), so it lives here. */
  :global(.bs) button.bs-send.cancelling {
    color: #fff;
  }

  /* Belongs to request.css, but the cascade needs it before `:root .bs :is(.bs-menu,.bs-method-menu,.bs-work-menu,.bs-tab-ctx,.bs-grpc-menu) button` (same elements, same specificity), so it lives here. */
  :global(.bs) button.bs-send {
    flex: 0 0 auto;
    height: 48px;
    min-width: 90px;
    padding: 0 28px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-action);
    color: var(--color-on-action);
    box-shadow: none;
  }

  @media (max-width: 900px) {
    :global(.bs) button.bs-send :global(kbd) {
      display: none;
    }
  }

  .bs-send {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    height: 40px;
    min-width: 88px;
    border-radius: 10px;
    overflow: hidden;
    background: var(--accent);
    box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.2);
  }

  .bs-send.cancelling {
    background: #d74b43;
  }

  .bs-send.cancelling :global(.go) {
    background: transparent;
  }

  .bs-send :global(.go) {
    height: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    letter-spacing: 0;
    color: var(--primary-text);
    padding: 0 14px;
    min-width: 80px;
    justify-content: center;
    background: transparent;
    font-size: 14px;
    font-weight: 600;
  }

  .bs-send.cancelling :global(.go) {
    color: #fff;
  }

  .bs-send :global(.go .material-symbols-outlined) {
    display: none;
  }

  @media (max-width: 480px) {
    .bs-send :global(.go) {
      min-width: 52px;
    }
  }

  :global(.bs) button.bs-send:hover {
    background: var(--primary-hover);
  }

  :global(.bs) button.bs-send:disabled {
    opacity: 0.35;
    cursor: default;
  }

  :global(.bs) button.bs-send:disabled:hover {
    background: var(--color-action);
  }

  :global(.bs) button.bs-send.cancelling:hover {
    color: #fff;
    padding: 0 18px 0 20px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    background: var(--color-raised);
    box-shadow: none;
  }

  :global(.bs) button.bs-send.cancelling:active {
    color: #fff;
    padding: 0 18px 0 20px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    background: var(--color-raised);
    box-shadow: none;
  }

  :global(.bs) button.bs-send.cancelling {
    padding: 0 18px 0 20px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    background: var(--color-raised);
    box-shadow: none;
  }

  :global(.bs) .bs-send.cancelling :global(kbd) {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    opacity: 1;
  }

  :global(.bs) .bs-send :global(.go) {
    min-width: 0;
    padding: 0;
    gap: 10px;
    justify-content: center;
    background: transparent;
    color: var(--color-on-action);
    font-size: var(--font-size-ui);
    font-weight: 600;
  }

  :global(:root[data-density='compact'] .bs) button.bs-send {
    height: 34px;
  }

  @media (max-width: 760px) {
    /* The 720 px minimum: Send gives the gRPC method picker its room. */
    :global(.bs) button.bs-send {
      min-width: 70px;
      padding: 0 14px;
    }
  }
</style>
