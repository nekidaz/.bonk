<script lang="ts">
  /** Full-height Postman-style workspace for pre-request and post-response JS. */
  import CodeEditor from './CodeEditor.svelte';
  import {
    PM_COMPLETIONS,
    PRE_REQUEST_SNIPPETS,
    TEST_SNIPPETS,
    type ScriptSnippet,
  } from '../editor/scriptCompletions';

  let {
    preRequestScript,
    testScript,
    onPreRequestChange,
    onTestChange,
    docId,
  }: {
    preRequestScript: string;
    testScript: string;
    onPreRequestChange: (value: string) => void;
    onTestChange: (value: string) => void;
    docId: string;
  } = $props();

  type ScriptStage = 'pre-request' | 'post-response';
  let stage = $state<ScriptStage>('pre-request');
  let editor = $state<ReturnType<typeof CodeEditor>>();
  let snippetsOpen = $state(true);
  let snippetSearch = $state('');

  const currentValue = $derived(stage === 'pre-request' ? preRequestScript : testScript);
  const currentSnippets = $derived(stage === 'pre-request' ? PRE_REQUEST_SNIPPETS : TEST_SNIPPETS);
  const currentTitle = $derived(stage === 'pre-request' ? 'Pre-request script' : 'Post-response script');
  const currentDescription = $derived(
    stage === 'pre-request'
      ? 'Runs before variables resolve and the request is sent.'
      : 'Runs after the response; assertions appear in the Tests response tab.',
  );
  const currentPlaceholder = $derived(
    stage === 'pre-request'
      ? "// Prepare variables, headers, or request data\npm.environment.set('ts', String(Date.now()));"
      : "// Validate the response\npm.test('status is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});",
  );
  const currentDocId = $derived(`${docId}:${stage}`);
  const lineCount = $derived((currentValue.match(/\n/g)?.length ?? 0) + 1);
  const filteredSnippets = $derived.by(() => {
    const query = snippetSearch.trim().toLowerCase();
    if (!query) return currentSnippets;
    return currentSnippets.filter((snippet) =>
      snippet.label.toLowerCase().includes(query) || snippet.code.toLowerCase().includes(query),
    );
  });

  function changeCurrent(value: string): void {
    if (stage === 'pre-request') onPreRequestChange(value);
    else onTestChange(value);
  }

  function selectStage(next: ScriptStage): void {
    stage = next;
    snippetSearch = '';
  }

  function insertSnippet(snippet: ScriptSnippet): void {
    editor?.insertText(snippet.code);
  }
</script>

<div class="bs-scripts-workspace">
  <nav class="bs-script-nav" aria-label="Script stage">
    <div class="bs-script-nav-label">Lifecycle</div>
    <button class:on={stage === 'pre-request'} type="button" onclick={() => selectStage('pre-request')}>
      <span class="material-symbols-outlined">play_circle</span>
      <span><b>Pre-request</b><small>Before send</small></span>
    </button>
    <button class:on={stage === 'post-response'} type="button" onclick={() => selectStage('post-response')}>
      <span class="material-symbols-outlined">fact_check</span>
      <span><b>Post-response</b><small>Tests & variables</small></span>
    </button>
    <div class="bs-script-nav-note">
      <span class="material-symbols-outlined">shield_lock</span>
      <span>Sandboxed<br />No file or network access</span>
    </div>
  </nav>

  <section class="bs-script-main">
    <header class="bs-script-toolbar">
      <div class="bs-script-heading">
        <span class="material-symbols-outlined">javascript</span>
        <div><b>{currentTitle}</b><small>{currentDescription}</small></div>
      </div>
      <button class:on={snippetsOpen} type="button" onclick={() => (snippetsOpen = !snippetsOpen)} title="Toggle snippets">
        <span class="material-symbols-outlined">data_object</span>
        Snippets
      </button>
    </header>

    <div class="bs-script-editor">
      {#key currentDocId}
        <CodeEditor
          bind:this={editor}
          value={currentValue}
          onChange={changeCurrent}
          lang="javascript"
          completions={PM_COMPLETIONS}
          placeholder={currentPlaceholder}
          fill
          docId={currentDocId}
          ariaLabel={currentTitle}
        />
      {/key}
    </div>

    <footer class="bs-script-status">
      <span>JavaScript</span>
      <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
      <span class="bs-spacer"></span>
      <span>Type <code>pm.</code> for autocomplete</span>
    </footer>
  </section>

  {#if snippetsOpen}
    <aside class="bs-script-snippets" aria-label="Script snippets">
      <div class="bs-script-snippets-head">
        <div><b>Snippets</b><small>Insert at cursor</small></div>
        <button type="button" aria-label="Close snippets" onclick={() => (snippetsOpen = false)}>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <label class="bs-script-search">
        <span class="material-symbols-outlined">search</span>
        <input bind:value={snippetSearch} placeholder="Search snippets" aria-label="Search snippets" />
      </label>
      <div class="bs-script-snippet-group">
        <div class="label">{stage === 'pre-request' ? 'Request setup' : 'Tests & response'}</div>
        {#each filteredSnippets as snippet (snippet.label)}
          <button type="button" onclick={() => insertSnippet(snippet)}>
            <span>{snippet.label}</span>
            <span class="material-symbols-outlined">add</span>
          </button>
        {:else}
          <div class="bs-script-no-snippets">No matching snippets</div>
        {/each}
      </div>
    </aside>
  {/if}
</div>

<style>
  .bs-scripts-workspace {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    background: var(--canvas);
  }
  .bs-script-nav {
    width: 154px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 8px;
    background: color-mix(in srgb, var(--surface) 84%, var(--canvas));
    border-right: 1px solid var(--sepsoft);
  }
  .bs-script-nav-label {
    padding: 0 8px 7px;
    color: var(--t3);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .bs-script-nav > button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    color: var(--t2);
    border-radius: 7px;
    text-align: left;
  }
  .bs-script-nav > button:hover { color: var(--text); background: var(--hover); }
  .bs-script-nav > button.on {
    color: var(--text);
    background: var(--surface);
    box-shadow: inset 2px 0 var(--accent), 0 0 0 1px var(--sepsoft);
  }
  .bs-script-nav > button > .material-symbols-outlined { flex: none; font-size: 16px; color: var(--t3); }
  .bs-script-nav > button.on > .material-symbols-outlined { color: var(--accent); }
  .bs-script-nav b, .bs-script-nav small { display: block; }
  .bs-script-nav b { font-size: 11.5px; font-weight: 600; }
  .bs-script-nav small { margin-top: 1px; color: var(--t3); font-size: 9.5px; }
  .bs-script-nav-note {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin-top: auto;
    padding: 9px 7px 2px;
    color: var(--t3);
    font-size: 9.5px;
    line-height: 1.45;
  }
  .bs-script-nav-note .material-symbols-outlined { flex: none; font-size: 14px; }
  .bs-script-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bs-script-toolbar {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-script-heading { min-width: 0; display: flex; align-items: center; gap: 8px; }
  .bs-script-heading > .material-symbols-outlined { color: var(--accent); font-size: 19px; }
  .bs-script-heading b, .bs-script-heading small { display: block; }
  .bs-script-heading b { color: var(--text); font-size: 11.5px; font-weight: 600; }
  .bs-script-heading small {
    max-width: 520px;
    margin-top: 1px;
    overflow: hidden;
    color: var(--t3);
    font-size: 9.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-script-toolbar > button {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    padding: 0 8px;
    color: var(--t2);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 6px;
    font-size: 10.5px;
  }
  .bs-script-toolbar > button.on { color: var(--accent); background: var(--accentsoft); }
  .bs-script-toolbar > button .material-symbols-outlined { font-size: 14px; }
  .bs-script-editor {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    overflow: hidden;
  }
  .bs-script-editor > :global(.bs-code-editor) { flex: 1; min-height: 0; }
  .bs-script-editor :global(.cm-editor) { height: 100%; }
  .bs-script-editor :global(.cm-scroller) { padding-top: 5px; }
  .bs-script-status {
    height: 26px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    padding: 0 10px;
    color: var(--t3);
    background: var(--surface);
    border-top: 1px solid var(--sepsoft);
    font-size: 9.5px;
  }
  .bs-script-status code { color: var(--t2); font-family: var(--mono); }
  .bs-script-snippets {
    width: 236px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--sepsoft);
  }
  .bs-script-snippets-head {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 12px;
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-script-snippets-head b, .bs-script-snippets-head small { display: block; }
  .bs-script-snippets-head b { color: var(--text); font-size: 11.5px; }
  .bs-script-snippets-head small { color: var(--t3); font-size: 9.5px; }
  .bs-script-snippets-head button {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    border-radius: 6px;
  }
  .bs-script-snippets-head button:hover { color: var(--text); background: var(--hover); }
  .bs-script-snippets-head .material-symbols-outlined { font-size: 15px; }
  .bs-script-search {
    height: 30px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin: 9px;
    padding: 0 8px;
    color: var(--t3);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 7px;
  }
  .bs-script-search:focus-within { border-color: color-mix(in srgb, var(--accent) 56%, var(--sep)); }
  .bs-script-search .material-symbols-outlined { font-size: 14px; }
  .bs-script-search input { min-width: 0; flex: 1; color: var(--text); background: transparent; border: 0; outline: 0; font-size: 10.5px; }
  .bs-script-snippet-group { min-height: 0; overflow: auto; padding: 0 7px 10px; }
  .bs-script-snippet-group .label {
    padding: 4px 5px 6px;
    color: var(--t3);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .bs-script-snippet-group > button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 6px;
    color: var(--t2);
    border-radius: 6px;
    font-size: 10.5px;
    line-height: 1.35;
    text-align: left;
  }
  .bs-script-snippet-group > button:hover { color: var(--text); background: var(--hover); }
  .bs-script-snippet-group > button .material-symbols-outlined { flex: none; color: var(--t3); font-size: 14px; }
  .bs-script-no-snippets { padding: 14px 6px; color: var(--t3); font-size: 10.5px; text-align: center; }
  @media (max-width: 820px) {
    .bs-script-nav { width: 48px; padding: 8px 5px; }
    .bs-script-nav-label, .bs-script-nav > button > span:last-child, .bs-script-nav-note { display: none; }
    .bs-script-nav > button { justify-content: center; padding: 9px 0; }
    .bs-script-snippets { width: 210px; }
  }
</style>
