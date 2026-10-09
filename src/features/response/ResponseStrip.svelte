<script lang="ts">
  /** The response folded into a 44 px strip (E1/E3 rule 1): status, time, size, first line, «Показать ответ ⇧⌘R». */
  import { t } from '$shared/i18n';
  import { hotkeys, formatBinding } from '$shared/settings';
  import { busyMap, grpcCodeTone } from '$entities/request';
  import { formatBytes, type Tab } from '$shared/model';
  import { oneLinePreview } from '$shared/ui';
  import { presentGrpcError } from './grpcError';
  import { isCancelled, responseTone } from './responseHint';
  import { HTTP_STATUS_TEXT, elapsedLabel, grpcStatusLabel } from './statusLabel';

  let { tab, onShow }: { tab: Tab; onShow: () => void } = $props();

  const sending = $derived(!!$busyMap[tab.id] && $busyMap[tab.id]?.kind !== 'connect');
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
        ? $t('response.status.cancelled')
        : $t('response.status.none');
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
</script>

<div class="lb-strip" role="group" aria-label={$t('lb.strip.response')}>
  <span class="label">{$t('lb.strip.response')}</span>
  {#if sending}
    <span class="bs-stpill sending"><span class="g" aria-hidden="true">◌</span>{$t('response.sending')}</span>
  {:else if info}
    <span class="bs-stpill {info.tone}"><span class="g" aria-hidden="true">{info.glyph}</span>{info.status}</span>
    <span class="meta">{`${elapsedLabel(info.ms)}  ·  ${info.size}`}</span>
    <span class="preview" title={preview}>{preview}</span>
  {:else}
    <span class="preview">{$t('lb.strip.noResponse')}</span>
  {/if}
  <button type="button" class="act" onclick={onShow}>
    <span class="material-symbols-outlined" aria-hidden="true">expand_less</span>{$t('lb.strip.showResponse')}<kbd
      >{formatBinding($hotkeys.toggleResponse ?? '').join('')}</kbd
    >
  </button>
</div>
