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
   * “N more objects” chips for long arrays. Bodies CodeMirror
   * can't take well (minified multi-MB single lines, small markup) fall back to the chunked HTML renderer.
   */
  import { CodeEditor } from '$shared/editor/components';
  import { buildDoc, buildView, DISPLAY_CHARS } from './responseRender';
  import { textStats } from '$shared/editor';
  import { t } from '$shared/i18n';
  import { requestPrefs } from '$shared/settings';
  import RespBody from './RespBody.svelte';
  import CodeBlock from './CodeBlock.svelte';

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
        wrap={requestPrefs.responseLineWrap.current}
        docId={`r${sourceId}:${mode}`}
        ariaLabel={t('lb.section.response')}
      />
    </div>
  {:else if legacy}
    <RespBody class="pretty">
      {#if legacy.kind === 'plain'}
        <div class="bs-response-editor" class:wrap={requestPrefs.responseLineWrap.current}>
          <div class="bs-response-gutter" aria-hidden="true">
            {#each legacy.lines as n}<div>{n}</div>{/each}
          </div>
          <CodeBlock>{@html legacy.html}</CodeBlock>
        </div>
      {:else if legacy.kind === 'lines'}
        <div class="bs-response-editor chunked" class:wrap={requestPrefs.responseLineWrap.current}>
          {#each legacy.chunks as c (c.firstLine)}
            <div class="bs-resp-chunk" style="contain-intrinsic-size: auto {c.estPx}px">
              <div class="bs-response-gutter" aria-hidden="true">
                {#each c.gutter as n}<div>{n}</div>{/each}
              </div>
              <CodeBlock>{@html c.html}</CodeBlock>
            </div>
          {/each}
        </div>
      {:else}
        <div class="bs-response-editor chunked chars">
          {#each legacy.chunks as c (c.offset)}
            <div class="bs-resp-cchunk" style="contain-intrinsic-size: auto {c.estPx}px">
              <CodeBlock>{@html c.html}</CodeBlock>
            </div>
          {/each}
        </div>
      {/if}
    </RespBody>
  {/if}
</div>

<style>
  .bs-response-editor :global(.bs-code) {
    min-width: 0;
    padding: 12px 16px 18px;
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
  }

  .bs-response-editor.wrap :global(.bs-code) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Chunked rendering for large responses: each chunk is its own gutter+code
     grid row with `content-visibility: auto`, so the webview skips layout/paint/
     GPU compositing for off-screen chunks. Keeps memory bounded and avoids the
     giant single-layer texture that crashes WKWebView on huge bodies. */
  .bs-response-editor.chunked {
    display: block;
    padding: 12px 0 18px;
  }

  .bs-response-editor.chunked .bs-resp-chunk {
    display: grid;
    content-visibility: auto;
  }

  .bs-response-editor.chunked .bs-response-gutter {
    padding: 0 10px 0 0;
  }

  .bs-response-editor.chunked :global(.bs-code) {
    padding: 0 16px;
  }

  /* Char-chunked path (very long lines, e.g. minified JSON): no per-line gutter,
     always soft-wrapped so a single multi-MB line can't blow out the layer. */
  .bs-response-editor.chars .bs-resp-cchunk {
    content-visibility: auto;
  }

  .bs-response-editor.chars :global(.bs-code) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .bs-response-editor {
    position: relative;
    min-height: 100%;
    display: grid;
    background: var(--canvas);
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .bs-response-gutter {
    position: sticky;
    left: 0;
    z-index: 1;
    padding: 12px 10px 18px 0;
    user-select: none;
    background: var(--canvas);
    border-right: 1px solid var(--sepsoft);
    width: 44px;
    padding-right: 12px;
    color: var(--color-text-muted);
    font: var(--font-size-body)/20px var(--font-code);
    text-align: right;
  }

  :global(.bs) .bs-response-editor :global(:is(.bs-code, .bs-response-gutter)) {
    padding-top: 0;
    padding-bottom: 0;
  }

  :global(.bs) .bs-response-editor :global(.bs-code) {
    padding-left: 0;
  }

  /* E4 rule 8 · response viewer */
  .lb-resp-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .lb-viewer {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .lb-viewer :global(.cm-gutters) {
    border-right: 0;
    background: transparent;
    color: var(--color-text-muted);
  }

  .lb-viewer :global(.cm-lineNumbers .cm-gutterElement) {
    min-width: 44px;
    padding: 0 8px 0 0;
    font: var(--font-size-body)/20px var(--font-code);
  }

  .lb-viewer :global(.cm-content) {
    font: var(--font-size-body)/20px var(--font-code);
  }
</style>
