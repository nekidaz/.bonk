<script lang="ts">
  /**
   * HTTP request editor coordinator.
   *
   * Heavy request-editing surfaces live in `components/http/*`:
   * URL/send, tabs, params, headers, auth, and body each own their focused UI
   * and store writes. This component keeps only cross-pane UI state.
   */
  import HttpAuthEditor from './http/HttpAuthEditor.svelte';
  import HttpBodyEditor from './http/HttpBodyEditor.svelte';
  import HttpHeadersEditor from './http/HttpHeadersEditor.svelte';
  import HttpParamsEditor from './http/HttpParamsEditor.svelte';
  import HttpRequestTabs from './http/HttpRequestTabs.svelte';
  import ScriptsEditor from './ScriptsEditor.svelte';
  import HttpUrlBar from './http/HttpUrlBar.svelte';
  import { updateActiveTab } from '../stores';
  import type { HttpEditorTab } from '../domain/httpEditor';
  import type { Tab } from '../domain/types';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  function setHttpScript(field: 'preRequestScript' | 'testScript', value: string): void {
    const next = value === '' ? undefined : value;
    updateActiveTab((t) => ({ ...t, request: { ...t.request, [field]: next } }));
  }

  let uiTab = $state<HttpEditorTab>('params');
</script>

<HttpUrlBar {tab} bind:methodOpen />
<HttpRequestTabs {tab} bind:uiTab />

<div class="bs-reqpane">
  {#if uiTab === 'body'}
    <HttpBodyEditor {tab} />
  {:else if uiTab === 'auth'}
    <HttpAuthEditor {tab} />
  {:else if uiTab === 'headers'}
    <HttpHeadersEditor {tab} />
  {:else if uiTab === 'params'}
    <HttpParamsEditor {tab} />
  {:else if uiTab === 'scripts'}
    <ScriptsEditor
      preRequestScript={tab.request.preRequestScript ?? ''}
      testScript={tab.request.testScript ?? ''}
      onPreRequestChange={(v) => setHttpScript('preRequestScript', v)}
      onTestChange={(v) => setHttpScript('testScript', v)}
      docId={tab.id}
    />
  {:else}
    <div class="bs-pwrap"><div class="bs-empty"><b style="margin-bottom:4px">No {uiTab}</b><p>This request has no {uiTab} configured.</p></div></div>
  {/if}
</div>
