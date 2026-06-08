<script lang="ts">
  import ResponseView from './ResponseView.svelte';
  import type { Tab } from '../domain/types';

  let {
    tab,
    responseHeight,
    onResize,
  }: {
    tab: Tab;
    responseHeight: number | null;
    onResize: (e: PointerEvent) => void;
  } = $props();
</script>

<div class="bs-resp" style={responseHeight == null ? '' : `flex:0 0 ${responseHeight}px`}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="bs-resizer-row" role="separator" aria-orientation="horizontal" aria-label="Resize response" onpointerdown={onResize}></div>
  <ResponseView {tab} />
</div>
