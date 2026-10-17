<script lang="ts">
  /**
   * The Scripts tab of an HTTP or gRPC request: ScriptsEditor wired to the tab's last run, the shared stage
   * (so the expanded mode's top bar can switch it), ⌥⌘F expansion and “Go to line” from the response.
   */
  import { tick } from 'svelte';
  import { CodeEditor, ScriptsEditor } from '$shared/editor/components';
  import { focusMode, toggleFocus } from '$shared/ui';
  import { t, tp } from '$shared/i18n';
  import { elapsedLabel, formatBytes, grpcStatusLabel, HTTP_STATUS_TEXT, type Tab } from '$shared/model';
  import { tabs } from '$entities/tab';
  import { scriptFoldersFor, workspace } from '$entities/workspace';
  import { scriptStage, scriptUi, setScriptRunPanel, setScriptStage, setScriptsOpen } from './scriptUi.svelte';

  let {
    tab,
    preRequestScript,
    testScript,
    onPreRequestChange,
    onTestChange,
  }: {
    tab: Tab;
    preRequestScript: string;
    testScript: string;
    onPreRequestChange: (value: string) => void;
    onTestChange: (value: string) => void;
  } = $props();

  let editor = $state<ReturnType<typeof ScriptsEditor>>();

  // Folder scripts the send runs before this request's own (root first), read-only; the code mounts only
  // when its row is opened: an inherited collection script can be hundreds of KB.
  const stage = $derived(scriptStage(tab.id));
  const inherited = $derived(
    scriptFoldersFor(workspace.tree, tab.savedPath).flatMap((f) => {
      const code = stage === 'pre' ? f.preRequestScript : f.testScript;
      return code?.trim() ? [{ id: f.id, name: f.name, code }] : [];
    }),
  );
  let open = $state<Record<string, boolean>>({});
  const lines = (code: string): string => {
    const n = (code.match(/\n/g)?.length ?? 0) + 1;
    return `${n} ${tp(n, ['line', 'lines'])}`;
  };

  $effect(() => {
    const id = tab.id;
    setScriptsOpen(id, true);
    return () => {
      setScriptsOpen(id, false);
      setScriptRunPanel(id, false);
    };
  });

  // SC9: status, time and size of the last response, for the results panel that replaces the strip.
  const response = $derived.by(() => {
    if (tab.protocol === 'grpc') {
      const r = tab.grpcResult;
      return r
        ? {
            tone: r.ok ? ('success' as const) : ('danger' as const),
            status: grpcStatusLabel(r.status),
            detail: `${elapsedLabel(r.elapsed_ms)}  ·  ${formatBytes(r.size_bytes)}`,
          }
        : undefined;
    }
    const r = tab.response;
    if (!r || r.status === 0) return undefined;
    return {
      tone: r.status >= 500 ? ('danger' as const) : r.status >= 400 ? ('warning' as const) : ('success' as const),
      status: `${r.status} ${HTTP_STATUS_TEXT[r.status] ?? ''}`.trim(),
      detail: `${elapsedLabel(r.elapsed_ms)}  ·  ${formatBytes(r.size_bytes)}`,
    };
  });

  $effect(() => {
    const jump = scriptUi.jump;
    if (!jump || jump.tabId !== tab.id || !editor) return;
    scriptUi.jump = null;
    setScriptStage(tab.id, jump.stage);
    if (jump.line) void tick().then(() => editor?.reveal(jump.line!, jump.stage));
  });
</script>

<div class="wrap">
  {#each inherited as f (f.id)}
    <details class="inh" ontoggle={(e) => (open = { ...open, [f.id]: e.currentTarget.open })}>
      <summary>
        <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
        <span class="msg"
          >{t(stage === 'pre' ? 'script.inherited.pre' : 'script.inherited.post', {
            name: f.name,
            lines: lines(f.code),
          })}</span
        >
        <span class="hint">{t('script.inherited.hint')}</span>
      </summary>
      {#if open[f.id]}
        <div class="code">
          <CodeEditor
            value={f.code}
            onChange={() => {}}
            lang="javascript"
            readOnly
            folding
            maxHeight="240px"
            docId={`${f.id}:${stage}`}
          />
        </div>
      {/if}
    </details>
  {/each}
  <ScriptsEditor
    bind:this={editor}
    {preRequestScript}
    {testScript}
    {onPreRequestChange}
    {onTestChange}
    docId={tab.id}
    stage={scriptStage(tab.id)}
    onStage={(s) => setScriptStage(tab.id, s)}
    results={tab.testResults}
    expanded={focusMode.current === 'request'}
    onExpand={() => (focusMode.current = toggleFocus(focusMode.current, 'request'))}
    {response}
    onRunPanel={(open) => setScriptRunPanel(tab.id, open)}
    onClearConsole={() =>
      tabs.updateById(tab.id, (x) => (x.testResults ? { ...x, testResults: { ...x.testResults, events: [] } } : x))}
  />
</div>

<style>
  .wrap {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .inh {
    flex: none;
    margin: 10px 14px 0;
    border-radius: var(--radius-card);
    background: var(--color-selected);
  }
  .inh summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 0 12px;
    cursor: pointer;
    list-style: none;
    font-size: 12px;
  }
  .inh summary::-webkit-details-marker {
    display: none;
  }
  .inh summary > .material-symbols-outlined {
    flex: none;
    font-size: 16px;
    color: var(--color-text-secondary);
  }
  .inh .msg {
    white-space: nowrap;
  }
  .inh .hint {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .inh .code {
    padding: 0 8px 8px;
  }
</style>
