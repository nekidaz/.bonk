<script lang="ts">
  /**
   * The Scripts tab of an HTTP or gRPC request: ScriptsEditor wired to the tab's last run, the shared stage
   * (so the expanded mode's top bar can switch it), ⌥⌘F expansion and “Go to line” from the response.
   */
  import { tick } from 'svelte';
  import { ScriptsEditor } from '$shared/editor/components';
  import { focusMode, toggleFocus } from '$shared/ui';
  import { elapsedLabel, formatBytes, grpcStatusLabel, HTTP_STATUS_TEXT, type Tab } from '$shared/model';
  import { tabs } from '$entities/tab';
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
