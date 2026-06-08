<script lang="ts">
  import { autoHeaderRows } from '../../domain/httpHeaders';
  import type { HttpEditorTab } from '../../domain/httpEditor';
  import type { Tab } from '../../domain/types';

  let { tab, uiTab = $bindable() }: { tab: Tab; uiTab: HttpEditorTab } = $props();
</script>

<div class="bs-rtabs">
  <div class="bs-rtab docs"><span class="material-symbols-outlined" style="font-size:14px">notes</span>Docs</div>
  <button class="bs-rtab" class:on={uiTab === 'params'} onclick={() => (uiTab = 'params')}>Params</button>
  <button class="bs-rtab" class:on={uiTab === 'auth'} onclick={() => (uiTab = 'auth')}>Authorization</button>
  <button class="bs-rtab" class:on={uiTab === 'headers'} onclick={() => (uiTab = 'headers')}>Headers <span class="bs-tab-count">{Object.keys(tab.request.headers ?? {}).length + autoHeaderRows(tab).length}</span></button>
  <button class="bs-rtab" class:on={uiTab === 'body'} onclick={() => (uiTab = 'body')}>Body</button>
  <div class="bs-rtab">Scripts</div>
  <div class="bs-rtab">Settings</div>
  <span class="bs-cookies">Cookies</span>
</div>
