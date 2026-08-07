<script lang="ts">
  /**
   * gRPC request editor for the active tab: the endpoint bar + method picker,
   * the error banner, and the message / metadata / service-definition sub-tabs.
   *
   * The response area (`.bs-resp`) and its split-resize handle stay in
   * App.svelte; this component owns only the gRPC request-editing UI and its
   * state. It reads/writes in-flight + error state via the shared
   * `busyMap`/`grpcErrorMap` stores (keyed by tab id) so a request started here
   * never shows busy/error on another tab.
   *
   * `methodOpen` is bound from App because App's `<svelte:window onpointerdown>`
   * resets it on outside-click; the picker element stops pointer-down
   * propagation so clicking inside doesn't close it.
   */
  import { flushSync } from 'svelte';
  import { get } from 'svelte/store';
  import {
    tabs,
    updateActiveTab,
    updateTabById,
    addHistory,
    grpcSnapshot,
    titleFromUrl,
    GRPC_DEFAULT_TITLE,
    requestTimeoutMs,
    applyScriptVars,
    addAppConsoleEntry,
  } from '../stores';
  import {
    cancelRequest,
    grpcConnect,
    grpcReflect,
    grpcLoadProto,
    grpcCall,
    grpcTemplate,
    protoPick,
    workspacePickFolder,
    runScript,
  } from '../api';
  import { busyMap, grpcErrorMap } from '../requestRuntime';
  import { filterGrpcServices, grpcEditorSections, openGrpcEditorSection } from '../grpcEditorUi';
  import { currentVarScope, globals, environments, activeEnvironmentId } from '../stores';
  import { requestVariableHighlight } from '../editor/requestVarHighlight';
  import CodeEditor from './CodeEditor.svelte';
  import GrpcMetadataEditor from './GrpcMetadataEditor.svelte';
  import ScriptsEditor from './ScriptsEditor.svelte';
  import { resolveVars, mergeScope } from '../domain/vars';
  import { buildGrpcScriptContext, applyGrpcRequestPatch, type ScriptResult } from '../domain/scripts';
  import {
    GRPC_NO_SERVICES_HINT,
    grpcConnectFailureMessage,
    inferGrpcPlaintext,
    methodShort,
    type GrpcConnectStage,
  } from '../domain/grpc';
  import { grpcMethodLabel } from '../grpcActions';
  import type { Tab, GrpcResult } from '../domain/types';

  /** The active environment's `name → value` map, or `{}` when none is selected. */
  function activeEnvMap(): Record<string, string> {
    const id = get(activeEnvironmentId);
    const env = id ? get(environments).find((e) => e.id === id) : undefined;
    return mergeScope([], env);
  }

  /** The globals `name → value` map. */
  function globalsMap(): Record<string, string> {
    return mergeScope(get(globals), undefined);
  }

  let {
    tab,
    methodOpen = $bindable(),
    onOpenSettings,
  }: {
    tab: Tab;
    methodOpen: boolean;
    onOpenSettings: () => void;
  } = $props();

  const gTab = $derived($grpcEditorSections[tab.id] ?? 'message');
  // Per-tab gRPC in-flight state derived from the shared `busyMap` store so the
  // tab's Invoke/Connect buttons reflect ONLY that tab's request.
  const activeBusy = $derived($busyMap[tab.id]);
  const grpcConnecting = $derived(activeBusy?.kind === 'connect');
  const grpcInvoking = $derived(activeBusy?.kind === 'invoke');
  // Per-tab gRPC error text, so a stale error never shows on the wrong tab.
  const activeGrpcError = $derived($grpcErrorMap[tab.id] ?? '');
  // Postman-style: when the dial succeeded but the services can't be listed via
  // reflection, show neutral guidance to load a schema instead of a red error
  // (see grpcConnectFailureMessage in domain/grpc).
  const grpcGuiding = $derived(activeGrpcError === GRPC_NO_SERVICES_HINT);
  type EditorErrorKind = 'connection' | 'schema' | 'validation' | 'script' | 'unknown';
  type EditorErrorPresentation = { kind: EditorErrorKind; title: string; message: string; raw: string; icon: string };
  function presentEditorError(error: string, guiding: boolean, endpoint: string): EditorErrorPresentation {
    if (guiding) return { kind: 'schema', title: 'Service definition unavailable', message: error, raw: error, icon: 'description' };
    if (/connect|transport|network|dns|certificate|tls|deadline|unavailable|refused|dial/i.test(error)) {
      const target = endpoint.trim() || 'the server';
      return {
        kind: 'connection',
        title: 'Connection failed',
        message: `Couldn’t reach ${target}. Check the address, TLS mode, and network access, then retry.`,
        raw: error,
        icon: 'cloud_off',
      };
    }
    if (/pre-request script/i.test(error)) {
      return { kind: 'script', title: 'Pre-request script failed', message: 'Fix the script error before invoking again.', raw: error, icon: 'javascript' };
    }
    if (/json|select a method|enter an endpoint/i.test(error)) {
      return { kind: 'validation', title: 'Request needs attention', message: error, raw: error, icon: 'edit_note' };
    }
    return { kind: 'unknown', title: 'Couldn’t complete the request', message: error, raw: error, icon: 'error' };
  }
  const editorError = $derived(
    activeGrpcError
      ? presentEditorError(activeGrpcError, grpcGuiding, tab.grpc?.endpoint ?? '')
      : undefined,
  );
  const grpcPlaintext = $derived(
    tab.grpc?.plaintext ?? inferGrpcPlaintext(resolveVars(tab.grpc?.endpoint ?? '', currentVarScope())),
  );
  let methodSearch = $state('');
  let methodSearchInput = $state<HTMLInputElement | undefined>(undefined);
  const filteredGrpcServices = $derived(filterGrpcServices(tab.grpc?.tree?.services ?? [], methodSearch));
  const filteredGrpcMethodCount = $derived(
    filteredGrpcServices.reduce((count, service) => count + service.methods.length, 0),
  );

  $effect(() => {
    if (!methodOpen) methodSearch = '';
  });

  function setGrpc(patch: Record<string, unknown>): void {
    updateActiveTab((t) => (t.grpc ? { ...t, grpc: { ...t.grpc, ...patch } } : t));
  }
  function setGrpcScript(field: 'preRequestScript' | 'testScript', value: string): void {
    setGrpc({ [field]: value === '' ? undefined : value });
  }
  function useReflection(): void {
    setGrpc({ source: 'reflection', connectionId: undefined, tree: undefined });
  }
  async function importProto(): Promise<void> {
    const tabId = tab.id;
    const picked = await protoPick();
    if (!picked || picked.length === 0) return;
    updateTabById(tabId, (t) =>
      t.grpc
        ? { ...t, grpc: { ...t.grpc, source: 'proto', protoPaths: picked, connectionId: undefined, tree: undefined } }
        : t,
    );
  }
  async function addImportRoot(): Promise<void> {
    const tabId = tab.id;
    const dir = await workspacePickFolder();
    if (!dir) return;
    const current = $tabs.find((t) => t.id === tabId)?.grpc?.importPaths ?? [];
    const roots = [...current, dir];
    updateTabById(tabId, (t) =>
      t.grpc
        ? { ...t, grpc: { ...t.grpc, source: 'proto', importPaths: roots, connectionId: undefined, tree: undefined } }
        : t,
    );
  }
  async function grpcDoConnect(): Promise<void> {
    const t = tab;
    if (!t?.grpc) return;
    const tabId = t.id;
    grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
    busyMap.update((m) => ({ ...m, [tabId]: { kind: 'connect' } }));
    // Track which step failed: a dial failure (bad/unresolved endpoint,
    // unreachable server) must show the real error — schema guidance can't fix
    // it — while a post-dial reflection failure keeps the friendly hint.
    let stage: GrpcConnectStage = 'dial';
    try {
      if (t.grpc.source === 'proto' && !(t.grpc.protoPaths?.length)) {
        throw new Error('Select a .proto file first.');
      }
      const endpoint = resolveVars(t.grpc.endpoint, currentVarScope());
      const connId = await grpcConnect(endpoint, t.grpc.plaintext, $requestTimeoutMs);
      stage = 'schema';
      const tree =
        t.grpc.source === 'proto'
          ? await grpcLoadProto(connId, t.grpc.protoPaths ?? [], t.grpc.importPaths ?? [])
          : await grpcReflect(connId, $requestTimeoutMs);
      updateTabById(tabId, (x) => (x.grpc ? { ...x, grpc: { ...x.grpc, connectionId: connId, tree } } : x));
    } catch (e) {
      grpcErrorMap.update((m) => ({ ...m, [tabId]: grpcConnectFailureMessage(t.grpc?.source, stage, e) }));
    } finally {
      busyMap.update((m) => {
        if (m[tabId]?.kind !== 'connect') return m;
        const { [tabId]: _done, ...rest } = m;
        return rest;
      });
    }
  }
  /** Set endpoint and drop any stale connection so the next action reconnects. */
  function setEndpoint(v: string): void {
    updateActiveTab((t) =>
      t.grpc
        ? {
            ...t,
            title: t.manualTitle ? t.title : titleFromUrl(v, GRPC_DEFAULT_TITLE),
            grpc: { ...t.grpc, endpoint: v, connectionId: undefined, tree: undefined },
          }
        : t,
    );
  }

  function toggleTls(): void {
    setGrpc({
      plaintext: !grpcPlaintext,
      connectionId: undefined,
      tree: undefined,
    });
  }

  function openTlsSettings(): void {
    onOpenSettings();
  }
  function dismissGrpcError(): void {
    const tabId = tab.id;
    grpcErrorMap.update((current) => {
      if (!(tabId in current)) return current;
      const { [tabId]: _removed, ...rest } = current;
      return rest;
    });
  }
  /** Connect + reflect automatically if not already connected. */
  async function ensureConnected(): Promise<void> {
    const t = tab;
    if (!t?.grpc || t.grpc.connectionId || !t.grpc.endpoint.trim()) return;
    await grpcDoConnect();
  }
  function grpcDoSelect(symbol: string): void {
    const id = tab?.grpc?.connectionId;
    if (!id) return;
    // Selecting an RPC only changes the method. Message, metadata, and scripts
    // are the user's request draft and must survive method switches. An example
    // is inserted only through the explicit "Use Example Message" action.
    const tabId = tab.id;
    flushSync(() => {
      methodOpen = false;
      updateTabById(tabId, (t) => (t.grpc ? { ...t, grpc: { ...t.grpc, method: symbol } } : t));
    });
  }
  function clearMethodSearch(): void {
    methodSearch = '';
    methodSearchInput?.focus();
  }
  function methodSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (methodSearch) clearMethodSearch();
      else methodOpen = false;
      return;
    }
    if (e.key === 'Enter') {
      const first = filteredGrpcServices[0]?.methods[0];
      if (first) {
        e.preventDefault();
        grpcDoSelect(first.symbol);
      }
    }
  }
  async function loadGrpcTemplate(tabId: string, connectionId: string, symbol: string): Promise<void> {
    try {
      const tpl = await grpcTemplate(connectionId, symbol);
      updateTabById(tabId, (t) =>
        t.grpc?.method === symbol
          ? { ...t, grpc: { ...t.grpc, message: tpl } }
          : t,
      );
    } catch {
      // Keep the selected method; leave the existing message untouched.
    }
  }
  async function grpcLoadExample(): Promise<void> {
    const tabId = tab.id;
    let g = $tabs.find((t) => t.id === tabId)?.grpc;
    if (!g?.method) {
      grpcErrorMap.update((m) => ({ ...m, [tabId]: 'Select a method first.' }));
      return;
    }
    if (!g.connectionId) {
      await ensureConnected();
      g = $tabs.find((t) => t.id === tabId)?.grpc;
    }
    if (!g?.connectionId || !g.method) return;
    grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
    await loadGrpcTemplate(tabId, g.connectionId, g.method);
  }
  function grpcFormatMessage(): void {
    const t = tab;
    if (!t) return;
    const message = t.grpc?.message ?? '';
    try {
      setGrpc({ message: JSON.stringify(JSON.parse(message || '{}'), null, 2) });
      grpcErrorMap.update((m) => ({ ...m, [t.id]: '' }));
    } catch {
      grpcErrorMap.update((m) => ({ ...m, [t.id]: 'Message is not valid JSON.' }));
    }
  }
  async function openGrpcMethodDropdown(): Promise<void> {
    if (!tab?.grpc?.tree) await ensureConnected();
    methodOpen = !methodOpen;
    if (methodOpen) {
      methodSearch = '';
      requestAnimationFrame(() => methodSearchInput?.focus());
    }
  }
  async function grpcDoInvoke(): Promise<void> {
    const t0 = tab;
    if (!t0) return;
    const tabId = t0.id;
    // If this tab already has an invoke in flight, the button is a Cancel.
    const inFlight = $busyMap[tabId];
    if (inFlight?.kind === 'invoke' && inFlight.requestId) {
      await cancelRequest(inFlight.requestId);
      return;
    }
    if (!t0.grpc?.connectionId) await ensureConnected();
    // Re-read the originating tab after the (awaited) connect; never assume the
    // active tab is still this one.
    const g = $tabs.find((t) => t.id === tabId)?.grpc;
    // Never no-op silently: any earlier response stays visible in the response
    // pane, so a mute return here makes a dead Invoke look like a fresh success.
    // A failed connect/reflect already left its banner via grpcDoConnect; the
    // two cases IT can't explain (blank endpoint, no method) get their own.
    if (!g?.connectionId) {
      if (!g?.endpoint.trim()) grpcErrorMap.update((m) => ({ ...m, [tabId]: 'Enter an endpoint first.' }));
      return;
    }
    if (!g.method) {
      grpcErrorMap.update((m) => ({ ...m, [tabId]: 'Select a method first.' }));
      return;
    }
    const requestId = crypto.randomUUID();
    grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
    busyMap.update((m) => ({ ...m, [tabId]: { kind: 'invoke', requestId } }));

    const tests: ScriptResult['tests'] = [];
    const logs: string[] = [];
    let message = g.message;
    let metadata = g.metadata;

    // Pre-request script — runs against the raw message/metadata, before
    // {{var}} resolution. Unlike HTTP, this runs AFTER the connection is
    // already dialed (a live connection is needed just to know the method
    // exists), so a script can patch the message/metadata but not the
    // endpoint — pm.request.url is read-only for a gRPC pre-request script.
    if (g.preRequestScript && g.preRequestScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint: g.endpoint, message, metadata },
        undefined,
        activeEnvMap(),
        globalsMap(),
      );
      const pre = await runScript('pre-request', g.preRequestScript, context);
      applyScriptVars(pre);
      logs.push(...pre.logs);
      tests.push(...pre.tests);
      if (pre.error) {
        updateTabById(tabId, (x) => ({ ...x, testResults: { tests, logs, error: pre.error ?? undefined } }));
        addAppConsoleEntry({
          protocol: 'grpc',
          method: methodShort(g.method ?? '') || 'gRPC',
          url: g.endpoint,
          ok: false,
          status: 'SCRIPT ERROR',
          elapsedMs: 0,
          message: pre.error,
          logs,
        });
        grpcErrorMap.update((m) => ({ ...m, [tabId]: `Pre-request script: ${pre.error}` }));
        busyMap.update((m) => {
          if (m[tabId]?.requestId !== requestId) return m;
          const { [tabId]: _done, ...rest } = m;
          return rest;
        });
        return;
      }
      const patched = applyGrpcRequestPatch(
        { method: g.method, endpoint: g.endpoint, message, metadata },
        pre.requestPatch,
      );
      message = patched.message;
      metadata = patched.metadata;
    }

    let result: GrpcResult = { ok: false, status: 'ERROR', body: '', elapsed_ms: 0, size_bytes: 0 };
    // Interpolate {{var}} placeholders (globals + active environment, now
    // including anything the pre-request script set) into the message JSON
    // and metadata values just before dispatch.
    const scope = currentVarScope();
    // A visually empty editor represents protobuf's valid empty message.
    // Keep the draft blank in the UI, but send an empty JSON object on wire.
    const resolvedMessage = resolveVars(message, scope).trim() || '{}';
    const resolvedMetadata: Record<string, string> = {};
    for (const [k, val] of Object.entries(metadata)) resolvedMetadata[k] = resolveVars(val, scope);
    try {
      result = await grpcCall(g.connectionId, g.method, resolvedMessage, resolvedMetadata, requestId, $requestTimeoutMs);
    } catch (e) {
      const cancelled = String(e).toLowerCase().includes('cancel');
      result = {
        ok: false,
        status: cancelled ? 'CANCELLED' : 'ERROR',
        body: cancelled ? 'Request cancelled' : String(e),
        elapsed_ms: 0,
        size_bytes: 0,
      };
    } finally {
      busyMap.update((m) => {
        if (m[tabId]?.requestId !== requestId) return m;
        const { [tabId]: _done, ...rest } = m;
        return rest;
      });
    }

    // Test script — runs against the result; its env/globals writes are
    // applied and its tests/logs (plus any pre-request ones) attach to the tab.
    let testError: string | undefined;
    if (g.testScript && g.testScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint: g.endpoint, message: resolvedMessage, metadata: resolvedMetadata },
        result,
        activeEnvMap(),
        globalsMap(),
      );
      const post = await runScript('test', g.testScript, context);
      applyScriptVars(post);
      logs.push(...post.logs);
      tests.push(...post.tests);
      testError = post.error ?? undefined;
    }
    const testResults =
      tests.length > 0 || logs.length > 0 || testError ? { tests, logs, error: testError } : undefined;

    updateTabById(tabId, (x) => ({ ...x, grpcResult: result, testResults }));
    addAppConsoleEntry({
      protocol: 'grpc',
      method: methodShort(g.method ?? '') || 'gRPC',
      url: g.endpoint,
      ok: result.ok && !testError,
      status: result.status,
      elapsedMs: result.elapsed_ms,
      message: testError || (!result.ok ? result.body : undefined),
      logs,
    });
    addHistory({ id: crypto.randomUUID(), protocol: 'grpc', request: { method: 'GRPC', url: g.endpoint + ' ' + (g.method ?? ''), headers: {} }, status: 0, ok: result.ok, grpc: grpcSnapshot(g), at: Date.now() });
  }
  const protoFileNames = $derived(
    (tab.grpc?.protoPaths ?? []).map((p) => p.split(/[\\/]/).pop() ?? p),
  );
  const isProtoSource = $derived(tab.grpc?.source === 'proto');

  // `{{var}}` inline highlight + hover quick-set, shared by the endpoint,
  // message, and metadata editors; re-derived whenever the variable stores
  // change.
  const varHighlight = $derived(
    requestVariableHighlight($globals, $environments, $activeEnvironmentId),
  );
</script>

<div class="bs-urlbar">
  <div class="bs-grpc-endpoint-field">
    <div class="bs-grpc-security-wrap">
      <button
        class="bs-grpc-security"
        class:secure={!grpcPlaintext}
        type="button"
        role="switch"
        aria-label="Use TLS"
        aria-checked={!grpcPlaintext}
        title={grpcPlaintext ? 'Enable TLS' : 'Disable TLS'}
        onpointerdown={(e) => e.preventDefault()}
        onclick={toggleTls}
      >
        <span class="material-symbols-outlined" style="font-size:18px">{grpcPlaintext ? 'lock_open' : 'lock'}</span>
      </button>
      <div class="bs-tls-popover">
        {#if grpcPlaintext}
          <div class="bs-tls-title">TLS disabled</div>
          <p>This endpoint currently uses an unsecured plaintext connection. Click the open lock to enable TLS.</p>
        {:else}
          <div class="bs-tls-title secure"><span class="material-symbols-outlined" style="font-size:17px">verified_user</span>TLS enabled</div>
          <p>This endpoint uses an encrypted connection and the system certificate trust store.</p>
        {/if}
        <button class="bs-tls-link" type="button" onclick={openTlsSettings}>Open request settings</button>
      </div>
    </div>
    <CodeEditor
      value={tab.grpc?.endpoint ?? ''}
      onChange={setEndpoint}
      singleLine
      placeholder="Enter URL"
      onBlur={() => void ensureConnected()}
      {varHighlight}
      docId={tab.id}
      ariaLabel="gRPC endpoint"
    />
  </div>
  <div class="bs-grpc-picker" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="bs-grpc-trigger" class:open={methodOpen} onclick={openGrpcMethodDropdown} type="button">
      <span>{grpcMethodLabel(tab, grpcConnecting)}</span>
      <span class="material-symbols-outlined" style="font-size:18px">expand_more</span>
    </button>
    {#if methodOpen}
      <div class="bs-grpc-menu">
        {#if tab.grpc?.tree && !grpcConnecting}
          <div class="bs-grpc-search">
            <div class="bs-grpc-search-box">
              <span class="material-symbols-outlined" aria-hidden="true" style="font-size:17px">search</span>
              <input
                bind:this={methodSearchInput}
                bind:value={methodSearch}
                aria-label="Search gRPC methods"
                placeholder="Search services and methods"
                autocomplete="off"
                spellcheck="false"
                onkeydown={methodSearchKeydown}
              />
              {#if methodSearch}
                <span class="bs-grpc-search-count">{filteredGrpcMethodCount}</span>
                <button type="button" aria-label="Clear method search" title="Clear" onclick={clearMethodSearch}>
                  <span class="material-symbols-outlined" aria-hidden="true" style="font-size:15px">close</span>
                </button>
              {/if}
            </div>
          </div>
        {/if}
        <div class="bs-grpc-list">
          {#if grpcConnecting}
            <div class="bs-grpc-empty">Connecting...</div>
          {:else if !tab.grpc?.tree}
            <div class="bs-grpc-empty">{isProtoSource && !protoFileNames.length ? 'Import a .proto first' : 'Connect first'}</div>
          {:else if filteredGrpcServices.length === 0}
            <div class="bs-grpc-search-empty">
              <span class="material-symbols-outlined" aria-hidden="true" style="font-size:22px">search_off</span>
              <strong>No matching methods</strong>
              <span>Try a service, RPC, or package name.</span>
            </div>
          {:else}
            {#each filteredGrpcServices as service (service.name)}
              <div class="bs-grpc-service">{service.name}</div>
              {#each service.methods as m (m.symbol)}
                {@const streaming = m.clientStreaming || m.serverStreaming}
                <button class="bs-grpc-option" class:on={m.symbol === tab.grpc?.method} class:streaming onpointerdown={(e) => { e.preventDefault(); grpcDoSelect(m.symbol); }} type="button" title={streaming ? 'Streaming RPC — bonk currently supports unary calls only' : undefined}>
                  <span class="material-symbols-outlined flow" style="font-size:22px">swap_vert</span>
                  <span>{m.name}</span>
                  {#if streaming}<span class="bs-grpc-stream-tag">stream</span>{/if}
                </button>
              {/each}
            {/each}
          {/if}
        </div>
        <div class="bs-grpc-foot">
          {#if isProtoSource}
            <span>{protoFileNames.length ? `Using ${protoFileNames.join(', ')}` : 'No .proto selected'}</span>
          {:else}
            <span>Using server reflection.</span>
          {/if}
          <button type="button" title="Reload schema" onclick={grpcDoConnect}>
            <span class="material-symbols-outlined" style="font-size:18px">refresh</span>
          </button>
          <span class="bs-spacer"></span>
          {#if isProtoSource}
            <button type="button" title="Use server reflection" onclick={useReflection}>
              <span class="material-symbols-outlined" style="font-size:18px">cloud_sync</span>
              Reflection
            </button>
          {/if}
          <button type="button" title="Import .proto file" onclick={importProto}>
            <span class="material-symbols-outlined" style="font-size:18px">description</span>
            Import .proto
          </button>
        </div>
      </div>
    {/if}
  </div>
  <button class="bs-send" class:cancelling={grpcInvoking} onclick={grpcDoInvoke}>
    <span class="go">
      {#if grpcInvoking}<span class="send-spinner" aria-hidden="true"></span>{/if}
      <span>{grpcInvoking ? 'Cancel' : 'Invoke'}</span>
    </span>
    <span class="cv"><span class="material-symbols-outlined" style="font-size:14px">{grpcInvoking ? 'stop' : 'play_arrow'}</span></span>
  </button>
</div>

<style>
  .bs-grpc-connect-alert {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto 24px;
    align-items: start;
    gap: 10px;
    margin: 0 16px 10px;
    padding: 10px;
    color: var(--text);
    background: linear-gradient(90deg, color-mix(in srgb, var(--red) 7%, var(--surface)), var(--surface) 45%);
    border: 1px solid color-mix(in srgb, var(--red) 24%, var(--sep));
    border-radius: 9px;
    box-shadow: 0 4px 14px rgba(20, 20, 24, 0.05);
  }
  .bs-grpc-connect-alert.guidance {
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 6%, var(--surface)), var(--surface) 45%);
    border-color: color-mix(in srgb, var(--accent) 22%, var(--sep));
  }
  .bs-grpc-connect-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 11%, transparent);
    border-radius: 8px;
  }
  .guidance .bs-grpc-connect-icon { color: var(--accent); background: var(--accentsoft); }
  .bs-grpc-connect-icon .material-symbols-outlined { font-size: 17px; }
  .bs-grpc-connect-copy { min-width: 0; }
  .bs-grpc-connect-title { min-height: 20px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .bs-grpc-connect-title b { font-size: 12px; font-weight: 650; }
  .bs-grpc-connect-title span {
    max-width: 280px;
    padding: 2px 6px;
    overflow: hidden;
    color: var(--t3);
    background: var(--inset);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 9.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-grpc-connect-copy p { margin: 2px 0 0; color: var(--t2); font-size: 11px; line-height: 1.45; }
  .bs-grpc-connect-copy details { margin-top: 5px; color: var(--t3); font-size: 9.5px; }
  .bs-grpc-connect-copy summary { width: max-content; cursor: pointer; }
  .bs-grpc-connect-copy code {
    display: block;
    margin-top: 5px;
    padding: 6px 7px;
    color: var(--t2);
    background: var(--canvas);
    border-radius: 5px;
    font-family: var(--mono);
    white-space: pre-wrap;
  }
  .bs-grpc-connect-actions { align-self: center; display: flex; align-items: center; gap: 6px; }
  .bs-grpc-connect-actions button {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    color: var(--t2);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 6px;
    font-size: 10.5px;
    font-weight: 600;
  }
  .bs-grpc-connect-actions button:hover { color: var(--text); }
  .bs-grpc-connect-actions button.primary { color: #fff; background: var(--accent); border-color: transparent; }
  .bs-grpc-connect-actions button:disabled { opacity: 0.55; }
  .bs-grpc-connect-actions .material-symbols-outlined { font-size: 14px; }
  .bs-grpc-connect-dismiss {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    border-radius: 5px;
  }
  .bs-grpc-connect-dismiss:hover { color: var(--text); background: var(--hover); }
  .bs-grpc-connect-dismiss .material-symbols-outlined { font-size: 14px; }
  @media (max-width: 760px) {
    .bs-grpc-connect-alert { grid-template-columns: 30px minmax(0, 1fr) 22px; }
    .bs-grpc-connect-actions { grid-column: 2 / -1; justify-self: start; }
  }
</style>
{#if editorError}
  <div class="bs-grpc-connect-alert" class:guidance={editorError.kind === 'schema'}>
    <div class="bs-grpc-connect-icon" aria-hidden="true">
      <span class="material-symbols-outlined">{editorError.icon}</span>
    </div>
    <div class="bs-grpc-connect-copy">
      <div class="bs-grpc-connect-title">
        <b>{editorError.title}</b>
        {#if tab.grpc?.endpoint}<span>{tab.grpc.endpoint}</span>{/if}
      </div>
      <p>{editorError.message}</p>
      {#if editorError.raw !== editorError.message}
        <details><summary>Technical details</summary><code>{editorError.raw}</code></details>
      {/if}
    </div>
    <div class="bs-grpc-connect-actions">
      {#if editorError.kind === 'schema'}
        <button class="primary" type="button" onclick={importProto}>Import .proto</button>
      {:else if editorError.kind === 'connection'}
        <button class="primary" type="button" disabled={grpcConnecting} onclick={grpcDoConnect}>
          <span class="material-symbols-outlined">refresh</span>{grpcConnecting ? 'Connecting…' : 'Retry'}
        </button>
        <button type="button" onclick={openTlsSettings}>Settings</button>
      {/if}
    </div>
    <button class="bs-grpc-connect-dismiss" type="button" aria-label="Dismiss connection error" onclick={dismissGrpcError}>
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>
{/if}
<div class="bs-rtabs">
  <button class="bs-rtab" class:on={gTab === 'message'} onclick={() => openGrpcEditorSection(tab.id, 'message')}>Message</button>
  <button class="bs-rtab" class:on={gTab === 'metadata'} onclick={() => openGrpcEditorSection(tab.id, 'metadata')}>Metadata</button>
  <button class="bs-rtab" class:on={gTab === 'proto'} onclick={() => openGrpcEditorSection(tab.id, 'proto')}>Service definition</button>
  <button class="bs-rtab" class:on={gTab === 'scripts'} onclick={() => openGrpcEditorSection(tab.id, 'scripts')}>Scripts</button>
</div>
<div class="bs-reqpane">
{#if gTab === 'message'}
  <div class="bs-postman-message">
    <div class="bs-json-editor postman">
      <CodeEditor
        value={tab.grpc?.message ?? ''}
        onChange={(v) => setGrpc({ message: v })}
        lang="json"
        fill
        placeholder="Compose message"
        {varHighlight}
        docId={tab.id}
        ariaLabel="gRPC JSON message"
      />
    </div>
    <div class="bs-msg-foot">
      <button type="button" onclick={grpcLoadExample}>
        <span class="material-symbols-outlined" style="font-size:16px">cleaning_services</span>
        <span class="eg">e.g:</span> Use Example Message
      </button>
      <span class="bs-spacer"></span>
      <button type="button" title="Format JSON" onclick={grpcFormatMessage}>
        <span class="material-symbols-outlined" style="font-size:16px">format_align_left</span>
      </button>
    </div>
  </div>
{:else if gTab === 'metadata'}
  <GrpcMetadataEditor {tab} />
{:else if gTab === 'scripts'}
  <ScriptsEditor
    preRequestScript={tab.grpc?.preRequestScript ?? ''}
    testScript={tab.grpc?.testScript ?? ''}
    onPreRequestChange={(v) => setGrpcScript('preRequestScript', v)}
    onTestChange={(v) => setGrpcScript('testScript', v)}
    docId={tab.id}
  />
{:else}
  <div class="bs-pwrap">
    <div class="bs-empty">
      <b style="margin-bottom:4px">Service definition</b>
      {#if isProtoSource}
        {#if protoFileNames.length}
          <p>Compiled from: {protoFileNames.join(', ')}</p>
        {:else}
          <p>No .proto selected yet.</p>
        {/if}
        {#if (tab.grpc?.importPaths ?? []).length}
          <p>Import roots: {(tab.grpc?.importPaths ?? []).join(', ')}</p>
        {/if}
        <div style="display:flex;gap:8px;margin-top:8px">
          <button type="button" onclick={importProto}>Choose .proto…</button>
          <button type="button" onclick={addImportRoot}>Add import root…</button>
        </div>
      {:else}
        <p>{tab.grpc?.tree ? 'Reflected from the server.' : 'Reflected automatically on first method select.'}</p>
      {/if}
    </div>
  </div>
{/if}
</div>
