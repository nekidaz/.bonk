<script lang="ts">
  /**
   * Pre-request + test script editor: two CodeMirror editors with a
   * Postman-style snippets column that inserts at the cursor and `pm.*`
   * autocomplete built from the real sandbox surface. Protocol-agnostic — the
   * sandbox (crates/bonk-core/src/application/scripts.rs) only sees a plain
   * `{request, response, environment, globals}` object, so HTTP and gRPC share
   * this same editor; each caller wires its own field + onChange (HTTP via
   * `tab.request.*`, gRPC via `tab.grpc.*`).
   */
  import CodeEditor from './CodeEditor.svelte';
  import { PM_COMPLETIONS, PRE_REQUEST_SNIPPETS, TEST_SNIPPETS } from '../editor/scriptCompletions';

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

  let preEditor = $state<ReturnType<typeof CodeEditor>>();
  let testEditor = $state<ReturnType<typeof CodeEditor>>();
</script>

<div class="bs-pwrap bs-scripts">
  <div class="bs-script-block">
    <div class="bs-script-head">
      <span class="t">Pre-request Script</span>
      <span class="h">Runs before the request is sent and before {'{{variables}}'} resolve.</span>
    </div>
    <div class="bs-script-row">
      <div class="bs-script-editor">
        <CodeEditor
          bind:this={preEditor}
          value={preRequestScript}
          onChange={onPreRequestChange}
          lang="javascript"
          completions={PM_COMPLETIONS}
          placeholder={"// e.g. set a variable used in this request\npm.environment.set('ts', String(Date.now()));"}
          minHeight="150px"
          maxHeight="46vh"
          {docId}
          ariaLabel="Pre-request script"
        />
      </div>
      <div class="bs-snippets" aria-label="Pre-request snippets">
        <div class="t">Snippets</div>
        {#each PRE_REQUEST_SNIPPETS as snippet (snippet.label)}
          <button type="button" onclick={() => preEditor?.insertText(snippet.code)}>{snippet.label}</button>
        {/each}
      </div>
    </div>
  </div>

  <div class="bs-script-block">
    <div class="bs-script-head">
      <span class="t">Tests</span>
      <span class="h">Runs after the response arrives; assertions show under the response.</span>
    </div>
    <div class="bs-script-row">
      <div class="bs-script-editor">
        <CodeEditor
          bind:this={testEditor}
          value={testScript}
          onChange={onTestChange}
          lang="javascript"
          completions={PM_COMPLETIONS}
          placeholder={"// e.g. assert on the response\npm.test('status is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});"}
          minHeight="150px"
          maxHeight="46vh"
          {docId}
          ariaLabel="Test script"
        />
      </div>
      <div class="bs-snippets" aria-label="Test snippets">
        <div class="t">Snippets</div>
        {#each TEST_SNIPPETS as snippet (snippet.label)}
          <button type="button" onclick={() => testEditor?.insertText(snippet.code)}>{snippet.label}</button>
        {/each}
      </div>
    </div>
  </div>

  <p class="bs-script-hint">
    Sandboxed JavaScript with a <code>pm.*</code> API — type <code>pm.</code> for completions. No network or file access.
  </p>
</div>

<style>
  .bs-scripts {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .bs-script-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .bs-script-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .bs-script-head .t {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .bs-script-head .h {
    font-size: 11px;
    color: var(--t3);
  }
  .bs-script-row {
    display: flex;
    align-items: stretch;
    gap: 10px;
    min-width: 0;
  }
  .bs-script-editor {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .bs-script-editor > :global(.bs-code-editor) {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .bs-script-editor :global(.cm-editor) {
    flex: 1;
    min-height: 0;
  }
  .bs-snippets {
    flex: 0 0 190px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px;
    border: 0.5px solid var(--sep);
    border-radius: 7px;
    background: color-mix(in srgb, var(--surface) 46%, transparent);
    align-self: stretch;
    overflow-y: auto;
  }
  .bs-snippets .t {
    padding: 2px 7px 6px;
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t3);
  }
  .bs-snippets button {
    flex-shrink: 0;
    padding: 5px 7px;
    border-radius: 6px;
    text-align: left;
    font-size: 12px;
    line-height: 1.35;
    color: var(--t2);
  }
  .bs-snippets button:hover {
    background: var(--hover);
    color: var(--text);
  }
  @media (max-width: 860px) {
    .bs-script-row {
      flex-direction: column;
    }
    .bs-snippets {
      flex: none;
      width: 100%;
    }
  }
  .bs-script-hint {
    font-size: 11px;
    line-height: 1.6;
    color: var(--t3);
    margin: 0;
  }
  .bs-script-hint code {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--t2);
    background: var(--inset);
    border-radius: 4px;
    padding: 1px 4px;
  }
</style>
