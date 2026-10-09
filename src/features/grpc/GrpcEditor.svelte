<script lang="ts">
  /**
   * gRPC request editor for the active tab: the endpoint bar + method picker,
   * the error banner, and the message / metadata / service-definition sub-tabs.
   * This file owns the connect / invoke / stream orchestration (store-bound);
   * the UI sections live in ./grpc/ and the pure helpers in domain/grpcEditor.ts.
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
  import { tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { tabs, updateActiveTab, updateTabById, grpcSnapshot, titleFromUrl, GRPC_DEFAULT_TITLE } from '$entities/tab';
  import { collections } from '$entities/workspace';
  import { addHistory } from '$entities/history';
  import {
    requestTimeoutMs,
    grpcDeadlineMs,
    grpcAutoReflect,
    grpcTlsFor,
    currentGrpcPrefs,
    withGlobalImports,
  } from '$shared/settings';
  import {
    applyScriptVars,
    addAppConsoleEntry,
    busyMap,
    grpcErrorMap,
    grpcEditorAction,
    grpcEditorSections,
    isGrpcNoServicesHint,
    grpcConnectFailureMessage,
    inferGrpcPlaintext,
    methodShort,
    stripsAuthorization,
    isRetryableDialError,
    GRPC_DIAL_BACKOFF_MS,
    parseGrpcurl,
    type GrpcConnectStage,
  } from '$entities/request';
  import {
    cancelRequest,
    grpcConnect,
    grpcReflect,
    grpcLoadProto,
    grpcCall,
    grpcStream,
    grpcStreamSend,
    grpcStreamEnd,
    grpcTemplate,
    runScript,
  } from '$shared/ipc';
  import {
    currentVarScope,
    globals,
    environments,
    activeEnvironmentId,
    requestVariableHighlight,
  } from '$entities/environment';
  import { CodeEditor, ScriptsEditor } from '$shared/editor/components';
  import GrpcErrorAlert from './GrpcErrorAlert.svelte';
  import GrpcTlsPopover from './GrpcTlsPopover.svelte';
  import GrpcMethodPicker from './GrpcMethodPicker.svelte';
  import GrpcMessagePanel from './GrpcMessagePanel.svelte';
  import GrpcRequestTabs from './GrpcRequestTabs.svelte';
  import GrpcMetadataEditor from './GrpcMetadataEditor.svelte';
  import { HttpAuthEditor } from '$entities/request/components';
  import ProtoImportDialog from './ProtoImportDialog.svelte';
  import GrpcProtoPanel from './GrpcProtoPanel.svelte';
  import { isLargeBody, textStats } from '$shared/editor';
  import { t, t as i18nT } from '$shared/i18n';
  import {
    resolveVars,
    mergeScope,
    buildGrpcScriptContext,
    applyGrpcRequestPatch,
    type ScriptResult,
    type Tab,
    type GrpcResult,
  } from '$shared/model';
  import {
    presentEditorError,
    sentEntries,
    omitKey,
    invokeFailureResult,
    withGrpcEndpoint,
    applyGrpcurlImport,
    resolveOutgoingGrpc,
  } from './grpcEditor';

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
    onSwitch = () => {},
  }: {
    tab: Tab;
    methodOpen: boolean;
    /** Protocol pill: opens the request-type menu. */
    onSwitch?: (e: MouseEvent) => void;
  } = $props();

  // S19: the selected method's request type drives the caption and the validation hint.
  const selectedMethod = $derived(
    tab.grpc?.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === tab.grpc?.method),
  );
  const metadataCount = $derived(Object.keys(tab.grpc?.metadata ?? {}).length);
  // G1: nothing to show in the editor until there's a schema — pick where it comes from.
  const chooseSchema = $derived(!tab.grpc?.tree && !tab.grpc?.method && !(tab.grpc?.message ?? '').trim());
  const noAddress = $derived(!(tab.grpc?.endpoint ?? '').trim());
  const streamMethod = $derived(!!selectedMethod?.serverStreaming || !!selectedMethod?.clientStreaming);

  const gTab = $derived($grpcEditorSections[tab.id] ?? 'message');
  // E2 (rules 2, 3, 6): a large message loses its head — type, size, lines and tools move into the tabs row.
  const largeMessage = $derived(gTab === 'message' && !chooseSchema && isLargeBody(tab.grpc?.message ?? ''));
  const messageStats = $derived(largeMessage ? textStats(tab.grpc?.message ?? '') : undefined);
  // Per-tab gRPC in-flight state derived from the shared `busyMap` store so the
  // tab's Invoke/Connect buttons reflect ONLY that tab's request.
  const activeBusy = $derived($busyMap[tab.id]);
  const grpcConnecting = $derived(activeBusy?.kind === 'connect');
  const grpcInvoking = $derived(activeBusy?.kind === 'invoke');
  // Client/bidi: the stream is open and still takes messages from the editor.
  const streamWritable = $derived(grpcInvoking && !!activeBusy?.writable);
  // Per-tab gRPC error text, so a stale error never shows on the wrong tab.
  const activeGrpcError = $derived($grpcErrorMap[tab.id] ?? '');
  // Postman-style: when the dial succeeded but the services can't be listed via
  // reflection, show neutral guidance to load a schema instead of a red error
  // (see grpcConnectFailureMessage in domain/grpc).
  const grpcGuiding = $derived(isGrpcNoServicesHint(activeGrpcError));
  const editorError = $derived(
    activeGrpcError ? presentEditorError(activeGrpcError, grpcGuiding, tab.grpc?.endpoint ?? '', $t) : undefined,
  );
  const grpcPlaintext = $derived(
    tab.grpc?.plaintext ?? inferGrpcPlaintext(resolveVars(tab.grpc?.endpoint ?? '', currentVarScope())),
  );
  function setGrpc(patch: Record<string, unknown>): void {
    updateActiveTab((t) => (t.grpc ? { ...t, grpc: { ...t.grpc, ...patch } } : t));
  }
  function setGrpcScript(field: 'preRequestScript' | 'testScript', value: string): void {
    setGrpc({ [field]: value === '' ? undefined : value });
  }
  function setSource(source: 'reflection' | 'proto'): void {
    if (source === (tab.grpc?.source ?? 'reflection')) return;
    setGrpc({ source, connectionId: undefined, tree: undefined });
  }
  // S27: .proto files are picked in a dialog that checks each file first.
  let protoDialogOpen = $state(false);
  function importProto(): void {
    methodOpen = false;
    protoDialogOpen = true;
  }
  async function connectProto(protoPaths: string[], importPaths: string[]): Promise<void> {
    updateTabById(tab.id, (t) =>
      t.grpc
        ? {
            ...t,
            grpc: { ...t.grpc, source: 'proto', protoPaths, importPaths, connectionId: undefined, tree: undefined },
          }
        : t,
    );
    await tick();
    if (tab.grpc?.endpoint.trim()) await grpcDoConnect();
  }
  // «Повторить» / TLS from the response pane's unreachable state (S25).
  $effect(() => {
    const action = $grpcEditorAction;
    if (!action || action.tabId !== tab.id) return;
    grpcEditorAction.set(null);
    untrack(() => {
      if (action.kind === 'reconnect') void grpcDoConnect();
      else tlsOpen = true;
    });
  });

  async function grpcDoConnect(fromInvoke = false): Promise<void> {
    const t = tab;
    if (!t?.grpc) return;
    const tabId = t.id;
    grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
    busyMap.update((m) => ({ ...m, [tabId]: { kind: 'connect' } }));
    // Track which step failed: a dial failure (bad/unresolved endpoint,
    // unreachable server) must show the real error — schema guidance can't fix
    // it — while a post-dial reflection failure keeps the friendly hint.
    let stage: GrpcConnectStage = 'dial';
    // S25: an Invoke retries an unreachable server — safe, the call never left.
    const backoff = fromInvoke ? GRPC_DIAL_BACKOFF_MS : [];
    const startedAt = Date.now();
    let attempts = 0;
    try {
      if (t.grpc.source === 'proto' && !t.grpc.protoPaths?.length) {
        throw new Error(get(i18nT)('grpc.selectProtoFirst'));
      }
      const endpoint = resolveVars(t.grpc.endpoint, currentVarScope());
      let connId: string;
      for (;;) {
        attempts += 1;
        try {
          connId = await grpcConnect(
            endpoint,
            grpcPlaintext,
            grpcTlsFor(endpoint, t.grpc.tls),
            $requestTimeoutMs,
            currentGrpcPrefs(),
          );
          break;
        } catch (e) {
          const wait = backoff[attempts - 1];
          if (wait === undefined || !isRetryableDialError(String(e))) throw e;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      stage = 'schema';
      const tree =
        t.grpc.source === 'proto'
          ? await grpcLoadProto(connId, t.grpc.protoPaths ?? [], withGlobalImports(t.grpc.importPaths ?? []))
          : await grpcReflect(connId, $requestTimeoutMs);
      updateTabById(tabId, (x) => (x.grpc ? { ...x, grpc: { ...x.grpc, connectionId: connId, tree } } : x));
    } catch (e) {
      const message = grpcConnectFailureMessage(t.grpc?.source, stage, e);
      // S25: an Invoke that can't reach the server is a response, not an editor error.
      if (fromInvoke && stage === 'dial' && !/invalid endpoint|invalid uri|proto/i.test(message)) {
        updateTabById(tabId, (x) => ({
          ...x,
          grpcStream: undefined,
          grpcResult: {
            ok: false,
            status: 'UNAVAILABLE',
            body: message,
            elapsed_ms: Date.now() - startedAt,
            size_bytes: 0,
            attempts,
            backoffMs: backoff.slice(0, attempts - 1),
          },
        }));
      } else {
        grpcErrorMap.update((m) => ({ ...m, [tabId]: message }));
      }
    } finally {
      busyMap.update((m) => (m[tabId]?.kind === 'connect' ? omitKey(m, tabId) : m));
    }
  }
  /** G1: a pasted `grpcurl …` fills endpoint, TLS, method, message and metadata. */
  function endpointPaste(text: string): boolean {
    const cmd = parseGrpcurl(text);
    if (!cmd) return false;
    updateActiveTab((t) => applyGrpcurlImport(t, cmd, titleFromUrl(cmd.endpoint, GRPC_DEFAULT_TITLE)));
    if ($grpcAutoReflect) void tick().then(ensureConnected);
    return true;
  }
  function chooseSource(source: 'reflection' | 'proto'): void {
    setSource(source);
    if (source === 'proto') importProto();
    else if ($grpcAutoReflect) void tick().then(ensureConnected);
  }
  /** Set endpoint and drop any stale connection so the next action reconnects. */
  function setEndpoint(v: string): void {
    updateActiveTab((t) => withGrpcEndpoint(t, v, titleFromUrl(v, GRPC_DEFAULT_TITLE)));
  }

  // S29/S30: connection popover (GrpcTlsPopover) — open state lives here so the response pane can open it.
  let tlsOpen = $state(false);
  const stripAuth = $derived(stripsAuthorization(tab.grpc ?? {}, grpcPlaintext));
  /** G4: ⌘I fills the whole message with an example. (⌘P lives in GrpcMethodPicker.) */
  function onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyI' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void grpcLoadExample();
    }
  }
  function dismissGrpcError(): void {
    const tabId = tab.id;
    grpcErrorMap.update((current) => omitKey(current, tabId));
  }
  /** Connect + reflect automatically if not already connected. */
  async function ensureConnected(): Promise<void> {
    const t = tab;
    if (!t?.grpc || t.grpc.connectionId || !t.grpc.endpoint.trim()) return;
    await grpcDoConnect();
  }
  async function loadGrpcTemplate(tabId: string, connectionId: string, symbol: string): Promise<void> {
    try {
      const tpl = await grpcTemplate(connectionId, symbol);
      updateTabById(tabId, (t) => (t.grpc?.method === symbol ? { ...t, grpc: { ...t.grpc, message: tpl } } : t));
    } catch {
      // Keep the selected method; leave the existing message untouched.
    }
  }
  async function grpcLoadExample(): Promise<void> {
    const tabId = tab.id;
    let g = $tabs.find((t) => t.id === tabId)?.grpc;
    if (!g?.method) {
      grpcErrorMap.update((m) => ({ ...m, [tabId]: $t('grpc.selectMethodFirst') }));
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
  /** Client/bidi: send the editor message into the open stream. */
  async function grpcSendMore(): Promise<void> {
    const tabId = tab.id;
    const busy = $busyMap[tabId];
    const g = $tabs.find((t) => t.id === tabId)?.grpc;
    if (!busy?.writable || !busy.requestId || !g) return;
    const body = resolveVars(g.message, currentVarScope()).trim() || '{}';
    try {
      await grpcStreamSend(busy.requestId, body);
      grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
      updateTabById(tabId, (x) => {
        const s = x.grpcStream;
        if (!s) return x;
        return {
          ...x,
          grpcStream: {
            ...s,
            messages: [...s.messages, ...sentEntries(body, s.messages.filter((m) => m.sent).length)],
          },
        };
      });
    } catch (e) {
      grpcErrorMap.update((m) => ({ ...m, [tabId]: String(e) }));
    }
  }
  /** Client/bidi: half-close; the server's replies keep arriving until it finishes. */
  async function grpcEndStream(): Promise<void> {
    const tabId = tab.id;
    const requestId = $busyMap[tabId]?.requestId;
    if (!requestId) return;
    busyMap.update((m) =>
      m[tabId]?.requestId === requestId ? { ...m, [tabId]: { ...m[tabId], writable: false } } : m,
    );
    await grpcStreamEnd(requestId);
  }
  async function grpcStop(): Promise<void> {
    const requestId = $busyMap[tab.id]?.requestId;
    if (requestId) await cancelRequest(requestId);
  }
  async function grpcDoInvoke(): Promise<void> {
    const t0 = tab;
    if (!t0) return;
    const tabId = t0.id;
    // If this tab already has an invoke in flight, the button is a Cancel
    // (or Send, while a client/bidi stream is still open).
    const inFlight = $busyMap[tabId];
    if (inFlight?.kind === 'invoke' && inFlight.writable) return grpcSendMore();
    if (inFlight?.kind === 'invoke' && inFlight.requestId) {
      await cancelRequest(inFlight.requestId);
      return;
    }
    if (!t0.grpc?.connectionId && t0.grpc?.endpoint.trim()) await grpcDoConnect(true);
    // Re-read the originating tab after the (awaited) connect; never assume the
    // active tab is still this one.
    const g = $tabs.find((t) => t.id === tabId)?.grpc;
    // Never no-op silently: any earlier response stays visible in the response
    // pane, so a mute return here makes a dead Invoke look like a fresh success.
    // A failed connect/reflect already left its banner via grpcDoConnect; the
    // two cases IT can't explain (blank endpoint, no method) get their own.
    if (!g?.connectionId) {
      if (!g?.endpoint.trim()) grpcErrorMap.update((m) => ({ ...m, [tabId]: $t('grpc.endpointFirst') }));
      return;
    }
    if (!g.method) {
      grpcErrorMap.update((m) => ({ ...m, [tabId]: $t('grpc.selectMethodFirst') }));
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
        grpcErrorMap.update((m) => ({ ...m, [tabId]: $t('grpc.err.preRequest', { err: pre.error ?? '' }) }));
        busyMap.update((m) => (m[tabId]?.requestId === requestId ? omitKey(m, tabId) : m));
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
    // A visually empty editor represents protobuf's valid empty message: sent as `{}` on the wire.
    const { message: resolvedMessage, metadata: resolvedMetadata } = resolveOutgoingGrpc(
      g.auth,
      message,
      metadata,
      $collections,
      tab.savedPath,
      scope,
      stripAuth,
    );
    // S20: streams (server, client, bidi) arrive message by message; everything else is a unary call.
    // A client/bidi stream sends the editor message (an array = one message per element),
    // then stays open for Send until End.
    const method = g.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === g.method);
    const streaming = !!method?.serverStreaming || !!method?.clientStreaming;
    try {
      if (streaming) {
        const sent = method?.clientStreaming ? sentEntries(resolvedMessage, 0) : [];
        if (method?.clientStreaming)
          busyMap.update((m) =>
            m[tabId]?.requestId === requestId ? { ...m, [tabId]: { ...m[tabId], writable: true } } : m,
          );
        updateTabById(tabId, (x) => ({
          ...x,
          grpcResult: undefined,
          grpcStream: { messages: sent, done: false, startedAt: Date.now() },
        }));
        result = await grpcStream(g.connectionId, g.method, resolvedMessage, resolvedMetadata, requestId, (msg) =>
          updateTabById(tabId, (x) => {
            const s = x.grpcStream ?? { messages: [], done: false, startedAt: Date.now() };
            return {
              ...x,
              grpcStream: msg.headers ? { ...s, headers: msg.headers } : { ...s, messages: [...s.messages, msg] },
            };
          }),
        );
      } else {
        updateTabById(tabId, (x) => ({ ...x, grpcStream: undefined }));
        result = await grpcCall(
          g.connectionId,
          g.method,
          resolvedMessage,
          resolvedMetadata,
          requestId,
          $grpcDeadlineMs,
        );
      }
    } catch (e) {
      result = invokeFailureResult(e);
    } finally {
      busyMap.update((m) => (m[tabId]?.requestId === requestId ? omitKey(m, tabId) : m));
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

    updateTabById(tabId, (x) => ({
      ...x,
      grpcResult: result,
      testResults,
      grpcStream: x.grpcStream && { ...x.grpcStream, done: true },
    }));
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
    addHistory({
      id: crypto.randomUUID(),
      protocol: 'grpc',
      request: { method: 'GRPC', url: g.endpoint + ' ' + (g.method ?? ''), headers: {} },
      status: 0,
      ok: result.ok,
      grpc: grpcSnapshot(g),
      at: Date.now(),
      savedPath: tab.savedPath,
      title: tab.title,
    });
  }
  // `{{var}}` inline highlight + hover quick-set, shared by the endpoint,
  // message, and metadata editors; re-derived whenever the variable stores
  // change.
  const varHighlight = $derived(requestVariableHighlight($globals, $environments, $activeEnvironmentId));
</script>

<div class="bs-urlbar bs-grpc-bar">
  <div class="bs-urlfield bs-grpc-field">
    <div class="bs-method-wrap">
      <button
        class="bs-method"
        style="color:var(--method-grpc)"
        type="button"
        aria-haspopup="menu"
        title={$t('grpc.requestType')}
        onclick={onSwitch}
      >
        <span>gRPC</span>
        <span class="material-symbols-outlined" style="font-size:15px">expand_more</span>
      </button>
    </div>
    <CodeEditor
      value={tab.grpc?.endpoint ?? ''}
      onChange={setEndpoint}
      singleLine
      placeholder={$t('grpc.endpointPlaceholder')}
      onPaste={endpointPaste}
      onBlur={() => {
        if ($grpcAutoReflect) void ensureConnected();
      }}
      {varHighlight}
      docId={tab.id}
      ariaLabel={$t('grpc.endpointAria')}
    />
    <GrpcTlsPopover {tab} plaintext={grpcPlaintext} {stripAuth} bind:open={tlsOpen} onPatch={setGrpc} />
    <GrpcMethodPicker
      {tab}
      bind:open={methodOpen}
      connecting={grpcConnecting}
      {noAddress}
      {ensureConnected}
      onRefresh={() => grpcDoConnect()}
      onImportProto={importProto}
    />
  </div>
  {#if streamWritable}
    <button class="bs-stream-btn" type="button" title={$t('grpc.endStreamTitle')} onclick={grpcEndStream}
      >{$t('grpc.endStream')}</button
    >
    <button
      class="bs-stream-btn stop"
      type="button"
      aria-label={$t('grpc.stop')}
      title={$t('grpc.stop')}
      onclick={grpcStop}><span class="stop-square" aria-hidden="true"></span></button
    >
  {/if}
  <button
    class="bs-send"
    disabled={noAddress && !grpcInvoking}
    class:cancelling={grpcInvoking && !streamMethod}
    class:stop={grpcInvoking && streamMethod && !streamWritable}
    aria-busy={grpcInvoking}
    title={grpcInvoking && !streamWritable ? $t('grpc.invoking') : undefined}
    onclick={grpcDoInvoke}
  >
    <span class="go">
      {#if streamWritable}<span>{$t('grpc.send')}</span>{:else if grpcInvoking && streamMethod}<span
          class="stop-square"
          aria-hidden="true"
        ></span><span>{$t('grpc.stop')}</span><kbd>⌘↵</kbd>{:else if grpcInvoking}<span>{$t('common.cancel')}</span><kbd
          >Esc</kbd
        >{:else}<span>{$t('grpc.invoke')}</span><kbd>⌘↵</kbd>{/if}
    </span>
  </button>
</div>

<!-- Connection failures render in the response pane as S25 «Сервер недоступен»; this strip is for the rest. -->
{#if editorError && editorError.kind !== 'connection'}
  <GrpcErrorAlert
    error={editorError}
    endpoint={tab.grpc?.endpoint ?? ''}
    onImportProto={importProto}
    onDismiss={dismissGrpcError}
  />
{/if}
<GrpcRequestTabs {tab} section={gTab} {metadataCount} {messageStats} {selectedMethod} onLoadExample={grpcLoadExample} />
<div class="bs-reqpane" role="tabpanel" id="bs-grpcpanel" aria-labelledby="bs-gtab-{gTab}">
  {#if gTab === 'message'}
    <GrpcMessagePanel
      {tab}
      {selectedMethod}
      {chooseSchema}
      {largeMessage}
      {varHighlight}
      {ensureConnected}
      onMessageChange={(v) => setGrpc({ message: v })}
      onChooseSource={chooseSource}
      onLoadExample={grpcLoadExample}
    />
  {:else if gTab === 'metadata'}
    <GrpcMetadataEditor {tab} />
  {:else if gTab === 'auth'}
    <HttpAuthEditor {tab} />
  {:else if gTab === 'scripts'}
    <ScriptsEditor
      preRequestScript={tab.grpc?.preRequestScript ?? ''}
      testScript={tab.grpc?.testScript ?? ''}
      onPreRequestChange={(v) => setGrpcScript('preRequestScript', v)}
      onTestChange={(v) => setGrpcScript('testScript', v)}
      docId={tab.id}
    />
  {:else}
    <div class="bs-http-body"><GrpcProtoPanel {tab} onSetSource={setSource} onAddProto={importProto} /></div>
  {/if}
</div>

<ProtoImportDialog
  bind:open={protoDialogOpen}
  protoPaths={tab.grpc?.protoPaths ?? []}
  importPaths={tab.grpc?.importPaths ?? []}
  onConnect={connectProto}
/>
<svelte:window onkeydown={onKeydown} />
