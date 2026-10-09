<script lang="ts">
  /**
   * HTTP request editor coordinator.
   *
   * Heavy request-editing surfaces live in `components/http/*`:
   * URL/send, tabs, params, headers, auth, and body each own their focused UI
   * and store writes. This component keeps only cross-pane UI state.
   */
  import { t } from '$shared/i18n';
  import { HttpAuthEditor } from '$entities/request/components';
  import HttpBodyEditor from './HttpBodyEditor.svelte';
  import HttpHeadersEditor from './HttpHeadersEditor.svelte';
  import HttpParamsEditor from './HttpParamsEditor.svelte';
  import HttpRequestTabs from './HttpRequestTabs.svelte';
  import { ScriptsEditor } from '$shared/editor/components';
  import HttpUrlBar from './HttpUrlBar.svelte';
  import { updateActiveTab } from '$entities/tab';
  import type { HttpEditorTab } from './httpEditor';
  import type { Tab } from '$shared/model';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  function setHttpScript(field: 'preRequestScript' | 'testScript', value: string): void {
    const next = value === '' ? undefined : value;
    updateActiveTab((t) => ({ ...t, request: { ...t.request, [field]: next } }));
  }

  let uiTab = $state<HttpEditorTab>('params');
</script>

<HttpUrlBar {tab} bind:methodOpen />
<HttpRequestTabs {tab} bind:uiTab />

<div class="bs-reqpane" role="tabpanel" id="bs-reqpanel" aria-labelledby="bs-rtab-{uiTab}">
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
    <div class="bs-pwrap">
      <div class="bs-empty">
        <b style="margin-bottom:4px">{t('http.empty.title', { tab: t('http.tabs.' + uiTab) })}</b>
        <p>{t('http.empty.body', { tab: t('http.tabs.' + uiTab) })}</p>
      </div>
    </div>
  {/if}
</div>
