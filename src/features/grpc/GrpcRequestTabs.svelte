<script lang="ts">
  /**
   * The gRPC request tabs row (Message / Metadata / Auth / Proto / Scripts).
   * A large message also moves its type, size, line count and editor tools
   * into this row (E2 rules 2, 3, 6) — `messageStats` is set only then.
   */
  import { t, uiLanguage } from '$shared/i18n';
  import { focusMode, toggleFocus, tablist } from '$shared/ui';
  import { formatBytes, SCRIPTS_ENABLED, type Tab, type GrpcMethod } from '$shared/model';
  import { countLabel, type TextStats } from '$shared/editor';
  import { openGrpcEditorSection, type GrpcEditorSection } from '$entities/request';
  import { EditorTools } from '$shared/editor/components';

  let {
    tab,
    section,
    metadataCount,
    messageStats,
    selectedMethod,
    onLoadExample,
  }: {
    tab: Tab;
    section: GrpcEditorSection;
    metadataCount: number;
    messageStats: TextStats | undefined;
    selectedMethod: GrpcMethod | undefined;
    onLoadExample: () => void;
  } = $props();
</script>

{#snippet gtab(id: GrpcEditorSection, label: string, count = 0, bad = false)}
  <button
    class="bs-rtab"
    class:on={section === id}
    role="tab"
    id="bs-gtab-{id}"
    aria-selected={section === id}
    aria-controls="bs-grpcpanel"
    tabindex={section === id ? 0 : -1}
    onclick={() => openGrpcEditorSection(tab.id, id)}
    >{label}{#if count}<span class="bs-tab-count" class:bad>{count}</span>{/if}</button
  >
{/snippet}
<div class="lb-tabrow">
  <div class="bs-rtabs" role="tablist" aria-label={t('grpc.tab.request')} use:tablist>
    {@render gtab('message', t('grpc.tab.message'))}
    {@render gtab('metadata', t('grpc.tab.metadata'), metadataCount)}
    {@render gtab('auth', t('grpc.tab.auth'))}
    {@render gtab('proto', t('grpc.tab.proto'))}
    <!-- Flow · Скрипты: gRPC requests run the same scripts (pm.request.url is read-only there). -->
    {#if SCRIPTS_ENABLED}{@render gtab(
        'scripts',
        t('grpc.tab.scripts'),
        (tab.grpc?.preRequestScript?.trim() ? 1 : 0) + (tab.grpc?.testScript?.trim() ? 1 : 0),
        !!tab.testResults?.error,
      )}{/if}
  </div>
  {#if messageStats}
    <div class="lb-tabrow-tools">
      {#if selectedMethod?.inputType}
        <span class="lb-msgtype" title={selectedMethod.inputType}
          ><span class="material-symbols-outlined" aria-hidden="true">description</span>{selectedMethod.inputType
            .split('.')
            .pop()}</span
        >
      {/if}
      <span class="lb-stats"
        >{`${messageStats.approx ? '~' : ''}${formatBytes(messageStats.bytes)}  ·  ${countLabel(messageStats.lines, 'lines', uiLanguage.current)}`}</span
      >
      <EditorTools
        scope="#bs-grpcpanel"
        onExpand={() => (focusMode.current = toggleFocus(focusMode.current, 'request'))}
        expanded={focusMode.current === 'request'}
      >
        {#snippet extra()}
          <button
            type="button"
            class="bs-ric bs-grpc-example"
            aria-label={t('grpc.msg.example')}
            title={t('grpc.msg.example')}
            onclick={onLoadExample}
            ><span class="material-symbols-outlined" aria-hidden="true">description</span></button
          >
        {/snippet}
      </EditorTools>
    </div>
  {/if}
</div>
