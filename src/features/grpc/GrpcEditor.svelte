<script lang="ts">
  /**
   * gRPC request editor for the active tab: the endpoint bar + method picker,
   * the error banner, and the message / metadata / service-definition sub-tabs.
   * This file owns the connect / invoke / stream orchestration;
   * the UI sections live in this folder (Grpc*.svelte) and the pure helpers in grpcEditor.ts.
   *
   * The response area (`.bs-resp`) and its split-resize handle stay in
   * app/AppMain.svelte; this component owns only the gRPC request-editing UI and its
   * state. It reads/writes in-flight + error state via the shared
   * `requestRuntime.busy` / `.grpcErrors` maps (keyed by tab id) so a request started here
   * never shows busy/error on another tab.
   *
   * `methodOpen` is bound from app/ because App's `<svelte:window onpointerdown>`
   * resets it on outside-click; the picker element stops pointer-down
   * propagation so clicking inside doesn't close it.
   */
  import { tick, untrack } from 'svelte';
  import { tabs, grpcSnapshot, titleFromUrl, GRPC_DEFAULT_TITLE } from '$entities/tab';
  import { effectiveAuth, workspace } from '$entities/workspace';
  import { addHistory } from '$entities/history';
  import { grpcTlsFor, currentGrpcPrefs, withGlobalImports, requestPrefs } from '$shared/settings';
  import {
    applyScriptVars,
    addAppConsoleEntry,
    isGrpcNoServicesHint,
    grpcConnectFailureMessage,
    inferGrpcPlaintext,
    methodShort,
    stripsAuthorization,
    isGrpcConnectionCode,
    GRPC_DIAL_BACKOFF_MS,
    parseGrpcurl,
    type GrpcConnectStage,
    requestRuntime,
    grpcEditorUi,
    openGrpcEditorSection,
    scriptUi,
    currentRequestSettings,
    withOAuthToken,
  } from '$entities/request';
  import {
    cancelRequest,
    grpcConnect,
    grpcErrorCode,
    grpcReflect,
    grpcLoadProto,
    grpcCall,
    grpcStream,
    grpcStreamSend,
    grpcStreamEnd,
    grpcPrepare,
    grpcTemplate,
    runScript,
  } from '$shared/ipc';
  import { currentVarScope, environments, requestVariableHighlight } from '$entities/environment';
  import { CodeEditor } from '$shared/editor/components';
  import GrpcErrorAlert from './GrpcErrorAlert.svelte';
  import GrpcTlsPopover from './GrpcTlsPopover.svelte';
  import GrpcMethodPicker from './GrpcMethodPicker.svelte';
  import GrpcMessagePanel from './GrpcMessagePanel.svelte';
  import GrpcRequestTabs from './GrpcRequestTabs.svelte';
  import GrpcMetadataEditor from './GrpcMetadataEditor.svelte';
  import { HttpAuthEditor, RequestScripts } from '$entities/request/components';
  import ProtoImportDialog from './ProtoImportDialog.svelte';
  import GrpcProtoPanel from './GrpcProtoPanel.svelte';
  import { isLargeBody, textStats } from '$shared/editor';
  import { t, t as i18nT } from '$shared/i18n';
  import {
    resolveVars,
    mergeScope,
    buildGrpcScriptContext,
    collectScriptRun,
    scriptFailure,
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
    withoutStaleResponse,
  } from './grpcEditor';

  /** The active environment's `name → value` map, or `{}` when none is selected. */
  function activeEnvMap(): Record<string, string> {
    const id = environments.activeId;
    const env = id ? environments.list.find((e) => e.id === id) : undefined;
    return mergeScope([], env);
  }

  /** The globals `name → value` map. */
  function globalsMap(): Record<string, string> {
    return mergeScope(environments.globals, undefined);
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

  const gTab = $derived(grpcEditorUi.sections[tab.id] ?? 'message');
  // E2 (rules 2, 3, 6): a large message loses its head — type, size, lines and tools move into the tabs row.
  const largeMessage = $derived(gTab === 'message' && !chooseSchema && isLargeBody(tab.grpc?.message ?? ''));
  const messageStats = $derived(largeMessage ? textStats(tab.grpc?.message ?? '') : undefined);
  // Per-tab gRPC in-flight state derived from the shared `requestRuntime.busy` map so the
  // tab's Invoke/Connect buttons reflect ONLY that tab's request.
  const activeBusy = $derived(requestRuntime.busy[tab.id]);
  const grpcConnecting = $derived(activeBusy?.kind === 'connect');
  const grpcInvoking = $derived(activeBusy?.kind === 'invoke');
  // Client/bidi: the stream is open and still takes messages from the editor.
  const streamWritable = $derived(grpcInvoking && !!activeBusy?.writable);
  // Per-tab gRPC error text, so a stale error never shows on the wrong tab.
  const activeGrpcError = $derived(requestRuntime.grpcErrors[tab.id]);
  // Postman-style: when the dial succeeded but the services can't be listed via
  // reflection, show neutral guidance to load a schema instead of a red error
  // (see grpcConnectFailureMessage in entities/request/grpc.ts).
  const grpcGuiding = $derived(isGrpcNoServicesHint(activeGrpcError?.message ?? ''));
  const editorError = $derived(
    activeGrpcError ? presentEditorError(activeGrpcError, grpcGuiding, tab.grpc?.endpoint ?? '', t) : undefined,
  );
  const grpcPlaintext = $derived(
    tab.grpc?.plaintext ?? inferGrpcPlaintext(resolveVars(tab.grpc?.endpoint ?? '', currentVarScope())),
  );
  function setGrpc(patch: Record<string, unknown>): void {
    tabs.updateActive((t) => (t.grpc ? { ...t, grpc: { ...t.grpc, ...patch } } : t));
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
    tabs.updateById(tab.id, (t) =>
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
  // «Перейти к строке» from the response opens the Scripts section; RequestScripts then reveals the line.
  $effect(() => {
    if (scriptUi.jump?.tabId === tab.id) untrack(() => openGrpcEditorSection(tab.id, 'scripts'));
  });

  // «Повторить» / TLS from the response pane's unreachable state (S25).
  $effect(() => {
    const action = grpcEditorUi.action;
    if (!action || action.tabId !== tab.id) return;
    grpcEditorUi.action = null;
    untrack(() => {
      if (action.kind === 'reconnect') void grpcDoConnect();
      else tlsOpen = true;
    });
  });

  async function grpcDoConnect(fromInvoke = false): Promise<void> {
    const t = tab;
    if (!t?.grpc) return;
    const tabId = t.id;
    requestRuntime.clearGrpcError(tabId);
    requestRuntime.updateBusy((m) => ({ ...m, [tabId]: { kind: 'connect' } }));
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
        throw new Error(i18nT('grpc.selectProtoFirst'));
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
            requestPrefs.requestTimeoutMs,
            currentGrpcPrefs(),
          );
          break;
        } catch (e) {
          const wait = backoff[attempts - 1];
          if (wait === undefined || !isGrpcConnectionCode(grpcErrorCode(e))) throw e;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      stage = 'schema';
      const tree =
        t.grpc.source === 'proto'
          ? await grpcLoadProto(connId, t.grpc.protoPaths ?? [], withGlobalImports(t.grpc.importPaths ?? []))
          : await grpcReflect(connId, requestPrefs.requestTimeoutMs);
      tabs.updateById(tabId, (x) => (x.grpc ? { ...x, grpc: { ...x.grpc, connectionId: connId, tree } } : x));
    } catch (e) {
      const message = grpcConnectFailureMessage(t.grpc?.source, stage, e);
      // Only a dial failure is about reaching the server; after it the schema stage shows its own message.
      const code = stage === 'dial' ? grpcErrorCode(e) : undefined;
      // S25: an Invoke that can't reach the server is a response, not an editor error.
      if (fromInvoke && isGrpcConnectionCode(code)) {
        tabs.updateById(tabId, (x) => ({
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
        requestRuntime.setGrpcError(tabId, message, code);
        tabs.updateById(tabId, (x) => withoutStaleResponse(x, code));
      }
    } finally {
      requestRuntime.updateBusy((m) => (m[tabId]?.kind === 'connect' ? omitKey(m, tabId) : m));
    }
  }
  /** G1: a pasted `grpcurl …` fills endpoint, TLS, method, message and metadata. */
  function endpointPaste(text: string): boolean {
    const cmd = parseGrpcurl(text);
    if (!cmd) return false;
    tabs.updateActive((t) => applyGrpcurlImport(t, cmd, titleFromUrl(cmd.endpoint, GRPC_DEFAULT_TITLE)));
    if (requestPrefs.grpcAutoReflect) void tick().then(ensureConnected);
    return true;
  }
  function chooseSource(source: 'reflection' | 'proto'): void {
    setSource(source);
    if (source === 'proto') importProto();
    else if (requestPrefs.grpcAutoReflect) void tick().then(ensureConnected);
  }
  /** Set endpoint and drop any stale connection so the next action reconnects. */
  function setEndpoint(v: string): void {
    tabs.updateActive((t) => withGrpcEndpoint(t, v, titleFromUrl(v, GRPC_DEFAULT_TITLE)));
  }

  // S29/S30: connection popover (GrpcTlsPopover) — open state lives here so the response pane can open it.
  let tlsOpen = $state(false);
  const stripAuth = $derived(stripsAuthorization(tab.grpc ?? {}, grpcPlaintext));
  /** G4: ⌘I fills the whole message with an example. (⌘P lives in GrpcMethodPicker.) ⇧⌘↵ ends an open stream. */
  function onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyI' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void grpcLoadExample();
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter' && streamWritable) {
      e.preventDefault();
      void grpcEndStream();
    }
  }
  function dismissGrpcError(): void {
    const tabId = tab.id;
    requestRuntime.clearGrpcError(tabId);
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
      tabs.updateById(tabId, (t) => (t.grpc?.method === symbol ? { ...t, grpc: { ...t.grpc, message: tpl } } : t));
    } catch {
      // Keep the selected method; leave the existing message untouched.
    }
  }
  async function grpcLoadExample(): Promise<void> {
    const tabId = tab.id;
    let g = tabs.list.find((t) => t.id === tabId)?.grpc;
    if (!g?.method) {
      requestRuntime.setGrpcError(tabId, t('grpc.selectMethodFirst'));
      return;
    }
    if (!g.connectionId) {
      await ensureConnected();
      g = tabs.list.find((t) => t.id === tabId)?.grpc;
    }
    if (!g?.connectionId || !g.method) return;
    requestRuntime.clearGrpcError(tabId);
    await loadGrpcTemplate(tabId, g.connectionId, g.method);
  }
  /** Client/bidi: send the editor message into the open stream. */
  async function grpcSendMore(): Promise<void> {
    const tabId = tab.id;
    const busy = requestRuntime.busy[tabId];
    const g = tabs.list.find((t) => t.id === tabId)?.grpc;
    if (!busy?.writable || !busy.requestId || !g) return;
    try {
      const { message: body } = await grpcPrepare({ message: g.message, scope: currentVarScope() });
      await grpcStreamSend(busy.requestId, body);
      requestRuntime.clearGrpcError(tabId);
      tabs.updateById(tabId, (x) => {
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
      requestRuntime.setGrpcError(tabId, String(e));
    }
  }
  /** Client/bidi: half-close; the server's replies keep arriving until it finishes. */
  async function grpcEndStream(): Promise<void> {
    const tabId = tab.id;
    const requestId = requestRuntime.busy[tabId]?.requestId;
    if (!requestId) return;
    requestRuntime.updateBusy((m) =>
      m[tabId]?.requestId === requestId ? { ...m, [tabId]: { ...m[tabId], writable: false } } : m,
    );
    tabs.updateById(tabId, (x) =>
      x.grpcStream ? { ...x, grpcStream: { ...x.grpcStream, halfClosedAt: Date.now() } } : x,
    );
    await grpcStreamEnd(requestId);
  }
  async function grpcStop(): Promise<void> {
    const requestId = requestRuntime.busy[tab.id]?.requestId;
    if (requestId) await cancelRequest(requestId);
  }
  async function grpcDoInvoke(): Promise<void> {
    const t0 = tab;
    if (!t0) return;
    const tabId = t0.id;
    // If this tab already has an invoke in flight, the button is a Cancel
    // (or Send, while a client/bidi stream is still open).
    const inFlight = requestRuntime.busy[tabId];
    if (inFlight?.kind === 'invoke' && inFlight.writable) return grpcSendMore();
    if (inFlight?.kind === 'invoke' && inFlight.requestId) {
      await cancelRequest(inFlight.requestId);
      return;
    }
    if (!t0.grpc?.connectionId && t0.grpc?.endpoint.trim()) await grpcDoConnect(true);
    // Re-read the originating tab after the (awaited) connect; never assume the
    // active tab is still this one.
    const g = tabs.list.find((t) => t.id === tabId)?.grpc;
    // Never no-op silently: any earlier response stays visible in the response
    // pane, so a mute return here makes a dead Invoke look like a fresh success.
    // A failed connect/reflect already left its banner via grpcDoConnect; the
    // two cases IT can't explain (blank endpoint, no method) get their own.
    if (!g?.connectionId) {
      if (!g?.endpoint.trim()) requestRuntime.setGrpcError(tabId, t('grpc.endpointFirst'));
      return;
    }
    if (!g.method) {
      requestRuntime.setGrpcError(tabId, t('grpc.selectMethodFirst'));
      return;
    }
    const requestId = crypto.randomUUID();
    requestRuntime.clearGrpcError(tabId);
    requestRuntime.updateBusy((m) => ({ ...m, [tabId]: { kind: 'invoke', requestId } }));

    let pre: ScriptResult | undefined;
    let post: ScriptResult | undefined;
    const logs = () => [...(pre?.logs ?? []), ...(post?.logs ?? [])];
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
      pre = await runScript('pre-request', g.preRequestScript, context).catch((e) => scriptFailure(String(e)));
      applyScriptVars(pre);
      if (pre.error) {
        const testResults = collectScriptRun({ pre, at: Date.now() });
        // Nothing was sent: drop the previous call's result so it doesn't read as this one's (SC6).
        tabs.updateById(tabId, (x) => ({ ...x, testResults, grpcResult: undefined, grpcStream: undefined }));
        addAppConsoleEntry({
          protocol: 'grpc',
          method: methodShort(g.method ?? '') || 'gRPC',
          url: g.endpoint,
          ok: false,
          status: 'SCRIPT ERROR',
          elapsedMs: 0,
          message: pre.error,
          logs: logs(),
        });
        requestRuntime.setGrpcError(tabId, t('grpc.err.preRequest', { err: pre.error ?? '' }));
        requestRuntime.updateBusy((m) => (m[tabId]?.requestId === requestId ? omitKey(m, tabId) : m));
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
    const sentAt = Date.now();
    // Interpolate {{var}} placeholders (globals + active environment, now
    // including anything the pre-request script set) into the message JSON
    // and metadata values just before dispatch.
    // bonk-core prepares the wire payload (an empty editor goes out as `{}`), as for bonk-mcp.
    let resolvedMessage = '{}';
    let resolvedMetadata: Record<string, string> = {};
    // S20: streams (server, client, bidi) arrive message by message; everything else is a unary call.
    // A client/bidi stream sends the editor message (an array = one message per element),
    // then stays open for Send until End.
    const method = g.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === g.method);
    const streaming = !!method?.serverStreaming || !!method?.clientStreaming;
    try {
      ({ message: resolvedMessage, metadata: resolvedMetadata } = await grpcPrepare({
        auth: (
          await withOAuthToken(
            effectiveAuth(workspace.tree, tab.savedPath, g.auth),
            currentVarScope(),
            currentRequestSettings(),
          )
        ).auth,
        message,
        metadata,
        scope: currentVarScope(),
        stripAuthorization: stripAuth,
      }));
      if (streaming) {
        const sent = method?.clientStreaming ? sentEntries(resolvedMessage, 0) : [];
        if (method?.clientStreaming)
          requestRuntime.updateBusy((m) =>
            m[tabId]?.requestId === requestId ? { ...m, [tabId]: { ...m[tabId], writable: true } } : m,
          );
        tabs.updateById(tabId, (x) => ({
          ...x,
          grpcResult: undefined,
          grpcStream: {
            messages: sent,
            done: false,
            startedAt: Date.now(),
            kind: method?.clientStreaming ? (method.serverStreaming ? 'bidi' : 'client') : 'server',
          },
        }));
        result = await grpcStream(g.connectionId, g.method, resolvedMessage, resolvedMetadata, requestId, (msg) =>
          tabs.updateById(tabId, (x) => {
            const s = x.grpcStream ?? { messages: [], done: false, startedAt: Date.now() };
            return {
              ...x,
              grpcStream: msg.headers ? { ...s, headers: msg.headers } : { ...s, messages: [...s.messages, msg] },
            };
          }),
        );
      } else {
        tabs.updateById(tabId, (x) => ({ ...x, grpcStream: undefined }));
        result = await grpcCall(
          g.connectionId,
          g.method,
          resolvedMessage,
          resolvedMetadata,
          requestId,
          requestPrefs.grpcDeadlineMs,
        );
      }
    } catch (e) {
      result = invokeFailureResult(e);
    } finally {
      requestRuntime.updateBusy((m) => (m[tabId]?.requestId === requestId ? omitKey(m, tabId) : m));
    }

    // Test script — runs against the result; its env/globals writes are
    // applied and its tests/logs (plus any pre-request ones) attach to the tab.
    let postMs: number | undefined;
    if (g.testScript && g.testScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint: g.endpoint, message: resolvedMessage, metadata: resolvedMetadata },
        result,
        activeEnvMap(),
        globalsMap(),
      );
      const t0 = performance.now();
      post = await runScript('test', g.testScript, context).catch((e) => scriptFailure(String(e)));
      postMs = Math.round(performance.now() - t0);
      applyScriptVars(post);
    }
    const testError = post?.error ?? undefined;
    const send = {
      t: sentAt,
      text: `${methodShort(g.method)} ${g.endpoint}`,
      status: result.status,
      ms: result.elapsed_ms,
    };
    const testResults = collectScriptRun({ pre, post, send, postMs, at: Date.now() });

    tabs.updateById(tabId, (x) => ({
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
      logs: logs(),
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
  // message, and metadata editors; re-derived whenever the variables change.
  const varHighlight = $derived(
    requestVariableHighlight(environments.globals, environments.list, environments.activeId),
  );
</script>

<div class="bs-urlbar bs-grpc-bar">
  <div class="bs-urlfield bs-grpc-field">
    <div class="bs-method-wrap">
      <button
        class="bs-method"
        style="color:var(--method-grpc)"
        type="button"
        aria-haspopup="menu"
        title={t('grpc.requestType')}
        onclick={onSwitch}
      >
        <span>gRPC</span>
        <span class="material-symbols-outlined">expand_more</span>
      </button>
    </div>
    <CodeEditor
      value={tab.grpc?.endpoint ?? ''}
      onChange={setEndpoint}
      singleLine
      placeholder={t('grpc.endpointPlaceholder')}
      onPaste={endpointPaste}
      onBlur={() => {
        if (requestPrefs.grpcAutoReflect) void ensureConnected();
      }}
      {varHighlight}
      docId={tab.id}
      ariaLabel={t('grpc.endpointAria')}
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
  <button
    class="bs-send"
    disabled={noAddress && !grpcInvoking}
    class:cancelling={grpcInvoking && !streamMethod}
    class:stop={grpcInvoking && streamMethod && !streamWritable}
    aria-busy={grpcInvoking}
    title={grpcInvoking && !streamWritable ? t('grpc.invoking') : undefined}
    onclick={grpcDoInvoke}
  >
    <span class="go">
      {#if streamWritable}<span class="material-symbols-outlined up" aria-hidden="true">arrow_upward</span><span
          >{t('grpc.send')}</span
        ><kbd>⌘↵</kbd>{:else if grpcInvoking && streamMethod}<span class="stop-square" aria-hidden="true"></span><span
          >{t('grpc.stop')}</span
        >{:else if grpcInvoking}<span>{t('common.cancel')}</span><kbd>Esc</kbd>{:else}<span>{t('grpc.invoke')}</span
        ><kbd>⌘↵</kbd>{/if}
    </span>
  </button>
  <!-- Client/bidi open: Send stays the main button; «Завершить» half-closes, ■ cancels. -->
  {#if streamWritable}
    <button class="bs-stream-btn" type="button" title={t('grpc.endStreamTitle')} onclick={grpcEndStream}
      ><span class="material-symbols-outlined" aria-hidden="true">keyboard_tab</span>{t('grpc.endStream')}<kbd>⇧⌘↵</kbd
      ></button
    >
    <button
      class="bs-stream-btn stop"
      type="button"
      aria-label={t('grpc.stop')}
      title={t('grpc.stop')}
      onclick={grpcStop}><span class="stop-square" aria-hidden="true"></span></button
    >
  {/if}
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
    <RequestScripts
      {tab}
      preRequestScript={tab.grpc?.preRequestScript ?? ''}
      testScript={tab.grpc?.testScript ?? ''}
      onPreRequestChange={(v) => setGrpcScript('preRequestScript', v)}
      onTestChange={(v) => setGrpcScript('testScript', v)}
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
