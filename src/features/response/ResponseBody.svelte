<script lang="ts" module>
  export interface BodyInfo {
    /** Rendered by CodeMirror (Find / Fold available). */
    cm: boolean;
    /** Lines in the shown text (CodeMirror path only). */
    lines: number;
    /** The shown text was cut to the render cap; `shown` chars are rendered. */
    capped: boolean;
    shown: number;
  }
</script>

<script lang="ts">
  /**
   * Response body viewer shared by HTTP and gRPC (E4/E5): a read-only CodeMirror with ⌘F search, fold gutter and
   * «ещё N объектов» chips for long arrays. Bodies CodeMirror
   * can't take well (minified multi-MB single lines, small markup) fall back to the chunked HTML renderer.
   */
  import { CodeEditor } from '$shared/editor/components';
  import { buildDoc, buildView, DISPLAY_CHARS } from './responseRender';
  import { textStats } from '$shared/editor';
  import { t } from '$shared/i18n';
  import { responseLineWrap } from '$shared/settings';

  /** Above this the lezer parser's background work causes visible hitches; use the viewport tokenizer. */
  const LITE_CHARS = 1_000_000;

  let {
    source,
    contentType,
    mode,
    info = $bindable(),
  }: {
    source: { body: string };
    contentType: string;
    mode: 'pretty' | 'raw';
    info?: BodyInfo;
  } = $props();

  // Stable id per response object so CodeMirror rebuilds its state (fresh scroll / folds) for each response.
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const sourceId = $derived.by(() => {
    if (!ids.has(source)) ids.set(source, nextId++);
    return ids.get(source)!;
  });

  const doc = $derived(buildDoc(source, contentType, mode));
  const legacy = $derived(doc ? undefined : buildView(source, contentType, mode));

  const text = $derived(doc?.text ?? '');
  const lines = $derived(doc ? textStats(text).lines : 0);

  $effect(() => {
    info = {
      cm: !!doc,
      lines,
      capped: doc ? doc.truncated : !!legacy?.truncated,
      shown: doc ? doc.text.length : DISPLAY_CHARS,
    };
  });
</script>

<div class="lb-resp-body">
  {#if doc}
    <div class="lb-viewer">
      <CodeEditor
        value={text}
        onChange={() => {}}
        lang={doc.format !== 'JSON' ? 'text' : text.length > LITE_CHARS ? 'json-lite' : 'json'}
        readOnly
        bare
        fill
        folding
        autoFold={mode === 'pretty'}
        wrap={$responseLineWrap}
        docId={`r${sourceId}:${mode}`}
        ariaLabel={$t('lb.section.response')}
      />
    </div>
  {:else if legacy}
    <div class="bs-rbody pretty">
      {#if legacy.kind === 'plain'}
        <div class="bs-response-editor" class:wrap={$responseLineWrap}>
          <div class="bs-response-gutter" aria-hidden="true">
            {#each legacy.lines as n}<div>{n}</div>{/each}
          </div>
          <div class="bs-code">{@html legacy.html}</div>
        </div>
      {:else if legacy.kind === 'lines'}
        <div class="bs-response-editor chunked" class:wrap={$responseLineWrap}>
          {#each legacy.chunks as c (c.firstLine)}
            <div class="bs-resp-chunk" style="contain-intrinsic-size: auto {c.estPx}px">
              <div class="bs-response-gutter" aria-hidden="true">
                {#each c.gutter as n}<div>{n}</div>{/each}
              </div>
              <div class="bs-code">{@html c.html}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="bs-response-editor chunked chars">
          {#each legacy.chunks as c (c.offset)}
            <div class="bs-resp-cchunk" style="contain-intrinsic-size: auto {c.estPx}px">
              <div class="bs-code">{@html c.html}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
