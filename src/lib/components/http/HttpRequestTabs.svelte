<script lang="ts">
  import { autoHeaderRows } from '../../domain/httpHeaders';
  import type { HttpEditorTab } from '../../domain/httpEditor';
  import type { Tab } from '../../domain/types';

  let { tab, uiTab = $bindable() }: { tab: Tab; uiTab: HttpEditorTab } = $props();

  const scriptCount = $derived(
    (tab.request.preRequestScript?.trim() ? 1 : 0) + (tab.request.testScript?.trim() ? 1 : 0),
  );
</script>

<div class="bs-rtabs">
  <button class="bs-rtab" class:on={uiTab === 'params'} onclick={() => (uiTab = 'params')}>Params</button>
  <button class="bs-rtab" class:on={uiTab === 'auth'} onclick={() => (uiTab = 'auth')}>Authorization</button>
  <button class="bs-rtab" class:on={uiTab === 'headers'} onclick={() => (uiTab = 'headers')}>Headers <span class="bs-tab-count">{Object.keys(tab.request.headers ?? {}).length + autoHeaderRows(tab).length}</span></button>
  <button class="bs-rtab" class:on={uiTab === 'body'} onclick={() => (uiTab = 'body')}>Body</button>
  <button class="bs-rtab" class:on={uiTab === 'scripts'} onclick={() => (uiTab = 'scripts')}>Scripts{#if scriptCount > 0}<span class="bs-tab-count">{scriptCount}</span>{/if}</button>
</div>
