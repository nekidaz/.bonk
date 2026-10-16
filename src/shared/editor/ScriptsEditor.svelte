<script lang="ts">
  /**
   * The request's Scripts tab (Flow · Скрипты). Pre-request | Post-response segments with snippets on the
   * right (SC1–SC3); the last run marks `pm.test` lines green/red and bands a failing line with its message
   * (SC6, SC7). `expanded` (⌥⌘F, SC8) swaps the top row for the FocusBar, adds «Структура» on the left and,
   * after a run, the results panel at the bottom (SC9).
   */
  import { tick, untrack } from 'svelte';
  import { Prec } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { t } from '$shared/i18n';
  import type { ScriptStage, ScriptTestResult, TabTestResults } from '$shared/model';
  import CodeEditor from './CodeEditor.svelte';
  import EditorTools from './EditorTools.svelte';
  import ScriptConsole from './ScriptConsole.svelte';
  import ScriptOutline from './ScriptOutline.svelte';
  import ScriptStageSwitch from './ScriptStageSwitch.svelte';
  import ScriptTests from './ScriptTests.svelte';
  import { countLabel } from './largeFold';
  import { PRE_REQUEST_SNIPPETS, TEST_SNIPPETS, scriptCompletionSource, type ScriptSnippet } from './scriptCompletions';
  import { scriptMarks } from './scriptMarks';
  import { scriptSnippetsExpanded, scriptSnippetsOpen } from './scriptPrefs.svelte';
  import { consoleRows, stageTests } from './scriptRun';
  import { Segmented, StatusPill } from '$shared/ui/components';

  let {
    preRequestScript,
    testScript,
    onPreRequestChange,
    onTestChange,
    docId,
    stage,
    onStage,
    results,
    expanded = false,
    onExpand,
    onClearConsole,
    response,
    onRunPanel,
  }: {
    preRequestScript: string;
    testScript: string;
    onPreRequestChange: (value: string) => void;
    onTestChange: (value: string) => void;
    docId: string;
    stage: ScriptStage;
    onStage: (stage: ScriptStage) => void;
    /** The tab's last run. */
    results?: TabTestResults;
    expanded?: boolean;
    onExpand?: () => void;
    onClearConsole?: () => void;
    /** SC9: the response summary shown in the results panel, which stands in for the response strip. */
    response?: { tone: 'success' | 'warning' | 'danger'; status: string; detail: string };
    /** Reports whether the results panel is up, so the host can drop the response strip under it. */
    onRunPanel?: (open: boolean) => void;
  } = $props();

  /** SC7: from this many lines the editor takes the height and the response folds into its strip. */
  const BIG_SCRIPT_LINES = 40;

  let editor = $state<ReturnType<typeof CodeEditor>>();
  let outline = $state<ReturnType<typeof ScriptOutline>>();
  let snippetSearch = $state('');
  let currentLine = $state(1);
  let runOpen = $state(false);
  let runTab = $state<'tests' | 'console'>('tests');

  const value = $derived(stage === 'pre' ? preRequestScript : testScript);
  const lineCount = $derived((value.match(/\n/g)?.length ?? 0) + 1);
  const big = $derived(lineCount >= BIG_SCRIPT_LINES);
  const snippets = $derived(stage === 'pre' ? PRE_REQUEST_SNIPPETS : TEST_SNIPPETS);
  const tests = $derived(stageTests(results, stage));
  const failedHere = $derived(results?.errorPhase === stage && !!results.error);
  const has = $derived({ pre: !!preRequestScript.trim(), post: !!testScript.trim() });
  const filteredSnippets = $derived.by(() => {
    const q = snippetSearch.trim().toLowerCase();
    return q
      ? snippets.filter((s) => t(s.label).toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      : snippets;
  });

  const extensions = $derived([
    scriptMarks({
      tests: tests.flatMap((x) => (x.line ? [{ line: x.line, ok: x.passed }] : [])),
      errors: [
        ...(failedHere && results?.errorLine ? [{ line: results.errorLine, message: results.error ?? '' }] : []),
        // SC9: failed assertions get their note only in the expanded editor; inline they'd overflow the card.
        ...(expanded
          ? tests.flatMap((x) => (!x.passed && x.errorLine ? [{ line: x.errorLine, message: x.error ?? '' }] : []))
          : []),
      ],
    }),
    // ⌘↵ sends (the window hotkey) instead of inserting a blank line.
    Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => true }])),
    EditorView.updateListener.of((u) => {
      if (u.selectionSet || u.docChanged) currentLine = u.state.doc.lineAt(u.state.selection.main.head).number;
    }),
  ]);

  const runShown = $derived(expanded && runOpen && !!results);
  $effect(() => onRunPanel?.(runShown));

  // SC9: a run finishing while expanded slides the results panel up (failures first).
  let seenRun = untrack(() => results?.at);
  $effect(() => {
    const at = results?.at;
    if (at === seenRun) return;
    seenRun = at;
    if (expanded && at) {
      runOpen = true;
      runTab = 'tests';
    }
  });

  function change(next: string): void {
    if (stage === 'pre') onPreRequestChange(next);
    else onTestChange(next);
  }

  function selectStage(next: ScriptStage): void {
    onStage(next);
    snippetSearch = '';
  }
  // A stage switch loads another document: its caret starts at the top.
  $effect(() => {
    void stage;
    currentLine = 1;
  });

  function insertSnippet(snippet: ScriptSnippet): void {
    editor?.insertText(snippet.code);
  }

  /** Open `stage` (if given) and put the caret on `line`. */
  export async function reveal(line: number, inStage: ScriptStage = stage): Promise<void> {
    if (inStage !== stage) {
      onStage(inStage);
      await tick();
    }
    editor?.reveal(line);
  }

  function gotoTest(test: ScriptTestResult, line: number): void {
    void reveal(line, test.stage ?? 'post');
  }

  function keydown(e: KeyboardEvent): void {
    if (!expanded || !(e.metaKey || e.ctrlKey) || e.code !== 'KeyO') return;
    if (e.altKey) outline?.toggle();
    else if (e.shiftKey) outline?.focusSearch();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bs-scripts" class:expanded data-big={big || undefined} onkeydown={keydown}>
  {#if !expanded}
    <div class="bar">
      <ScriptStageSwitch {stage} onStage={selectStage} {has} failed={results?.error ? results.errorPhase : undefined} />
      <span class="hint">{stage === 'pre' ? t('script.pre.hint') : t('script.post.hint')}</span>
      <span class="spacer"></span>
      <span class="meta">{`JavaScript · ${countLabel(lineCount, 'lines')}`}</span>
      <EditorTools scope=".bs-script-editor" format pill {onExpand} {expanded} />
      <button
        type="button"
        class="snip-toggle"
        class:on={scriptSnippetsOpen.current}
        aria-pressed={scriptSnippetsOpen.current}
        title={t('script.toggle_snippets')}
        onclick={() => (scriptSnippetsOpen.current = !scriptSnippetsOpen.current)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">data_object</span>{t('script.snippets')}
      </button>
    </div>
  {/if}

  <div class="body">
    {#if expanded}
      <ScriptOutline
        bind:this={outline}
        code={value}
        {tests}
        lastRunAt={results?.at}
        {currentLine}
        onGoto={(line) => editor?.reveal(line)}
      />
    {/if}
    <div class="card" class:failed={failedHere}>
      <div class="bs-script-editor">
        <CodeEditor
          bind:this={editor}
          {value}
          onChange={change}
          lang="javascript"
          completionSource={scriptCompletionSource}
          completionFooter={t('script.ac.footer')}
          placeholder={stage === 'pre' ? t('script.pre.placeholder') : t('script.post.placeholder')}
          fill
          bare
          folding
          docId={`${docId}:${stage}`}
          ariaLabel={stage === 'pre' ? t('script.pre.name') : t('script.post.name')}
          {extensions}
        />
      </div>
      <footer>
        <span class="material-symbols-outlined" aria-hidden="true">shield</span>{t('script.sandbox')}
        <span class="spacer"></span>
        <code>pm.</code>{t('script.autocomplete')}
      </footer>
    </div>

    {#if expanded ? scriptSnippetsExpanded.current : scriptSnippetsOpen.current}
      <aside class="snippets" aria-label={t('script.snippets_aria')}>
        <header>
          <span>{t('script.snippets')}</span>
          <button
            type="button"
            aria-label={t('script.close_snippets')}
            onclick={() => (expanded ? (scriptSnippetsExpanded.current = false) : (scriptSnippetsOpen.current = false))}
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <label class="search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            bind:value={snippetSearch}
            placeholder={t('script.search_snippets')}
            aria-label={t('script.search_snippets')}
          />
        </label>
        <div class="group">{stage === 'pre' ? t('script.group.pre') : t('script.group.post')}</div>
        <div class="list">
          {#each filteredSnippets as snippet (snippet.label)}
            <button type="button" onclick={() => insertSnippet(snippet)}>
              <span>{t(snippet.label)}</span>
              <span class="material-symbols-outlined" aria-hidden="true">add</span>
            </button>
          {:else}
            <div class="none">{t('script.no_snippets')}</div>
          {/each}
        </div>
        <footer>{t('script.snippets_hint')}</footer>
      </aside>
    {/if}
  </div>

  {#if runShown && results}
    {@const passed = results.tests.filter((x) => x.passed).length}
    <section class="run" aria-label={t('response.tab.tests')}>
      <div class="run-head">
        <Segmented role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={runTab === 'tests'}
            class:on={runTab === 'tests'}
            onclick={() => (runTab = 'tests')}
            >{t('response.tab.tests')}<span class="n" class:bad={passed < results.tests.length}
              >{`${passed}/${results.tests.length}`}</span
            ></button
          >
          <button
            type="button"
            role="tab"
            aria-selected={runTab === 'console'}
            class:on={runTab === 'console'}
            onclick={() => (runTab = 'console')}
            >{t('response.tab.console')}<span class="n">{consoleRows(results.events ?? []).length}</span></button
          >
        </Segmented>
        <span class="spacer"></span>
        {#if response}
          <StatusPill class={response.tone}
            ><span class="g" aria-hidden="true">{response.tone === 'success' ? '✓' : '!'}</span
            >{response.status}</StatusPill
          >
          <span class="detail">{response.detail}</span>
        {/if}
        {#if results.at}<span class="meta">{new Date(results.at).toTimeString().slice(0, 5)}</span>{/if}
        <button type="button" class="run-collapse" onclick={() => (runOpen = false)}>
          <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>{t('lb.collapse')}
        </button>
      </div>
      <div class="run-body">
        {#if runTab === 'tests'}
          {#if results.error}<p class="run-error">
              <span class="material-symbols-outlined" aria-hidden="true">error</span>{results.error}
            </p>{/if}
          <ScriptTests {results} compact onLine={gotoTest} />
        {:else}
          <ScriptConsole events={results.events ?? []} onClear={onClearConsole} onTests={() => (runTab = 'tests')} />
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  :global(:root .bs .bs-stpill.danger) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  .bs-scripts {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    /* Same side inset as the other request tabs (.bs-pwrap): the card's frame never sits on the window edge. */
    padding: 10px 14px 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .hint {
    min-width: 0;
    overflow: hidden;
    color: var(--t3);
    font-size: var(--font-size-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .meta {
    flex: none;
    color: var(--t3);
    font: 500 var(--font-size-micro) var(--mono);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .snip-toggle {
    flex: none;
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    color: var(--t2);
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    font: 500 var(--font-size-caption) var(--font-ui);
  }
  .snip-toggle.on {
    color: var(--text);
    background: var(--color-raised);
    border-color: var(--sep);
  }
  .snip-toggle .material-symbols-outlined {
    font-size: 15px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
  }
  .card {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--inset);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .card:focus-within {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--sep));
  }
  .card.failed {
    border-color: var(--color-danger);
  }
  .bs-script-editor {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  .bs-script-editor :global(.cm-editor) {
    height: 100%;
  }
  /* SC7: last run's result on the line numbers of pm.test calls. */
  .bs-script-editor :global(.cm-lineNumbers .cm-gutterElement.bs-ln-ok),
  .bs-script-editor :global(.cm-lineNumbers .cm-gutterElement.bs-ln-fail) {
    /* Hug the number with even padding, right edge where the other numbers end. */
    width: fit-content;
    min-width: 0;
    margin-left: auto;
    padding: 0 7px;
    border-radius: 6px;
    font-weight: 600;
  }
  .bs-script-editor :global(.cm-lineNumbers .cm-gutterElement.bs-ln-ok) {
    color: var(--color-success);
    background: var(--color-success-soft);
  }
  .bs-script-editor :global(.cm-lineNumbers .cm-gutterElement.bs-ln-fail) {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }
  /* SC6 / SC9: the failing line and its message. */
  .bs-script-editor :global(.cm-line.bs-err-line) {
    background: var(--color-danger-soft);
  }
  .bs-script-editor :global(.bs-err-note) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 18px;
    padding: 0 8px;
    color: var(--color-danger);
    background: var(--color-danger-soft);
    border-radius: 999px;
    font-size: 0.92em;
    font-style: normal;
    vertical-align: 1px;
  }
  .bs-script-editor :global(.bs-err-note .material-symbols-outlined) {
    font-size: 13px;
  }
  .card > footer {
    height: 30px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    color: var(--t3);
    border-top: 1px solid var(--sepsoft);
    font-size: var(--font-size-micro);
  }
  .card > footer .material-symbols-outlined {
    font-size: 13px;
  }
  .card > footer code {
    color: var(--t2);
    font-family: var(--mono);
  }
  .snippets {
    width: 264px;
    flex: none;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .snippets header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 4px 14px;
    color: var(--t3);
    font: 600 var(--font-size-micro) var(--mono);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .snippets header button {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    border-radius: var(--radius-sm);
  }
  .snippets header button:hover {
    color: var(--text);
    background: var(--hover);
  }
  .snippets header .material-symbols-outlined {
    font-size: 15px;
  }
  .search {
    height: 30px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 10px 10px;
    padding: 0 10px;
    color: var(--t3);
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
  }
  .search:focus-within {
    border-color: color-mix(in srgb, var(--accent) 56%, var(--sep));
  }
  .search .material-symbols-outlined {
    font-size: 15px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: 0;
    font-size: var(--font-size-caption);
  }
  .group {
    padding: 0 14px 6px;
    color: var(--t3);
    font: 600 var(--font-size-micro) var(--mono);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 6px;
  }
  .list button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    color: var(--t2);
    border-radius: var(--radius-control);
    font-size: var(--font-size-caption);
    text-align: left;
  }
  .list button:hover {
    color: var(--text);
    background: var(--hover);
  }
  .list button .material-symbols-outlined {
    flex: none;
    color: var(--t3);
    font-size: 15px;
  }
  .none {
    padding: 14px 8px;
    color: var(--t3);
    font-size: var(--font-size-caption);
    text-align: center;
  }
  .snippets > footer {
    padding: 8px 12px 10px;
    color: var(--t3);
    font-size: var(--font-size-micro);
  }
  /* SC9: results under the editor after a run. */
  .run {
    flex: none;
    max-height: 42%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .run-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
  }
  .run-head .detail {
    color: var(--t3);
    font: var(--font-size-micro) var(--mono);
    white-space: pre;
  }
  .run-head .n {
    margin-left: 6px;
    color: var(--t3);
    font: 500 var(--font-size-micro) var(--mono);
  }
  .run-head .n.bad {
    color: var(--color-danger);
  }
  .run-collapse {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    color: var(--t2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    font-size: var(--font-size-caption);
  }
  .run-collapse:hover {
    color: var(--text);
  }
  .run-collapse .material-symbols-outlined {
    font-size: 15px;
  }
  .run-body {
    min-height: 0;
    overflow: auto;
    padding: 0 10px 10px;
  }
  .run-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--color-danger);
    font: var(--font-size-caption) var(--mono);
  }
  .run-error .material-symbols-outlined {
    font-size: 15px;
  }
</style>
