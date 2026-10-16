<script lang="ts">
  /**
   * The gRPC request tabs row (Message / Metadata / Auth / Proto / Scripts).
   * On the Message tab it also holds the message type and «Example» (`messageTools`);
   * a large message adds its size, line count and editor tools (E2 rules 2, 3, 6),
   * `messageStats` is set only then.
   */
  import { t } from '$shared/i18n';
  import { focusMode, toggleFocus } from '$shared/ui';
  import { formatBytes, SCRIPTS_ENABLED, type Tab, type GrpcMethod } from '$shared/model';
  import { countLabel, type TextStats } from '$shared/editor';
  import { openGrpcEditorSection, type GrpcEditorSection } from '$entities/request';
  import { EditorTools } from '$shared/editor/components';
  import { TabRow, TabRowTools, RTabs, RTab, TabCount, TabStats, BeautifyButton } from '$entities/request/components';
  import { IconButton } from '$shared/ui/components';

  let {
    tab,
    section,
    metadataCount,
    messageTools,
    messageStats,
    selectedMethod,
    onLoadExample,
  }: {
    tab: Tab;
    section: GrpcEditorSection;
    metadataCount: number;
    /** The message editor is shown (Message tab, schema chosen). */
    messageTools: boolean;
    messageStats: TextStats | undefined;
    selectedMethod: GrpcMethod | undefined;
    onLoadExample: () => void;
  } = $props();
</script>

{#snippet gtab(id: GrpcEditorSection, label: string, count = 0, bad = false)}
  <RTab
    class={{ on: section === id }}
    role="tab"
    id="bs-gtab-{id}"
    aria-selected={section === id}
    aria-controls="bs-grpcpanel"
    tabindex={section === id ? 0 : -1}
    onclick={() => openGrpcEditorSection(tab.id, id)}
    >{label}{#if count}<TabCount class={{ bad }}>{count}</TabCount>{/if}</RTab
  >
{/snippet}
<TabRow>
  <RTabs role="tablist" aria-label={t('grpc.tab.request')} tablist>
    {@render gtab('message', t('grpc.tab.message'))}
    {@render gtab('metadata', t('grpc.tab.metadata'), metadataCount)}
    {@render gtab('auth', t('grpc.tab.auth'))}
    {@render gtab('proto', t('grpc.tab.proto'))}
    <!-- Flow · Scripts: gRPC requests run the same scripts (pm.request.url is read-only there). -->
    {#if SCRIPTS_ENABLED}{@render gtab(
        'scripts',
        t('grpc.tab.scripts'),
        (tab.grpc?.preRequestScript?.trim() ? 1 : 0) + (tab.grpc?.testScript?.trim() ? 1 : 0),
        !!tab.testResults?.error,
      )}{/if}
  </RTabs>
  {#if messageTools}
    <TabRowTools>
      {#if selectedMethod?.inputType}
        <span class="lb-msgtype" title={selectedMethod.inputType}
          ><span class="material-symbols-outlined" aria-hidden="true">description</span>{selectedMethod.inputType
            .split('.')
            .pop()}</span
        >
      {/if}
      {#if !messageStats}
        <BeautifyButton class="bs-grpc-example" type="button" onclick={onLoadExample}
          ><span class="material-symbols-outlined" aria-hidden="true">description</span>{t(
            'grpc.msg.example',
          )}</BeautifyButton
        >
      {:else}
        <TabStats
          >{`${messageStats.approx ? '~' : ''}${formatBytes(messageStats.bytes)}  ·  ${countLabel(messageStats.lines, 'lines')}`}</TabStats
        >
        <EditorTools
          scope="#bs-grpcpanel"
          onExpand={() => (focusMode.current = toggleFocus(focusMode.current, 'request'))}
          expanded={focusMode.current === 'request'}
        >
          {#snippet extra()}
            <IconButton
              type="button"
              class="bs-grpc-example"
              aria-label={t('grpc.msg.example')}
              title={t('grpc.msg.example')}
              onclick={onLoadExample}
              ><span class="material-symbols-outlined" aria-hidden="true">description</span></IconButton
            >
          {/snippet}
        </EditorTools>
      {/if}
    </TabRowTools>
  {/if}
</TabRow>

<style>
  .lb-msgtype :global(.material-symbols-outlined) {
    font-size: 15px;
    color: var(--color-text-muted);
  }

  /* E2: request message type of the gRPC message. */
  .lb-msgtype {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    color: var(--color-text);
    font: 600 var(--font-size-caption) var(--font-code);
  }
</style>
