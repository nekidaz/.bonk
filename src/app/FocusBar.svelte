<script lang="ts">
  /**
   * The one row left in expanded mode (E3 / E6, 56 px): method + address, section, size, editor tools,
   * «Свернуть Esc» and Send. Send clicks the hidden editor's own Send button, so cancel / stream states stay its job.
   */
  import { t, uiLanguage } from '$shared/i18n';
  import { methodShort, requestRuntime, scriptStage, scriptUi, setScriptStage } from '$entities/request';
  import { tabs } from '$entities/tab';
  import { focusMode } from '$shared/ui';
  import { formatBytes, methodColor, currentBodyMode, currentRawFormat, type Tab } from '$shared/model';
  import {
    beautify,
    bodyKindLabel,
    BEAUTIFY_MAX_CHARS,
    textStats,
    countLabel,
    scriptSnippetsExpanded,
  } from '$shared/editor';
  import { EditorTools, ScriptStageSwitch } from '$shared/editor/components';
  import { IconButton } from '$shared/ui/components';

  let { tab, mode }: { tab: Tab; mode: 'request' | 'response' } = $props();

  const grpc = $derived(tab.protocol === 'grpc');
  // SC8: the expanded Scripts tab keeps the address and swaps the section for the stage switch.
  const scripts = $derived(mode === 'request' && !!scriptUi.open[tab.id]);
  const stage = $derived(scriptStage(tab.id));
  const pre = $derived((grpc ? tab.grpc?.preRequestScript : tab.request.preRequestScript) ?? '');
  const post = $derived((grpc ? tab.grpc?.testScript : tab.request.testScript) ?? '');
  const scriptLines = $derived(((stage === 'pre' ? pre : post).match(/\n/g)?.length ?? 0) + 1);
  const busy = $derived(!!requestRuntime.busy[tab.id] && requestRuntime.busy[tab.id]?.kind !== 'connect');
  const body = $derived(grpc ? (tab.grpc?.message ?? '') : (tab.request.body ?? ''));
  const stats = $derived(mode === 'request' ? textStats(body) : undefined);
  const address = $derived(
    grpc ? `${tab.grpc?.endpoint ?? ''}  ${methodShort(tab.grpc?.method ?? '')}`.trim() : tab.request.url,
  );
  const section = $derived(
    mode === 'response'
      ? t('lb.section.response')
      : grpc
        ? t('lb.section.message')
        : t('lb.section.body', { fmt: bodyKindLabel(tab) }),
  );
  const canBeautify = $derived(
    !grpc && currentBodyMode(tab) === 'raw' && ['JSON', 'HTML', 'XML'].includes(currentRawFormat(tab)),
  );

  function doBeautify(): void {
    try {
      const next = beautify(body, currentRawFormat(tab));
      tabs.updateById(tab.id, (x) => ({ ...x, request: { ...x.request, body: next } }));
    } catch {
      // The live JSON check underlines the problem.
    }
  }
  const send = () => document.querySelector<HTMLButtonElement>('.bs-send')?.click();
  // E2 rule 6: gRPC «Пример» is the editor's own button (hidden with the tabs row in this mode).
  const example = () => document.querySelector<HTMLButtonElement>('.bs-grpc-example')?.click();
</script>

<div class="lb-focusbar" role="toolbar" aria-label={section}>
  <span class="method" style:color={grpc ? 'var(--method-grpc)' : methodColor(tab.request.method)}
    >{grpc ? 'gRPC' : tab.request.method}</span
  >
  <span class="url" title={address}>{address}</span>
  {#if scripts}
    <ScriptStageSwitch
      {stage}
      onStage={(s) => setScriptStage(tab.id, s)}
      has={{ pre: !!pre.trim(), post: !!post.trim() }}
      failed={tab.testResults?.error ? tab.testResults.errorPhase : undefined}
    />
    <span class="stats">{`JavaScript  ·  ${countLabel(scriptLines, 'lines', uiLanguage.current)}`}</span>
  {:else}
    <span class="section">{section}</span>
  {/if}
  {#if stats && !scripts}<span class="stats"
      >{`${stats.approx ? '~' : ''}${formatBytes(stats.bytes)}  ·  ${countLabel(stats.lines, 'lines', uiLanguage.current)}`}</span
    >{/if}
  <span class="spacer"></span>
  {#if scripts}
    <EditorTools scope=".bs-script-editor" format pill>
      {#snippet extra()}
        <IconButton
          type="button"
          class={{ on: scriptSnippetsExpanded.current }}
          aria-pressed={scriptSnippetsExpanded.current}
          aria-label={t('script.toggle_snippets')}
          title={t('script.toggle_snippets')}
          onclick={() => (scriptSnippetsExpanded.current = !scriptSnippetsExpanded.current)}
          ><span class="material-symbols-outlined" aria-hidden="true">data_object</span></IconButton
        >
      {/snippet}
    </EditorTools>
  {:else if mode === 'request'}
    <EditorTools
      scope=".bs-reqpane"
      onBeautify={canBeautify ? doBeautify : undefined}
      beautifyTitle={body.length > BEAUTIFY_MAX_CHARS ? t('lb.beautifyTooLarge') : ''}
    >
      {#snippet extra()}
        {#if grpc}<IconButton
            type="button"
            aria-label={t('grpc.msg.example')}
            title={t('grpc.msg.example')}
            onclick={example}><span class="material-symbols-outlined" aria-hidden="true">description</span></IconButton
          >{/if}
      {/snippet}
    </EditorTools>
  {/if}
  <button type="button" class="lb-collapse" onclick={() => (focusMode.current = null)}
    >{t('lb.collapse')}<kbd>Esc</kbd></button
  >
  <button type="button" class="lb-send" class:busy onclick={send}
    >{busy ? t('common.cancel') : grpc ? t('grpc.invoke') : t('http.url.send')}{#if !busy}<kbd>⌘↵</kbd>{/if}</button
  >
</div>

<style>
  .lb-focusbar :global(.spacer) {
    flex: 1;
  }

  /* E3 / E6 · expanded mode: one bar, no sidebar / header / address / request tabs */
  .lb-focusbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    height: 56px;
    margin: 0 10px;
    padding: 0 0 0 10px;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .lb-focusbar :global(.method) {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    font: 600 var(--font-size-caption) var(--font-code);
  }

  .lb-focusbar :global(.url) {
    flex: 0 1 auto;
    min-width: 60px;
    overflow: hidden;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lb-focusbar :global(.section) {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  .lb-focusbar :global(.stats) {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
    white-space: pre;
  }

  .lb-focusbar .lb-collapse {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  .lb-focusbar .lb-collapse:hover {
    background: var(--color-selected);
  }

  .lb-focusbar .lb-send {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 18px;
    border-radius: var(--radius-control);
    background: var(--color-action);
    color: var(--color-on-action);
    font: 600 var(--font-size-body) var(--font-ui);
  }

  .lb-focusbar .lb-send.busy {
    background: var(--color-selected);
    color: var(--color-text);
  }

  .lb-focusbar .lb-send :global(kbd) {
    color: inherit;
  }

  .lb-focusbar :global(:is(.lb-collapse, .lb-send):focus-visible) {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }
</style>
