<!--
  The response pane below (or beside) the request: the resize handle, the progress line while
  sending, and ResponseView, which draws the response itself.
-->
<script lang="ts">
  import { t } from '$shared/i18n';
  import ResponseView from './ResponseView.svelte';
  import { requestRuntime } from '$entities/request';
  import type { Tab } from '$shared/model';

  let {
    tab,
    onResize,
    onResetSize,
    onSettings,
  }: {
    tab: Tab;
    onResize: (e: PointerEvent) => void;
    onResetSize: () => void;
    onSettings: () => void;
  } = $props();

  const sending = $derived(!!requestRuntime.busy[tab.id] && requestRuntime.busy[tab.id]?.kind !== 'connect');
  // A stream shows its own live feed; the indeterminate bar is for request/response calls.
  const progress = $derived(sending && !tab.grpcStream && !tab.sseLive);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bs-resizer-row"
  role="separator"
  aria-orientation="horizontal"
  aria-label={t('response.resize')}
  onpointerdown={onResize}
  ondblclick={onResetSize}
></div>
{#if progress}<div class="bs-resp-progress" aria-hidden="true"><span></span></div>{/if}
<div class="bs-resp" class:sending>
  <ResponseView {tab} {onSettings} />
</div>

<style>
  /* Response: status pills, body/raw/headers/timeline views, empty and error states, large-body tools. */
  .bs-resizer-row {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 5;
    cursor: row-resize;
    background: transparent;
    transition: background 120ms ease;
    top: -3px;
    height: 6px;
  }

  .bs-resizer-row:hover {
    background: linear-gradient(
      to bottom,
      transparent calc(50% - 1px),
      var(--accent) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    );
  }

  :global(.bs) .bs-resizer-row {
    position: absolute;
    z-index: 2;
    left: 0;
    right: 0;
    top: -8px;
    height: 8px;
    border-radius: 0;
  }

  .bs-resizer-row::after {
    display: none;
  }

  /* Empty-state artwork yields space when the response splitter is dragged up. */
  .bs-resp {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    border: 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-sidebar);
    overflow: hidden;
    container: response / size;
  }

  :global(.bs[data-focus]) .bs-resizer-row {
    display: none;
  }

  /* S04: indeterminate progress rides on top of the card while a request is in flight. */
  .bs-resp-progress {
    flex: none;
    height: 3px;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: var(--color-selected);
  }

  .bs-resp-progress :global(span) {
    display: block;
    width: 36%;
    height: 100%;
    border-radius: var(--radius-control);
    background: linear-gradient(90deg, transparent, var(--color-text-secondary));
    animation: bs-progress 1.4s var(--ease-soft) infinite;
  }
</style>
