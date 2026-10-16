<!-- A settings card of the auth editors (was the global `.bs-auth-card`): `.row`s of `.lbl` + control, `.hint`s. Variants `config`, `details`, `se-compact`. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-auth-card', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs) .bs-auth-card :global(.hint.side) {
    flex: 0 1 auto;
    max-width: 260px;
    font-size: var(--font-size-caption);
  }

  :global(.bs) .bs-auth-card.config :global(.row) {
    min-height: 44px;
    padding: 6px 0;
  }

  :global(.bs) .bs-auth-card.details :global(.row) {
    min-height: 44px;
    padding: 6px 0;
  }

  :global(.bs) .bs-auth-card :global(.row.foot) {
    min-height: 44px;
  }

  :global(.bs) .bs-auth-card.se-compact :global(.row) {
    min-height: 40px;
    padding: 4px 0;
  }

  /* S11: authorization form. */
  :global(.bs) .bs-auth-card {
    display: flex;
    flex-direction: column;
    padding: 6px 16px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
  }

  :global(.bs) .bs-auth-card :global(.row) {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 58px;
    padding: 12px 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  :global(.bs) .bs-auth-card :global(.row:last-child) {
    border-bottom: 0;
  }

  :global(.bs) .bs-auth-card :global(.lbl) {
    flex: 0 0 140px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-auth-card :global(.hint) {
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-auth-card :global(.eye) {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-auth-card :global(.eye:hover) {
    background: var(--hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-auth-card :global(.eye .material-symbols-outlined) {
    font-size: 17px;
  }

  :global(.bs) .bs-auth-card :global(.secret) {
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-auth-card :global(.env) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    margin-left: -8px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 600 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-auth-card :global(.env .material-symbols-outlined) {
    font-size: 11px;
  }

  :global(.bs) .bs-auth-card :global(.env.tone-production) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .bs-auth-card :global(.env.tone-staging) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs) .bs-auth-card :global(.env.tone-local) {
    background: var(--color-success-soft);
    color: var(--color-success);
  }

  :global(.bs) .bs-auth-card :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  :global(.bs) .bs-auth-card :global(.dim) {
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-auth-card :global(.row.top) {
    align-items: flex-start;
  }

  :global(.bs) .bs-auth-card :global(.row:has(+ .row.se-note)) {
    border-bottom: 0;
  }
</style>
