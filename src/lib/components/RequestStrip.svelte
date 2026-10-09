<script lang="ts">
  /**
   * The request folded into a 44 px strip while the response owns the height (E4/E5 rule 7):
   * Body / Headers / Params chips (Message / Metadata for gRPC), a one-line preview and «Показать тело ⇧⌘E».
   */
  import { tick } from 'svelte';
  import { t } from '../i18n';
  import { hotkeys } from '../stores';
  import { formatBinding } from '../domain/hotkeys';
  import { formatBytes } from '../domain/http';
  import { currentBodyMode } from '../domain/httpBody';
  import { oneLinePreview } from '../domain/focusMode';
  import { bodyKindLabel } from '../domain/largeBody';
  import { grpcInputType } from '../domain/grpc';
  import { openGrpcEditorSection, type GrpcEditorSection } from '../grpcEditorUi';
  import type { Tab } from '../domain/types';

  let { tab, onShow }: { tab: Tab; onShow: () => void } = $props();

  const grpc = $derived(tab.protocol === 'grpc');
  const body = $derived(grpc ? (tab.grpc?.message ?? '') : (tab.request.body ?? ''));
  const noBody = $derived(!grpc && currentBodyMode(tab) === 'none');
  const chips = $derived(
    grpc
      ? [
          { id: 'message', label: 'Message', value: body ? [grpcInputType(tab.grpc), formatBytes(body.length)].filter(Boolean).join(' · ') : '—' },
          { id: 'metadata', label: 'Metadata', value: String(Object.keys(tab.grpc?.metadata ?? {}).length) },
        ]
      : [
          { id: 'body', label: 'Body', value: noBody ? '—' : `${bodyKindLabel(tab)} · ${formatBytes(body.length)}` },
          { id: 'headers', label: 'Headers', value: String(Object.keys(tab.request.headers ?? {}).length) },
          { id: 'params', label: 'Params', value: String((tab.params ?? []).filter((p) => p.enabled && p.key.trim()).length) },
        ],
  );
  const preview = $derived(noBody ? $t('lb.strip.noBody') : oneLinePreview(body));

  async function open(section: string): Promise<void> {
    if (grpc) openGrpcEditorSection(tab.id, section as GrpcEditorSection);
    onShow();
    await tick();
    if (!grpc) document.getElementById(`bs-rtab-${section}`)?.click();
  }
</script>

<div class="lb-strip req" role="group" aria-label={$t('lb.strip.request')}>
  <span class="label">{$t('lb.strip.request')}</span>
  {#each chips as c (c.id)}
    <button type="button" class="chip" onclick={() => open(c.id)}>{c.label}<b>{c.value}</b></button>
  {/each}
  <span class="preview" title={preview}>{preview}</span>
  <button type="button" class="act" onclick={() => open(grpc ? 'message' : 'body')}>
    <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>{$t('lb.strip.showBody')}<kbd>{formatBinding($hotkeys.toggleRequest ?? '').join('')}</kbd>
  </button>
</div>
