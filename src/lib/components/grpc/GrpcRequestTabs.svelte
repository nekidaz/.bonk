<script lang="ts">
  /**
   * The gRPC request tabs row (Message / Metadata / Auth / Proto / Scripts).
   * A large message also moves its type, size, line count and editor tools
   * into this row (E2 rules 2, 3, 6) — `messageStats` is set only then.
   */
  import { t } from '../../i18n';
  import { uiLanguage } from '../../stores/prefs';
  import { focusMode } from '../../stores/ui';
  import { toggleFocus } from '../../domain/focusMode';
  import { formatBytes } from '../../domain/http';
  import { countLabel } from '../../editor/largeFold';
  import type { TextStats } from '../../domain/largeBody';
  import { SCRIPTS_ENABLED } from '../../domain/scripts';
  import { openGrpcEditorSection, type GrpcEditorSection } from '../../grpcEditorUi';
  import { tablist } from '../../tablist';
  import type { Tab, GrpcMethod } from '../../domain/types';
  import EditorTools from '../EditorTools.svelte';

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

{#snippet gtab(id: GrpcEditorSection, label: string, count = 0)}
  <button class="bs-rtab" class:on={section === id} role="tab" id="bs-gtab-{id}" aria-selected={section === id} aria-controls="bs-grpcpanel" tabindex={section === id ? 0 : -1} onclick={() => openGrpcEditorSection(tab.id, id)}>{label}{#if count}<span class="bs-tab-count">{count}</span>{/if}</button>
{/snippet}
<div class="lb-tabrow">
  <div class="bs-rtabs" role="tablist" aria-label={$t('grpc.tab.request')} use:tablist>
    {@render gtab('message', $t('grpc.tab.message'))}
    {@render gtab('metadata', $t('grpc.tab.metadata'), metadataCount)}
    {@render gtab('auth', $t('grpc.tab.auth'))}
    {@render gtab('proto', $t('grpc.tab.proto'))}
    <!-- Not in the S19 mock: kept only for requests that already carry scripts. -->
    {#if SCRIPTS_ENABLED && (tab.grpc?.preRequestScript || tab.grpc?.testScript || section === 'scripts')}{@render gtab('scripts', $t('grpc.tab.scripts'))}{/if}
  </div>
  {#if messageStats}
    <div class="lb-tabrow-tools">
      {#if selectedMethod?.inputType}
        <span class="lb-msgtype" title={selectedMethod.inputType}><span class="material-symbols-outlined" aria-hidden="true">description</span>{selectedMethod.inputType.split('.').pop()}</span>
      {/if}
      <span class="lb-stats">{`${messageStats.approx ? '~' : ''}${formatBytes(messageStats.bytes)}  ·  ${countLabel(messageStats.lines, 'lines', $uiLanguage)}`}</span>
      <EditorTools scope="#bs-grpcpanel" onExpand={() => focusMode.update((m) => toggleFocus(m, 'request'))} expanded={$focusMode === 'request'}>
        {#snippet extra()}
          <button type="button" class="bs-ric bs-grpc-example" aria-label={$t('grpc.msg.example')} title={$t('grpc.msg.example')} onclick={onLoadExample}><span class="material-symbols-outlined" aria-hidden="true">description</span></button>
        {/snippet}
      </EditorTools>
    </div>
  {/if}
</div>
