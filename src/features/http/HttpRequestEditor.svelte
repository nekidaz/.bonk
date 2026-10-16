<script lang="ts">
  /**
   * HTTP request editor coordinator.
   *
   * Heavy request-editing surfaces live in `components/http/*`:
   * URL/send, tabs, params, headers, auth, and body each own their focused UI
   * and store writes. This component keeps only cross-pane UI state.
   */
  import { t } from '$shared/i18n';
  import { HttpAuthEditor, RequestScripts, KvPanel, ReqPane } from '$entities/request/components';
  import { scriptUi } from '$entities/request';
  import HttpBodyEditor from './HttpBodyEditor.svelte';
  import HttpHeadersEditor from './HttpHeadersEditor.svelte';
  import HttpParamsEditor from './HttpParamsEditor.svelte';
  import HttpRequestTabs from './HttpRequestTabs.svelte';
  import HttpUrlBar from './HttpUrlBar.svelte';
  import { tabs } from '$entities/tab';
  import type { HttpEditorTab } from './httpEditor';
  import type { Tab } from '$shared/model';
  import { EmptyState } from '$shared/ui/components';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  function setHttpScript(field: 'preRequestScript' | 'testScript', value: string): void {
    const next = value === '' ? undefined : value;
    tabs.updateActive((t) => ({ ...t, request: { ...t.request, [field]: next } }));
  }

  let uiTab = $state<HttpEditorTab>('params');
  // «Перейти к строке» from the response opens the Scripts tab; RequestScripts then reveals the line.
  $effect(() => {
    if (scriptUi.jump?.tabId === tab.id) uiTab = 'scripts';
  });
</script>

<HttpUrlBar {tab} bind:methodOpen />
<HttpRequestTabs {tab} bind:uiTab />

<ReqPane role="tabpanel" id="bs-reqpanel" aria-labelledby="bs-rtab-{uiTab}">
  {#if uiTab === 'body'}
    <HttpBodyEditor {tab} />
  {:else if uiTab === 'auth'}
    <HttpAuthEditor {tab} />
  {:else if uiTab === 'headers'}
    <HttpHeadersEditor {tab} />
  {:else if uiTab === 'params'}
    <HttpParamsEditor {tab} />
  {:else if uiTab === 'scripts'}
    <RequestScripts
      {tab}
      preRequestScript={tab.request.preRequestScript ?? ''}
      testScript={tab.request.testScript ?? ''}
      onPreRequestChange={(v) => setHttpScript('preRequestScript', v)}
      onTestChange={(v) => setHttpScript('testScript', v)}
    />
  {:else}
    <KvPanel>
      <EmptyState>
        <b style="margin-bottom:4px">{t('http.empty.title', { tab: t('http.tabs.' + uiTab) })}</b>
        <p>{t('http.empty.body', { tab: t('http.tabs.' + uiTab) })}</p>
      </EmptyState>
    </KvPanel>
  {/if}
</ReqPane>
