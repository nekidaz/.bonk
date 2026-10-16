<!-- The token/session status card (was `.bs-oa-card`): `.ic`, `.txt` (`.ttl`, `.sub`), `.badge`, `.acts`. Tones `tone-accent|success|warning|danger`; `se-card` for sessions. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLDivElement> & { ref?: HTMLDivElement | null; children?: Snippet };

  let { class: cls, ref = $bindable(), children, ...rest }: Props = $props();
</script>

<div bind:this={ref} class={['bs-oa-card', cls]} {...rest}>{@render children?.()}</div>

<style>
  :global(.bs) .bs-oa-card.tone-warning :global(.badge) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs) .se-card.tone-success :global(.se-badge) {
    background: var(--color-success-soft);
    color: var(--color-success);
  }

  :global(.bs) .se-card.tone-warning :global(.se-badge) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs) .se-card.tone-danger :global(.se-badge) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .se-card.se-dead :global(.se-badge) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .se-card.tone-accent :global(.se-badge) {
    background: var(--color-var-soft);
    color: var(--color-var);
  }

  :global(.bs) .se-card :global(.badge.dead) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .bs-oa-card :global(.env) {
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

  :global(.bs) .bs-oa-card :global(.env .material-symbols-outlined) {
    font-size: 11px;
  }

  :global(.bs) .bs-oa-card :global(.env.tone-production) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .bs-oa-card :global(.env.tone-staging) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(.bs) .bs-oa-card :global(.env.tone-local) {
    background: var(--color-success-soft);
    color: var(--color-success);
  }

  :global(.bs) .bs-oa-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 10px 12px 10px 16px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
  }

  :global(.bs) .bs-oa-card > :global(.ic) {
    flex: none;
    font-size: 20px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-oa-card :global(.ic.spin) {
    animation: bs-oa-spin 1s linear infinite;
  }

  :global(.bs) .bs-oa-card :global(.txt) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  :global(.bs) .bs-oa-card :global(.ttl) {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text);
    font: 600 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-oa-card :global(.ttl .env) {
    margin-left: 0;
  }

  :global(.bs) .bs-oa-card :global(.sub) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-oa-card :global(.acts) {
    flex: none;
    display: flex;
    gap: 6px;
  }

  :global(.bs) .bs-oa-card :global(.badge) {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 600 var(--font-size-caption) var(--font-ui);
    white-space: nowrap;
  }

  :global(.bs) .bs-oa-card :global(.code) {
    padding: 1px 6px;
    border-radius: var(--radius-control);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    font: 500 var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-oa-card.tone-accent > :global(.ic) {
    color: var(--color-var);
  }

  :global(.bs) .bs-oa-card.tone-success > :global(.ic) {
    color: var(--color-success);
  }

  :global(.bs) .bs-oa-card.tone-warning > :global(.ic) {
    color: var(--color-warning);
  }

  :global(.bs) .bs-oa-card.tone-danger {
    outline-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
    background: var(--color-danger-soft);
  }

  :global(.bs) .bs-oa-card.tone-danger > :global(.ic) {
    color: var(--color-danger);
  }

  :global(.bs) .se-card :global(.se-badge) {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(.bs) .se-card :global(.se-badge .material-symbols-outlined) {
    font-size: 18px;
  }

  :global(.bs) .se-card :global(.se-badge .spin) {
    animation: bs-oa-spin 1s linear infinite;
  }

  :global(.bs) .se-card.se-banner :global(.se-badge .material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .se-card :global(.acts) {
    align-items: center;
  }
</style>
