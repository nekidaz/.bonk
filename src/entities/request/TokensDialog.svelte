<!--
  The shell the OAuth tokens and Sessions dialogs share: a portaled overlay and the wide card whose
  table look (`.tr` rows, `.pill`, `.dot`, `.acts`, `.signout`, `.note`) is styled below.
  The caller renders <ModalHeader>, <ModalBody> and <ModalFooter> inside.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { Modal, Overlay } from '$shared/ui/components';

  let { label, class: cls, children }: { label: string; class?: ClassValue; children?: Snippet } = $props();
</script>

<Overlay portal role="dialog" aria-modal="true" aria-label={label}>
  <Modal class={['bs-oa-tokens', cls]}>{@render children?.()}</Modal>
</Overlay>

<style>
  :global(:root .bs-sessions .who .material-symbols-outlined) {
    font-size: 15px;
    color: var(--color-text-muted);
  }

  :global(:root .bs-oa-tokens .pill.bad) {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }

  :global(:root .bs-oa-tokens .pill.none) {
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(:root .bs-oa-tokens .pill) {
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

  :global(:root .bs-oa-tokens) {
    width: 760px;
  }

  :global(:root .bs-oa-tokens .lede) {
    margin: 0 0 12px;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(:root .bs-oa-tokens .table) {
    border-radius: var(--radius-card);
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
  }

  :global(:root .bs-oa-tokens .tr) {
    display: grid;
    grid-template-columns: 1.1fr 1fr 1.6fr 1fr 110px;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(:root .bs-oa-tokens .tr:last-child) {
    border-bottom: 0;
  }

  :global(:root .bs-oa-tokens .tr.th) {
    min-height: 34px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(:root .bs-oa-tokens .dim) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }

  :global(:root .bs-oa-tokens .env-name) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(:root .bs-oa-tokens .dot) {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  :global(:root .bs-oa-tokens .dot.tone-production) {
    background: var(--color-danger);
  }

  :global(:root .bs-oa-tokens .dot.tone-staging) {
    background: var(--color-warning);
  }

  :global(:root .bs-oa-tokens .dot.tone-local) {
    background: var(--color-success);
  }

  :global(:root .bs-oa-tokens .acts) {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
  }

  :global(:root .bs-oa-tokens .icon) {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }

  :global(:root .bs-oa-tokens .icon:hover) {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(:root .bs-oa-tokens .icon .material-symbols-outlined) {
    font-size: 17px;
  }

  :global(:root .bs-oa-tokens .signout) {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    padding: 12px 12px 12px 16px;
    border-radius: var(--radius-card);
    background: var(--color-selected);
  }

  :global(:root .bs-oa-tokens .signout .txt) {
    flex: 1;
    min-width: 0;
  }

  :global(:root .bs-oa-tokens .signout .ttl) {
    color: var(--color-text);
    font: 600 var(--font-size-body) var(--font-ui);
  }

  :global(:root .bs-oa-tokens .signout .sub) {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(:root .bs-oa-tokens .note) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(:root .bs-oa-tokens .note .material-symbols-outlined) {
    font-size: 15px;
    color: var(--color-text-secondary);
  }

  :global(:root .bs-oa-tokens .signout > .material-symbols-outlined) {
    font-size: 15px;
    color: var(--color-text-secondary);
  }

  :global(:root .bs-sessions .fail .material-symbols-outlined) {
    font-size: 15px;
  }
</style>
