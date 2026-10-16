<script lang="ts">
  /** The response folded into a 44 px strip (E1/E3 rule 1): status, time, size, first line, «Показать ответ ⇧⌘R». */
  import { t } from '$shared/i18n';
  import { hotkeys, formatBinding } from '$shared/settings';
  import { grpcCodeTone, requestRuntime } from '$entities/request';
  import { elapsedLabel, formatBytes, grpcStatusLabel, HTTP_STATUS_TEXT, type Tab } from '$shared/model';
  import { oneLinePreview } from '$shared/ui';
  import { presentGrpcError } from './grpcError';
  import { isCancelled, responseTone } from './responseHint';
  import { Strip, StatusPill } from '$shared/ui/components';

  let { tab, onShow }: { tab: Tab; onShow: () => void } = $props();

  const sending = $derived(!!requestRuntime.busy[tab.id] && requestRuntime.busy[tab.id]?.kind !== 'connect');
  const info = $derived.by(() => {
    if (tab.protocol === 'grpc') {
      const r = tab.grpcResult;
      if (!r) return undefined;
      const code = r.ok ? 'OK' : presentGrpcError(r.status, r.body).code;
      const tone = r.ok ? 'success' : grpcCodeTone(code);
      return {
        tone,
        glyph: r.ok ? '✓' : tone === 'warning' ? '!' : '×',
        status: grpcStatusLabel(code),
        ms: r.elapsed_ms,
        size: r.ok || r.size_bytes ? formatBytes(r.size_bytes) : '—',
        body: r.body,
      };
    }
    const r = tab.response;
    if (!r) return undefined;
    const tone = responseTone(r);
    const status = r.status
      ? `${r.status} ${HTTP_STATUS_TEXT[r.status] ?? ''}`.trim()
      : isCancelled(r)
        ? t('response.status.cancelled')
        : t('response.status.none');
    return {
      tone,
      glyph: tone === 'success' ? '✓' : r.status ? '!' : '×',
      status,
      ms: r.elapsed_ms,
      size: r.status ? formatBytes(r.size_bytes) : '—',
      body: r.body,
    };
  });
  const preview = $derived(info ? oneLinePreview(info.body) : '');
  // SC7: with scripts, the strip reports the checks and the first failure instead of the body.
  const tests = $derived(tab.testResults?.tests ?? []);
  const failed = $derived(tests.filter((x) => !x.passed));
  const firstFailure = $derived(failed[0] ? `${failed[0].name} — ${failed[0].error ?? ''}` : '');
</script>

<Strip role="group" aria-label={t('lb.strip.response')}>
  <span class="label">{t('lb.strip.response')}</span>
  {#if sending}
    <StatusPill class="sending"><span class="g" aria-hidden="true">◌</span>{t('response.sending')}</StatusPill>
  {:else if info}
    <StatusPill class={info.tone}><span class="g" aria-hidden="true">{info.glyph}</span>{info.status}</StatusPill>
    <span class="meta">{`${elapsedLabel(info.ms)}  ·  ${info.size}`}</span>
    {#if tests.length}
      <span class="tests"
        >{t('response.tab.tests')}<span class="ok">{`✓ ${tests.length - failed.length}`}</span>{#if failed.length}<span
            class="bad">{`× ${failed.length}`}</span
          >{/if}</span
      >
      {#if firstFailure}<span class="preview fail" title={firstFailure}>{`× ${firstFailure}`}</span>{:else}<span
          class="preview"
          title={preview}>{preview}</span
        >{/if}
    {:else}
      <span class="preview" title={preview}>{preview}</span>
    {/if}
  {:else}
    <span class="preview">{t('lb.strip.noResponse')}</span>
  {/if}
  <button type="button" class="act" onclick={onShow}>
    <span class="material-symbols-outlined" aria-hidden="true">expand_less</span>{t('lb.strip.showResponse')}<kbd
      >{formatBinding(hotkeys.current.toggleResponse ?? '').join('')}</kbd
    >
  </button>
</Strip>

<style>
  .tests {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    color: var(--t2);
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    font-size: var(--font-size-caption);
  }
  .tests .ok {
    color: var(--color-success);
  }
  .tests .bad {
    color: var(--color-danger);
  }
  .preview.fail {
    color: var(--t2);
  }
</style>
