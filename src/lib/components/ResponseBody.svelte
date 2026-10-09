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
   * «ещё N объектов» chips for long arrays; pretty JSON also gets the JSONPath filter row (rule 8). Bodies CodeMirror
   * can't take well (minified multi-MB single lines, small markup) fall back to the chunked HTML renderer.
   */
  import CodeEditor from './CodeEditor.svelte';
  import { buildDoc, buildView, CM_PARSE_BUDGET, DISPLAY_CHARS } from '../domain/responseRender';
  import { applyFilter } from '../domain/jsonFilter';
  import { textStats } from '../domain/largeBody';
  import { countLabel } from '../editor/largeFold';
  import { t } from '../i18n';
  import { responseLineWrap, uiLanguage } from '../stores';

  /** Above this the lezer parser's background work causes visible hitches; use the viewport tokenizer. */
  const LITE_CHARS = 1_000_000;

  let {
    source,
    contentType,
    mode,
    filterable = true,
    info = $bindable(),
  }: {
    source: { body: string };
    contentType: string;
    mode: 'pretty' | 'raw';
    filterable?: boolean;
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

  // ---- JSONPath filter (pretty JSON only, bounded by CM_PARSE_BUDGET) ----
  let input = $state('');
  let applied = $state('');
  $effect(() => {
    void source;
    input = '';
    applied = '';
  });
  $effect(() => {
    const v = input;
    const id = setTimeout(() => (applied = v), 250);
    return () => clearTimeout(id);
  });
  const showFilter = $derived(filterable && mode === 'pretty' && doc?.format === 'JSON');
  const tooLarge = $derived(source.body.length > CM_PARSE_BUDGET);
  const outcome = $derived(showFilter && !tooLarge ? applyFilter(source, applied) : ({ kind: 'none' } as const));
  const text = $derived(outcome.kind === 'ok' ? outcome.text : (doc?.text ?? ''));
  const lines = $derived(doc ? textStats(text).lines : 0);

  $effect(() => {
    info = { cm: !!doc, lines, capped: doc ? doc.truncated && outcome.kind !== 'ok' : !!legacy?.truncated, shown: doc ? doc.text.length : DISPLAY_CHARS };
  });
</script>

<div class="lb-resp-body">
  {#if showFilter}
    <div class="lb-jp">
      <span class="material-symbols-outlined lead" aria-hidden="true">filter_alt</span>
      <input
        type="text"
        spellcheck="false"
        autocomplete="off"
        aria-label={$t('lb.jp.label')}
        placeholder={$t('lb.jp.placeholder')}
        title={tooLarge ? $t('lb.jp.tooLarge') : ''}
        disabled={tooLarge}
        bind:value={input}
        onkeydown={(e) => { if (e.key === 'Escape' && input) { e.preventDefault(); input = applied = ''; } }}
      />
      {#if outcome.kind === 'error'}<span class="err" role="status">{outcome.error === 'Not JSON' ? $t('lb.jp.notJson') : outcome.error}</span>{/if}
      {#if outcome.kind === 'ok'}<span class="chip" role="status">{outcome.matches === 0 ? $t('lb.jp.none') : countLabel(outcome.matches, 'matches', $uiLanguage)}</span>{/if}
      {#if input}
        <button type="button" class="lb-ic sm" aria-label={$t('lb.jp.clear')} title={$t('lb.jp.clear')} onclick={() => (input = applied = '')}><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
      {/if}
      <span class="hint">{$t('lb.jp.hint')}</span>
    </div>
  {/if}
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
        autoFold={mode === 'pretty' && outcome.kind !== 'ok'}
        wrap={$responseLineWrap}
        docId={`r${sourceId}:${mode}:${applied}`}
        ariaLabel={$t('lb.section.response')}
      />
    </div>
  {:else if legacy}
    <div class="bs-rbody pretty">
      {#if legacy.kind === 'plain'}
        <div class="bs-response-editor" class:wrap={$responseLineWrap}>
          <div class="bs-response-gutter" aria-hidden="true">{#each legacy.lines as n}<div>{n}</div>{/each}</div>
          <div class="bs-code">{@html legacy.html}</div>
        </div>
      {:else if legacy.kind === 'lines'}
        <div class="bs-response-editor chunked" class:wrap={$responseLineWrap}>
          {#each legacy.chunks as c (c.firstLine)}
            <div class="bs-resp-chunk" style="contain-intrinsic-size: auto {c.estPx}px">
              <div class="bs-response-gutter" aria-hidden="true">{#each c.gutter as n}<div>{n}</div>{/each}</div>
              <div class="bs-code">{@html c.html}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="bs-response-editor chunked chars">
          {#each legacy.chunks as c (c.offset)}
            <div class="bs-resp-cchunk" style="contain-intrinsic-size: auto {c.estPx}px"><div class="bs-code">{@html c.html}</div></div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
