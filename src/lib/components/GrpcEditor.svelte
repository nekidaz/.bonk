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
  import {
    tabs,
    updateActiveTab,
    updateTabById,
    addHistory,
    grpcSnapshot,
    titleFromUrl,
    GRPC_DEFAULT_TITLE,
    requestTimeoutMs,
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
  } from '../api';
  import { busyMap, grpcErrorMap } from '../requestRuntime';
  import { selectMethod, metaText, grpcMethodLabel } from '../grpcActions';
  import { hl, lineNumbers, syncJsonScroll } from '../domain/highlight';
  import type { Tab, GrpcResult } from '../domain/types';

  let { tab, methodOpen = $bindable() }: { tab: Tab; methodOpen: boolean } = $props();

  let gTab = $state<'message' | 'metadata' | 'proto'>('message');
  // Per-tab gRPC in-flight state derived from the shared `busyMap` store so the
  // tab's Invoke/Connect buttons reflect ONLY that tab's request.
  const activeBusy = $derived($busyMap[tab.id]);
  const grpcConnecting = $derived(activeBusy?.kind === 'connect');
  const grpcInvoking = $derived(activeBusy?.kind === 'invoke');
  // Per-tab gRPC error text, so a stale error never shows on the wrong tab.
  const activeGrpcError = $derived($grpcErrorMap[tab.id] ?? '');
  // Postman-style: when services can't be loaded via reflection (server has no
  // reflection or is unreachable), show neutral guidance to load a schema
  // instead of a red error.
  const GRPC_NO_SERVICES_HINT =
    "Couldn't load services from the server. Import a .proto file (in the schema menu above) to load this API's services and methods.";
  const grpcGuiding = $derived(activeGrpcError === GRPC_NO_SERVICES_HINT);

  function setGrpc(patch: Record<string, unknown>): void {
    updateActiveTab((t) => ({ ...t, grpc: { ...t.grpc!, ...patch } }));
  }
  function useReflection(): void {
    setGrpc({ source: 'reflection', connectionId: undefined, tree: undefined });
  }
  async function importProto(): Promise<void> {
    const tabId = tab.id;
    const picked = await protoPick();
    if (!picked || picked.length === 0) return;
    updateTabById(tabId, (t) => ({
      ...t,
      grpc: { ...t.grpc!, source: 'proto', protoPaths: picked, connectionId: undefined, tree: undefined },
    }));
  }
  async function addImportRoot(): Promise<void> {
    const tabId = tab.id;
    const dir = await workspacePickFolder();
    if (!dir) return;
    const current = $tabs.find((t) => t.id === tabId)?.grpc?.importPaths ?? [];
    const roots = [...current, dir];
    updateTabById(tabId, (t) => ({
      ...t,
      grpc: { ...t.grpc!, source: 'proto', importPaths: roots, connectionId: undefined, tree: undefined },
    }));
  }
  async function grpcDoConnect(): Promise<void> {
    const t = tab;
    if (!t?.grpc) return;
    const tabId = t.id;
    grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
    busyMap.update((m) => ({ ...m, [tabId]: { kind: 'connect' } }));
    try {
      if (t.grpc.source === 'proto' && !(t.grpc.protoPaths?.length)) {
        throw new Error('Select a .proto file first.');
      }
      const connId = await grpcConnect(t.grpc.endpoint, t.grpc.plaintext, $requestTimeoutMs);
      const tree =
        t.grpc.source === 'proto'
          ? await grpcLoadProto(connId, t.grpc.protoPaths ?? [], t.grpc.importPaths ?? [])
          : await grpcReflect(connId, $requestTimeoutMs);
      updateTabById(tabId, (x) => ({ ...x, grpc: { ...x.grpc!, connectionId: connId, tree } }));
    } catch (e) {
      // A reflection-source failure (no reflection or unreachable) becomes
      // neutral guidance to load a schema; proto-source errors stay verbatim.
      const msg =
        t.grpc?.source === 'reflection' ? GRPC_NO_SERVICES_HINT : e instanceof Error ? e.message : String(e);
      grpcErrorMap.update((m) => ({ ...m, [tabId]: msg }));
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
    updateActiveTab((t) => ({
      ...t,
      title: t.manualTitle ? t.title : titleFromUrl(v, GRPC_DEFAULT_TITLE),
      grpc: { ...t.grpc!, endpoint: v, connectionId: undefined, tree: undefined },
    }));
  }
  /** Connect + reflect automatically if not already connected. TLS is inferred. */
  async function ensureConnected(): Promise<void> {
    const t = tab;
    if (!t?.grpc || t.grpc.connectionId || !t.grpc.endpoint.trim()) return;
    // Plaintext unless the endpoint clearly targets a TLS port (:443).
    const plaintext = !/:443(\b|$)/.test(t.grpc.endpoint);
    if (t.grpc.plaintext !== plaintext) setGrpc({ plaintext });
    await grpcDoConnect();
  }
  function grpcDoSelect(symbol: string): void {
    const id = tab?.grpc?.connectionId;
    if (!id) return;
    flushSync(() => {
      methodOpen = false;
      updateActiveTab((t) => ({ ...t, grpc: { ...t.grpc!, method: symbol } }));
    });
    window.setTimeout(() => {
      void loadGrpcTemplate(id, symbol);
    }, 0);
  }
  async function loadGrpcTemplate(connectionId: string, symbol: string): Promise<void> {
    try {
      const tpl = await grpcTemplate(connectionId, symbol);
      updateActiveTab((t) =>
        t.grpc?.method === symbol
          ? { ...t, grpc: { ...t.grpc!, message: tpl } }
          : t,
      );
    } catch {
      // Keep the selected method; leave the existing message untouched.
    }
  }
  async function grpcLoadExample(): Promise<void> {
    const g = tab?.grpc;
    if (!g?.connectionId || !g.method) {
      setGrpc({ message: '{\n  \n}' });
      return;
    }
    await selectMethod(g.connectionId, g.method);
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
    if (!g?.connectionId || !g.method) return;
    const requestId = crypto.randomUUID();
    grpcErrorMap.update((m) => ({ ...m, [tabId]: '' }));
    busyMap.update((m) => ({ ...m, [tabId]: { kind: 'invoke', requestId } }));
    let result: GrpcResult;
    try {
      result = await grpcCall(g.connectionId, g.method, g.message, g.metadata, requestId, $requestTimeoutMs);
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
    updateTabById(tabId, (x) => ({ ...x, grpcResult: result }));
    addHistory({ id: crypto.randomUUID(), protocol: 'grpc', request: { method: 'GRPC', url: g.endpoint + ' ' + (g.method ?? ''), headers: {} }, status: 0, ok: result.ok, grpc: grpcSnapshot(g), at: Date.now() });
  }
  function setMeta(text: string): void {
    const md: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      if (k) md[k] = line.slice(i + 1).trim();
    }
    setGrpc({ metadata: md });
  }

  const activeGrpcMessageLines = $derived(
    gTab === 'message' ? lineNumbers(tab.grpc?.message) : [],
  );
  const activeGrpcMessageHtml = $derived(
    gTab === 'message' ? hl(tab.grpc?.message ?? '', false) : '',
  );
  const protoFileNames = $derived(
    (tab.grpc?.protoPaths ?? []).map((p) => p.split(/[\\/]/).pop() ?? p),
  );
  const isProtoSource = $derived(tab.grpc?.source === 'proto');
</script>

<div class="bs-urlbar">
  <div class="bs-grpc-endpoint-field">
    <span class="bs-method" style="padding:0 11px;color:var(--accent)"><span class="material-symbols-outlined" style="font-size:18px">lan</span></span>
    <input class="bs-url" placeholder="Enter URL" value={tab.grpc?.endpoint ?? ''} oninput={(e) => setEndpoint(e.currentTarget.value)} onblur={ensureConnected} />
  </div>
  <div class="bs-grpc-picker" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="bs-grpc-trigger" class:open={methodOpen} onclick={openGrpcMethodDropdown} type="button">
      <span>{grpcMethodLabel(tab, grpcConnecting)}</span>
      <span class="material-symbols-outlined" style="font-size:18px">expand_more</span>
    </button>
    {#if methodOpen}
      <div class="bs-grpc-menu">
        <div class="bs-grpc-list">
          {#if grpcConnecting}
            <div class="bs-grpc-empty">Connecting...</div>
          {:else if !tab.grpc?.tree}
            <div class="bs-grpc-empty">{isProtoSource && !protoFileNames.length ? 'Import a .proto first' : 'Connect first'}</div>
          {:else}
            {#each tab.grpc.tree.services as service (service.name)}
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
{#if activeGrpcError}<div style="padding:0 16px 10px;color:{grpcGuiding ? 'var(--t3)' : 'var(--red)'};font-family:var(--mono);font-size:12px;white-space:pre-wrap">{activeGrpcError}</div>{/if}
<div class="bs-rtabs">
  <div class="bs-rtab docs"><span class="material-symbols-outlined" style="font-size:14px">notes</span>Docs</div>
  <button class="bs-rtab" class:on={gTab === 'message'} onclick={() => (gTab = 'message')}>Message</button>
  <div class="bs-rtab">Authorization</div>
  <button class="bs-rtab" class:on={gTab === 'metadata'} onclick={() => (gTab = 'metadata')}>Metadata</button>
  <button class="bs-rtab" class:on={gTab === 'proto'} onclick={() => (gTab = 'proto')}>Service definition</button>
  <div class="bs-rtab">Scripts</div>
  <div class="bs-rtab">Settings</div>
</div>
<div class="bs-reqpane">
{#if gTab === 'message'}
  <div class="bs-postman-message">
    <div class="bs-json-editor postman">
      <div class="bs-json-gutter" aria-hidden="true">
        {#each activeGrpcMessageLines as n}
          <div>{n}</div>
        {/each}
      </div>
      {#if !(tab.grpc?.message ?? '').trim()}<div class="bs-json-placeholder">Compose message</div>{/if}
      <pre class="bs-json-highlight" aria-hidden="true">{@html activeGrpcMessageHtml}</pre>
      <textarea spellcheck="false" aria-label="gRPC JSON message" value={tab.grpc?.message ?? ''} oninput={(e) => setGrpc({ message: e.currentTarget.value })} onscroll={syncJsonScroll}></textarea>
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
  <div class="bs-bodyarea"><textarea placeholder="Key: Value (one per line)" value={metaText(tab.grpc?.metadata)} oninput={(e) => setMeta(e.currentTarget.value)}></textarea></div>
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
