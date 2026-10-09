<script lang="ts">
  /**
   * The one row left in expanded mode (E3 / E6, 56 px): method + address, section, size, editor tools,
   * «Свернуть Esc» and Send. Send clicks the hidden editor's own Send button, so cancel / stream states stay its job.
   */
  import { t } from '../i18n';
  import { busyMap } from '../requestRuntime';
  import { updateTabById, uiLanguage } from '../stores';
  import { focusMode } from '../stores/ui';
  import { formatBytes } from '../domain/http';
  import { methodColor } from '../domain/method';
  import { methodShort } from '../domain/grpc';
  import { currentBodyMode, currentRawFormat } from '../domain/httpBody';
  import { beautify, bodyKindLabel, BEAUTIFY_MAX_CHARS, textStats } from '../domain/largeBody';
  import { countLabel } from '../editor/largeFold';
  import EditorTools from './EditorTools.svelte';
  import type { Tab } from '../domain/types';

  let { tab, mode }: { tab: Tab; mode: 'request' | 'response' } = $props();

  const grpc = $derived(tab.protocol === 'grpc');
  const busy = $derived(!!$busyMap[tab.id] && $busyMap[tab.id]?.kind !== 'connect');
  const body = $derived(grpc ? (tab.grpc?.message ?? '') : (tab.request.body ?? ''));
  const stats = $derived(mode === 'request' ? textStats(body) : undefined);
  const address = $derived(grpc ? `${tab.grpc?.endpoint ?? ''}  ${methodShort(tab.grpc?.method ?? '')}`.trim() : tab.request.url);
  const section = $derived(
    mode === 'response' ? $t('lb.section.response') : grpc ? $t('lb.section.message') : $t('lb.section.body', { fmt: bodyKindLabel(tab) }),
  );
  const canBeautify = $derived(!grpc && currentBodyMode(tab) === 'raw' && ['JSON', 'HTML', 'XML'].includes(currentRawFormat(tab)));

  function doBeautify(): void {
    try {
      const next = beautify(body, currentRawFormat(tab));
      updateTabById(tab.id, (x) => ({ ...x, request: { ...x.request, body: next } }));
    } catch {
      // The live JSON check underlines the problem.
    }
  }
  const send = () => document.querySelector<HTMLButtonElement>('.bs-send')?.click();
  // E2 rule 6: gRPC «Пример» is the editor's own button (hidden with the tabs row in this mode).
  const example = () => document.querySelector<HTMLButtonElement>('.bs-grpc-example')?.click();
</script>

<div class="lb-focusbar" role="toolbar" aria-label={section}>
  <span class="method" style:color={grpc ? 'var(--method-grpc)' : methodColor(tab.request.method)}>{grpc ? 'gRPC' : tab.request.method}</span>
  <span class="url" title={address}>{address}</span>
  <span class="section">{section}</span>
  {#if stats}<span class="stats">{`${stats.approx ? '~' : ''}${formatBytes(stats.bytes)}  ·  ${countLabel(stats.lines, 'lines', $uiLanguage)}`}</span>{/if}
  <span class="spacer"></span>
  {#if mode === 'request'}
    <EditorTools scope=".bs-reqpane" onBeautify={canBeautify ? doBeautify : undefined} beautifyTitle={body.length > BEAUTIFY_MAX_CHARS ? $t('lb.beautifyTooLarge') : ''}>
      {#snippet extra()}
        {#if grpc}<button type="button" class="bs-ric" aria-label={$t('grpc.msg.example')} title={$t('grpc.msg.example')} onclick={example}><span class="material-symbols-outlined" aria-hidden="true">description</span></button>{/if}
      {/snippet}
    </EditorTools>
  {/if}
  <button type="button" class="lb-collapse" onclick={() => focusMode.set(null)}>{$t('lb.collapse')}<kbd>Esc</kbd></button>
  <button type="button" class="lb-send" class:busy onclick={send}>{busy ? $t('common.cancel') : grpc ? $t('grpc.invoke') : $t('http.url.send')}{#if !busy}<kbd>⌘↵</kbd>{/if}</button>
</div>
