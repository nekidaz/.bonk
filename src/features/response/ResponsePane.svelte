<script lang="ts">
  import { t } from '$shared/i18n';
  import ResponseView from './ResponseView.svelte';
  import { busyMap } from '$entities/request';
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

  const sending = $derived(!!$busyMap[tab.id] && $busyMap[tab.id]?.kind !== 'connect');
  // A stream shows its own live feed; the indeterminate bar is for request/response calls.
  const progress = $derived(sending && !tab.grpcStream);
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
