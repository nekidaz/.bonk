<script lang="ts">
  /**
   * Pre-request + test script editor. Two plain monospace textareas bound to
   * `tab.request.preRequestScript` / `tab.request.testScript`. Deliberately
   * simple (no CodeMirror) to match the rest of the request editor. An empty
   * string is normalized to `undefined` so a blank script isn't persisted.
   */
  import { updateActiveTab } from '../../stores';
  import type { Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();

  function setScript(field: 'preRequestScript' | 'testScript', value: string): void {
    const next = value === '' ? undefined : value;
    updateActiveTab((t) => ({ ...t, request: { ...t.request, [field]: next } }));
  }
</script>

<div class="bs-pwrap bs-scripts">
  <div class="bs-script-block">
    <div class="bs-script-head">
      <span class="t">Pre-request Script</span>
      <span class="h">Runs before the request is sent and before {'{{variables}}'} resolve.</span>
    </div>
    <textarea
      spellcheck="false"
      aria-label="Pre-request script"
      placeholder={"// e.g. set a variable used in this request\npm.environment.set('ts', String(Date.now()));"}
      value={tab.request.preRequestScript ?? ''}
      oninput={(e) => setScript('preRequestScript', e.currentTarget.value)}
    ></textarea>
  </div>

  <div class="bs-script-block">
    <div class="bs-script-head">
      <span class="t">Tests</span>
      <span class="h">Runs after the response arrives; assertions show under the response.</span>
    </div>
    <textarea
      spellcheck="false"
      aria-label="Test script"
      placeholder={"// e.g. assert on the response\npm.test('status is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});"}
      value={tab.request.testScript ?? ''}
      oninput={(e) => setScript('testScript', e.currentTarget.value)}
    ></textarea>
  </div>

  <p class="bs-script-hint">
    Sandboxed JavaScript. Available:
    <code>pm.environment.get/set/unset</code>, <code>pm.globals.get/set/unset</code>,
    <code>pm.variables.get</code>, <code>pm.request.url/body/headers.add</code>,
    <code>pm.response.code/json()/text()</code>, <code>pm.test(name, fn)</code>,
    <code>pm.expect(x).to.equal/eql/be.ok/have.status(n)</code>, <code>console.log</code>.
    No network or file access.
  </p>
</div>

<style>
  .bs-scripts {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .bs-script-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 150px;
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
  .bs-scripts textarea {
    width: 100%;
    flex: 1;
    min-height: 130px;
    resize: vertical;
    background: var(--inset);
    border: 0.5px solid var(--sep);
    border-radius: 9px;
    padding: 12px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text);
    outline: none;
    tab-size: 2;
  }
  .bs-scripts textarea:focus {
    border-color: var(--accent);
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
