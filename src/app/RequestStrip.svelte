<script lang="ts">
  /**
   * The request folded into a 44 px strip while the response owns the height (E4/E5 rule 7):
   * Body / Headers / Params chips (Message / Metadata for gRPC), a one-line preview and “Show body ⇧⌘E”.
   */
  import { tick } from 'svelte';
  import { t } from '$shared/i18n';
  import { hotkeys, formatBinding } from '$shared/settings';
  import { formatBytes, currentBodyMode, type Tab } from '$shared/model';
  import { oneLinePreview } from '$shared/ui';
  import { bodyKindLabel } from '$shared/editor';
  import { grpcInputType, openGrpcEditorSection, type GrpcEditorSection } from '$entities/request';
  import { Strip } from '$shared/ui/components';

  let { tab, onShow }: { tab: Tab; onShow: () => void } = $props();

  const grpc = $derived(tab.protocol === 'grpc');
  const body = $derived(grpc ? (tab.grpc?.message ?? '') : (tab.request.body ?? ''));
  const noBody = $derived(!grpc && currentBodyMode(tab) === 'none');
  const chips = $derived(
    grpc
      ? [
          {
            id: 'message',
            label: 'Message',
            value: body ? [grpcInputType(tab.grpc), formatBytes(body.length)].filter(Boolean).join(' · ') : '—',
          },
          { id: 'metadata', label: 'Metadata', value: String(Object.keys(tab.grpc?.metadata ?? {}).length) },
        ]
      : [
          { id: 'body', label: 'Body', value: noBody ? '—' : `${bodyKindLabel(tab)} · ${formatBytes(body.length)}` },
          { id: 'headers', label: 'Headers', value: String(Object.keys(tab.request.headers ?? {}).length) },
          {
            id: 'params',
            label: 'Params',
            value: String((tab.params ?? []).filter((p) => p.enabled && p.key.trim()).length),
          },
        ],
  );
  const preview = $derived(noBody ? t('lb.strip.noBody') : oneLinePreview(body));

  async function open(section: string): Promise<void> {
    if (grpc) openGrpcEditorSection(tab.id, section as GrpcEditorSection);
    onShow();
    await tick();
    if (!grpc) document.getElementById(`bs-rtab-${section}`)?.click();
  }
</script>

<Strip class="req" role="group" aria-label={t('lb.strip.request')}>
  <span class="label">{t('lb.strip.request')}</span>
  {#each chips as c (c.id)}
    <button type="button" class="chip" onclick={() => open(c.id)}>{c.label}<b>{c.value}</b></button>
  {/each}
  <span class="preview" title={preview}>{preview}</span>
  <button
    type="button"
    class="act"
    aria-label={t('lb.strip.showBody')}
    title={t('lb.strip.showBody')}
    onclick={() => open(grpc ? 'message' : 'body')}
  >
    <span class="material-symbols-outlined" aria-hidden="true">expand_more</span><span class="lbl"
      >{t('lb.strip.showBody')}</span
    ><kbd>{formatBinding(hotkeys.current.toggleRequest ?? '').join('')}</kbd>
  </button>
</Strip>

<style>
  :global(:root .lb-strip.req) {
    margin: 10px 20px 10px;
    background: var(--color-field);
  }

  @media (max-width: 760px) {
    :global(:root .lb-strip.req) {
      gap: 8px;
    }

    :global(:root .lb-strip.req :is(.label, .act .lbl, .act kbd)) {
      display: none;
    }

    :global(:root .lb-strip.req .act) {
      width: 30px;
      padding: 0;
      justify-content: center;
    }
  }
</style>
