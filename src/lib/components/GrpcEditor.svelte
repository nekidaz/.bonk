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
  import { flushSync, tick, untrack } from 'svelte';
  import { effectiveAuth } from '../domain/authInherit';
  import { errorFieldLines } from '../editor/errorLines';
  import { get } from 'svelte/store';
  import {
    tabs,
    collections,
    updateActiveTab,
    updateTabById,
    addHistory,
    grpcSnapshot,
    titleFromUrl,
    GRPC_DEFAULT_TITLE,
    requestTimeoutMs,
    grpcDeadlineMs,
    grpcAutoReflect,
    applyScriptVars,
    addAppConsoleEntry,
  } from '../stores';
  import { grpcTlsFor, currentGrpcPrefs, withGlobalImports } from '../stores/netPrefs';
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
    filePick,
    grpcTlsInspect,
    runScript,
  } from '../api';
  import { busyMap, grpcErrorMap } from '../requestRuntime';
  import { filterGrpcServices, grpcEditorAction, grpcEditorSections, openGrpcEditorSection, type GrpcEditorSection } from '../grpcEditorUi';
  import { currentVarScope, globals, environments, activeEnvironmentId } from '../stores';
  import { requestVariableHighlight } from '../editor/requestVarHighlight';
  import CodeEditor from './CodeEditor.svelte';
  import GrpcMetadataEditor from './GrpcMetadataEditor.svelte';
  import HttpAuthEditor from './http/HttpAuthEditor.svelte';
  import ScriptsEditor from './ScriptsEditor.svelte';
  import ProtoImportDialog from './ProtoImportDialog.svelte';
  import GrpcProtoPanel from './GrpcProtoPanel.svelte';
  import { t, tp, t as i18nT } from '../i18n';
  import { uiLanguage } from '../stores/prefs';
  import { resolveVars, mergeScope } from '../domain/vars';
  import { buildGrpcScriptContext, applyGrpcRequestPatch, type ScriptResult } from '../domain/scripts';
  import {
    isGrpcNoServicesHint,
    isGrpcConnectionError,
    grpcConnectFailureMessage,
    inferGrpcPlaintext,
    methodShort,
    grpcMethodKind,
    outgoingGrpcMetadata,
    stripsAuthorization,
    isRetryableDialError,
    grpcAuthMetadata,
    GRPC_DIAL_BACKOFF_MS,
    parseGrpcurl,
    checkGrpcMessage,
    atTopLevelKey,
    grpcFieldStub,
    type GrpcConnectStage,
    type GrpcMessageIssue,
  } from '../domain/grpc';
  import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
  import { grpcMethodLabel } from '../grpcActions';
  import { tablist } from '../tablist';
  import type { Tab, GrpcResult, GrpcStreamMessage, GrpcTls, GrpcCertInfo } from '../domain/types';

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
  const selectedMethod = $derived(tab.grpc?.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === tab.grpc?.method));
  const methodPath = $derived.by(() => {
    const symbol = tab.grpc?.method ?? '';
    const cut = symbol.lastIndexOf('.');
    return cut === -1 ? { service: '', name: symbol } : { service: symbol.slice(0, cut), name: symbol.slice(cut + 1) };
  });
  const messageValid = $derived.by(() => {
    try { JSON.parse(tab.grpc?.message || '{}'); return true; } catch { return false; }
  });
  // S24: field violations from the last INVALID_ARGUMENT reply mark the message editor.
  const violations = $derived(tab.grpcResult?.details?.flatMap((d) => d.fieldViolations) ?? []);
  const metadataCount = $derived(Object.keys(tab.grpc?.metadata ?? {}).length);
  // G4: the request schema drives field completions and pre-send checks.
  const schemaFields = $derived(selectedMethod?.inputSchema ?? []);
  const inputShort = $derived(selectedMethod?.inputType?.split('.').pop() ?? '');
  const issues = $derived(checkGrpcMessage(tab.grpc?.message ?? '', schemaFields));
  const issueText = (i: GrpcMessageIssue): string =>
    i.kind === 'unknown' ? $t('grpc.msg.unknownField', { field: i.field, type: inputShort }) : $t('grpc.msg.wrongType', { field: i.field, expected: i.expected });
  // G1: nothing to show in the editor until there's a schema — pick where it comes from.
  const chooseSchema = $derived(!tab.grpc?.tree && !tab.grpc?.method && !(tab.grpc?.message ?? '').trim());
  const noAddress = $derived(!(tab.grpc?.endpoint ?? '').trim());
  // G3: schema loaded, method not picked yet.
  const schemaSummary = $derived.by(() => {
    const services = tab.grpc?.tree?.services ?? [];
    const methods = services.reduce((n, s) => n + s.methods.length, 0);
    const files = tab.grpc?.protoPaths?.length ?? 0;
    return $t('grpc.msg.schemaSummary', {
      source: tab.grpc?.source === 'proto' ? `${files} ${$tp(files, ['файл', 'файла', 'файлов'], ['file', 'files'])} .proto` : 'server reflection',
      services: `${services.length} ${$tp(services.length, ['сервис', 'сервиса', 'сервисов'], ['service', 'services'])}`,
      methods: `${methods} ${$tp(methods, ['метод', 'метода', 'методов'], ['method', 'methods'])}`,
    });
  });

  /** G4: ⌃Space (or typing) at a top-level key lists the request fields with their types. */
  async function fieldCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
    const word = ctx.matchBefore(/"?[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (!atTopLevelKey(ctx.state.sliceDoc(0, ctx.pos))) return null;
    // A reopened saved request has no schema yet: fetch it on first ask.
    if (!tab.grpc?.tree && tab.grpc?.method) {
      await ensureConnected();
      await tick();
    }
    const fields = schemaFields;
    if (!fields.length || ctx.aborted) return null;
    const present = new Set([...ctx.state.doc.toString().matchAll(/"([\w$]+)"\s*:/g)].map((m) => m[1]));
    const section = { name: $t('grpc.msg.fieldsHead', { type: inputShort }) };
    return {
      from: word.text.startsWith('"') ? word.from + 1 : word.from,
      validFor: /^[\w$]*$/,
      options: fields.map((f, i) => {
        const set = present.has(f.name) || present.has(f.protoName);
        return {
          label: f.protoName,
          detail: f.typeLabel,
          doc: set ? $t('grpc.msg.fieldSet') : f.doc || f.enumValues?.join(' · ') || '',
          set,
          section,
          boost: set ? -99 : 50 - Math.min(i, 48),
          apply: (view, _c, from, to) => {
            const start = view.state.sliceDoc(from - 1, from) === '"' ? from - 1 : from;
            const end = view.state.sliceDoc(to, to + 1) === '"' ? to + 1 : to;
            const stub = grpcFieldStub(f);
            const insert = `"${f.protoName}": ${stub}`;
            const caret = start + insert.length - (/^(""|\[\]|\{\})$/.test(stub) ? 1 : 0);
            view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: caret }, userEvent: 'input.complete' });
          },
        };
      }),
    };
  }
  const streamMethod = $derived(!!selectedMethod?.serverStreaming || !!selectedMethod?.clientStreaming);

  const gTab = $derived($grpcEditorSections[tab.id] ?? 'message');
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
  type EditorErrorKind = 'connection' | 'schema' | 'validation' | 'script' | 'unknown';
  type EditorErrorPresentation = { kind: EditorErrorKind; title: string; message: string; raw: string; icon: string };
  function presentEditorError(error: string, guiding: boolean, endpoint: string): EditorErrorPresentation {
    if (guiding) return { kind: 'schema', title: $t('grpc.err.schemaTitle'), message: error, raw: error, icon: 'description' };
    if (isGrpcConnectionError(error)) {
      const target = endpoint.trim() || $t('grpc.err.theServer');
      return {
        kind: 'connection',
        title: $t('grpc.err.connTitle'),
        message: $t('grpc.err.connMsg', { target }),
        raw: error,
        icon: 'cloud_off',
      };
    }
    if (/pre-request script/i.test(error)) {
      return { kind: 'script', title: $t('grpc.err.scriptTitle'), message: $t('grpc.err.scriptMsg'), raw: error, icon: 'javascript' };
    }
    if (/json|select a method|enter an endpoint|выберите метод|укажите адрес/i.test(error)) {
      return { kind: 'validation', title: $t('grpc.err.validationTitle'), message: error, raw: error, icon: 'edit_note' };
    }
    return { kind: 'unknown', title: $t('grpc.err.unknownTitle'), message: error, raw: error, icon: 'error' };
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
        ? { ...t, grpc: { ...t.grpc, source: 'proto', protoPaths, importPaths, connectionId: undefined, tree: undefined } }
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
      if (t.grpc.source === 'proto' && !(t.grpc.protoPaths?.length)) {
        throw new Error(get(i18nT)('grpc.selectProtoFirst'));
      }
      const endpoint = resolveVars(t.grpc.endpoint, currentVarScope());
      let connId: string;
      for (;;) {
        attempts += 1;
        try {
          connId = await grpcConnect(endpoint, grpcPlaintext, grpcTlsFor(endpoint, t.grpc.tls), $requestTimeoutMs, currentGrpcPrefs());
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
        updateTabById(tabId, (x) => ({ ...x, grpcStream: undefined, grpcResult: { ok: false, status: 'UNAVAILABLE', body: message, elapsed_ms: Date.now() - startedAt, size_bytes: 0, attempts, backoffMs: backoff.slice(0, attempts - 1) } }));
      } else {
        grpcErrorMap.update((m) => ({ ...m, [tabId]: message }));
      }
    } finally {
      busyMap.update((m) => {
        if (m[tabId]?.kind !== 'connect') return m;
        const { [tabId]: _done, ...rest } = m;
        return rest;
      });
    }
  }
  /** G1: a pasted `grpcurl …` fills endpoint, TLS, method, message and metadata. */
  function endpointPaste(text: string): boolean {
    const cmd = parseGrpcurl(text);
    if (!cmd) return false;
    const abs = (p: string) => /^(\/|~\/)/.test(p);
    const protoPaths = cmd.protoPaths.filter(abs);
    updateActiveTab((t) =>
      t.grpc
        ? {
            ...t,
            title: t.manualTitle ? t.title : titleFromUrl(cmd.endpoint, GRPC_DEFAULT_TITLE),
            grpc: {
              ...t.grpc,
              endpoint: cmd.endpoint,
              plaintext: cmd.plaintext,
              method: cmd.method ?? t.grpc.method,
              message: cmd.message ?? t.grpc.message,
              metadata: { ...t.grpc.metadata, ...cmd.metadata },
              tls: cmd.insecure ? { ...t.grpc.tls, insecure: true } : t.grpc.tls,
              ...(protoPaths.length ? { source: 'proto' as const, protoPaths, importPaths: cmd.importPaths.filter(abs) } : {}),
              connectionId: undefined,
              tree: undefined,
            },
          }
        : t,
    );
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

  // S29/S30: connection popover — TLS mode, the server's certificate, mTLS / CA.
  let tlsOpen = $state(false);
  let cert = $state<{ loading: boolean; info?: GrpcCertInfo; error?: string }>({ loading: false });
  const resolvedEndpoint = $derived(resolveVars(tab.grpc?.endpoint ?? '', currentVarScope()));
  const stripAuth = $derived(stripsAuthorization(tab.grpc ?? {}, grpcPlaintext));
  function setPlaintext(plaintext: boolean): void {
    if (plaintext === grpcPlaintext) return;
    setGrpc({ plaintext, connectionId: undefined, tree: undefined });
    if (!plaintext) void loadCert();
  }
  function setTls(patch: Partial<GrpcTls>): void {
    const tls = { ...tab.grpc?.tls, ...patch };
    setGrpc({ tls, connectionId: undefined, tree: undefined });
    void loadCert(tls);
  }
  async function loadCert(tls = tab.grpc?.tls): Promise<void> {
    const endpoint = resolvedEndpoint.trim();
    if (!endpoint || grpcPlaintext) return;
    cert = { loading: true };
    try {
      cert = { loading: false, info: await grpcTlsInspect(endpoint, tls) };
    } catch (e) {
      cert = { loading: false, error: String(e) };
    }
  }
  function toggleTlsPopover(): void {
    tlsOpen = !tlsOpen;
    if (tlsOpen && !grpcPlaintext) void loadCert();
  }
  async function pickCa(): Promise<void> {
    const ca = await filePick();
    if (ca) setTls({ caCert: ca });
  }
  async function pickClientCert(): Promise<void> {
    const clientCert = await filePick();
    if (!clientCert) return;
    const clientKey = await filePick();
    if (clientKey) setTls({ clientCert, clientKey });
  }
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const certDays = $derived(cert.info ? Math.floor((cert.info.notAfter * 1000 - Date.now()) / 86_400_000) : 0);
  const certDate = $derived(
    cert.info ? new Date(cert.info.notAfter * 1000).toLocaleDateString($uiLanguage === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).replace(' г.', '').replace('.', '') : '',
  );
  function tlsKeydown(e: KeyboardEvent): void {
    // S23: ⌘P opens the method picker.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyP' && !e.shiftKey) {
      e.preventDefault();
      if (!methodOpen) void openGrpcMethodDropdown();
      return;
    }
    // G4: ⌘I fills the whole message with an example.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyI' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void grpcLoadExample();
      return;
    }
    if (e.key === 'Escape' && tlsOpen) {
      e.stopPropagation();
      tlsOpen = false;
      tlsTrigger?.focus();
    }
  }
  let tlsTrigger = $state<HTMLButtonElement | undefined>(undefined);
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
  async function openGrpcMethodDropdown(): Promise<void> {
    if (!tab?.grpc?.tree) await ensureConnected();
    methodOpen = !methodOpen;
    if (methodOpen) {
      methodSearch = '';
      requestAnimationFrame(() => methodSearchInput?.focus());
    }
  }
  /** Feed rows for messages we sent: an array is one message per element. */
  function sentEntries(json: string, sentSoFar: number): GrpcStreamMessage[] {
    let value: unknown;
    try { value = JSON.parse(json); } catch { return []; }
    return (Array.isArray(value) ? value : [value]).map((m, i) => ({ index: sentSoFar + i + 1, atMs: Date.now(), body: JSON.stringify(m), sizeBytes: 0, sent: true }));
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
        return { ...x, grpcStream: { ...s, messages: [...s.messages, ...sentEntries(body, s.messages.filter((m) => m.sent).length)] } };
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
    busyMap.update((m) => (m[tabId]?.requestId === requestId ? { ...m, [tabId]: { ...m[tabId], writable: false } } : m));
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
    // Auth tab (own or the collection's) first; explicit metadata rows win.
    const merged = grpcAuthMetadata(effectiveAuth($collections, tab.savedPath, g.auth), (v) => resolveVars(v, scope));
    for (const [k, val] of Object.entries(metadata)) merged[k] = resolveVars(val, scope);
    const resolvedMetadata = outgoingGrpcMetadata(merged, stripAuth);
    // S20: streams (server, client, bidi) arrive message by message; everything else is a unary call.
    // A client/bidi stream sends the editor message (an array = one message per element),
    // then stays open for Send until End.
    const method = g.tree?.services.flatMap((s) => s.methods).find((m) => m.symbol === g.method);
    const streaming = !!method?.serverStreaming || !!method?.clientStreaming;
    try {
      if (streaming) {
        const sent = method?.clientStreaming ? sentEntries(resolvedMessage, 0) : [];
        if (method?.clientStreaming) busyMap.update((m) => (m[tabId]?.requestId === requestId ? { ...m, [tabId]: { ...m[tabId], writable: true } } : m));
        updateTabById(tabId, (x) => ({ ...x, grpcResult: undefined, grpcStream: { messages: sent, done: false, startedAt: Date.now() } }));
        result = await grpcStream(g.connectionId, g.method, resolvedMessage, resolvedMetadata, requestId, (msg) =>
          updateTabById(tabId, (x) => {
            const s = x.grpcStream ?? { messages: [], done: false, startedAt: Date.now() };
            return { ...x, grpcStream: msg.headers ? { ...s, headers: msg.headers } : { ...s, messages: [...s.messages, msg] } };
          }),
        );
      } else {
        updateTabById(tabId, (x) => ({ ...x, grpcStream: undefined }));
        result = await grpcCall(g.connectionId, g.method, resolvedMessage, resolvedMetadata, requestId, $grpcDeadlineMs);
      }
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

    updateTabById(tabId, (x) => ({ ...x, grpcResult: result, testResults, grpcStream: x.grpcStream && { ...x.grpcStream, done: true } }));
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
    addHistory({ id: crypto.randomUUID(), protocol: 'grpc', request: { method: 'GRPC', url: g.endpoint + ' ' + (g.method ?? ''), headers: {} }, status: 0, ok: result.ok, grpc: grpcSnapshot(g), at: Date.now(), savedPath: tab.savedPath, title: tab.title });
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

<div class="bs-urlbar bs-grpc-bar">
  <div class="bs-urlfield bs-grpc-field">
    <div class="bs-method-wrap">
      <button class="bs-method" style="color:var(--method-grpc)" type="button" aria-haspopup="menu" title={$t('grpc.requestType')} onclick={onSwitch}>
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
      onBlur={() => { if ($grpcAutoReflect) void ensureConnected(); }}
      {varHighlight}
      docId={tab.id}
      ariaLabel={$t('grpc.endpointAria')}
    />
    <div class="bs-grpc-security-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
      <button
        bind:this={tlsTrigger}
        class="bs-grpc-security"
        class:secure={!grpcPlaintext}
        class:open={tlsOpen}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={tlsOpen}
        title={$t('grpc.conn.title')}
        onclick={toggleTlsPopover}
      >
        <span class="material-symbols-outlined">{grpcPlaintext ? 'lock_open_right' : 'lock'}</span>{grpcPlaintext ? 'Plaintext' : 'TLS'}
      </button>
      {#if tlsOpen}
        <div class="bs-conn-pop" role="dialog" aria-label={$t('grpc.conn.title')}>
          <div class="cp-head"><span>{$t('grpc.conn.title')}</span><span>HTTP/2</span></div>
          <div class="cp-seg" role="radiogroup" aria-label={$t('grpc.conn.mode')}>
            <button type="button" role="radio" aria-checked={!grpcPlaintext} class:on={!grpcPlaintext} onclick={() => setPlaintext(false)}>TLS</button>
            <button type="button" role="radio" aria-checked={grpcPlaintext} class:on={grpcPlaintext} onclick={() => setPlaintext(true)}>Plaintext (h2c)</button>
          </div>
          {#if grpcPlaintext}
            <div class="cp-warn">
              <span class="material-symbols-outlined" aria-hidden="true">warning</span>
              <div><b>{$t('grpc.conn.plainWarn')}</b><p>{$t('grpc.conn.plainWarnText')}</p></div>
            </div>
            <div class="cp-facts">
              <div><span>{$t('grpc.conn.address')}</span><code>{resolvedEndpoint.trim() || '—'}</code></div>
              <div><span>{$t('grpc.conn.protocol')}</span><code>{$t('grpc.conn.h2c')}</code></div>
            </div>
            <div class="cp-row">
              <span id="bs-cp-auth">{$t('grpc.conn.stripAuth')}</span>
              <button class="mono-switch" type="button" role="switch" aria-checked={stripAuth} aria-labelledby="bs-cp-auth" onclick={() => setGrpc({ keepAuthOnPlaintext: stripAuth })}></button>
            </div>
          {:else}
            <div class="cp-facts">
              {#if cert.loading}
                <div><span>{$t('grpc.conn.cert')}</span><code class="muted">{$t('grpc.conn.checking')}</code></div>
              {:else if cert.error}
                <div class="bad"><span>{$t('grpc.conn.cert')}</span><code title={cert.error}>{$t('grpc.conn.noConn')}</code></div>
              {:else if cert.info}
                <div class:bad={!cert.info.verified}>
                  <span>{$t('grpc.conn.cert')}</span>
                  <b class="verdict"><span class="material-symbols-outlined" aria-hidden="true">{cert.info.verified ? 'verified' : 'gpp_maybe'}</span>{cert.info.verified ? $t('grpc.conn.verified') : $t('grpc.conn.unverified')}</b>
                </div>
                {#if !cert.info.verified && cert.info.error}<p class="cp-why">{cert.info.error}</p>{/if}
                <div><span>{$t('grpc.conn.issuedTo')}</span><code>{cert.info.subject}</code></div>
                <div><span>{$t('grpc.conn.issuer')}</span><code class="ui">{cert.info.issuer}</code></div>
                <div class:bad={certDays < 0}><span>{$t('grpc.conn.validUntil')}</span><code>{certDate} · {certDays < 0 ? $t('grpc.conn.expired') : $t('grpc.conn.days', { n: certDays })}</code></div>
              {:else}
                <div><span>{$t('grpc.conn.cert')}</span><code class="muted">{$t('grpc.conn.enterAddress')}</code></div>
              {/if}
            </div>
            <div class="cp-row">
              <span id="bs-cp-verify">{$t('grpc.conn.verify')}</span>
              <button class="mono-switch" type="button" role="switch" aria-checked={!tab.grpc?.tls?.insecure} aria-labelledby="bs-cp-verify" onclick={() => setTls({ insecure: !tab.grpc?.tls?.insecure })}></button>
            </div>
            <div class="cp-row">
              <span>{$t('grpc.conn.clientCert')}</span>
              {#if tab.grpc?.tls?.clientCert}
                <code class="file" title={tab.grpc.tls.clientCert}>{fileName(tab.grpc.tls.clientCert)}</code>
                <button class="cp-x" type="button" aria-label={$t('grpc.conn.removeCert')} onclick={() => setTls({ clientCert: undefined, clientKey: undefined })}><span class="material-symbols-outlined">close</span></button>
              {:else}
                <span class="muted">{$t('grpc.conn.notSet')}</span>
                <button class="cp-link" type="button" title={$t('grpc.conn.pickCert')} onclick={pickClientCert}>{$t('grpc.conn.add')}</button>
              {/if}
            </div>
            <div class="cp-row">
              <span>{$t('grpc.conn.trustedCa')}</span>
              {#if tab.grpc?.tls?.caCert}
                <code class="file" title={tab.grpc.tls.caCert}>{fileName(tab.grpc.tls.caCert)}</code>
                <button class="cp-x" type="button" aria-label={$t('grpc.conn.restoreCa')} onclick={() => setTls({ caCert: undefined })}><span class="material-symbols-outlined">close</span></button>
              {:else}
                <button class="cp-link" type="button" title={$t('grpc.conn.addCa')} onclick={pickCa}>{$t('grpc.conn.system')}<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <div class="bs-grpc-picker" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
      <button class="bs-grpc-trigger" class:open={methodOpen} aria-haspopup="menu" aria-expanded={methodOpen} disabled={noAddress && !tab.grpc?.method} onclick={openGrpcMethodDropdown} type="button">
        <span class="material-symbols-outlined lead" aria-hidden="true">schema</span>
        {#if tab.grpc?.method}<span class="path"><span class="svc">{methodPath.service}/</span><b>{methodPath.name}</b></span>{:else if noAddress}<span class="path">{$t('grpc.enterAddressFirst')}</span>{:else}<span class="path">{grpcMethodLabel(tab, grpcConnecting, $t)}</span>{/if}
        <span class="material-symbols-outlined" style="font-size:16px">unfold_more</span>
      </button>
      {#if methodOpen}
        <div class="bs-grpc-menu bs-mpick">
          {#if tab.grpc?.tree && !grpcConnecting}
            <div class="mp-search">
              <span class="material-symbols-outlined" aria-hidden="true">search</span>
              <input
                bind:this={methodSearchInput}
                bind:value={methodSearch}
                aria-label={$t('grpc.picker.searchAria')}
                placeholder={$t('grpc.picker.searchPlaceholder')}
                autocomplete="off"
                spellcheck="false"
                onkeydown={methodSearchKeydown}
              />
              {#if methodSearch}
                <span class="mp-count">{filteredGrpcMethodCount}</span>
                <button type="button" aria-label={$t('grpc.picker.clearAria')} title={$t('grpc.picker.clear')} onclick={clearMethodSearch}>
                  <span class="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              {:else}
                <kbd>⌘P</kbd>
              {/if}
            </div>
            <div class="mp-source">
              <span class="dot" aria-hidden="true"></span>
              {isProtoSource ? `${$t('grpc.picker.fromProto')} · ${protoFileNames.join(', ')}` : `Server reflection · ${tab.grpc.endpoint}`} · {tab.grpc.tree.services.length} {$tp(tab.grpc.tree.services.length, ['сервис', 'сервиса', 'сервисов'], ['service', 'services'])}
            </div>
          {/if}
          <div class="mp-list" role="menu" aria-label={$t('grpc.picker.methods')}>
            {#if grpcConnecting}
              <div class="mp-empty">{$t('grpc.connecting')}</div>
            {:else if !tab.grpc?.tree}
              <div class="mp-empty">{isProtoSource && !protoFileNames.length ? $t('grpc.picker.importFirst') : $t('grpc.picker.connectFirst')}</div>
            {:else if filteredGrpcServices.length === 0}
              <div class="mp-empty">
                <span class="material-symbols-outlined" aria-hidden="true">search_off</span>
                <strong>{$t('grpc.picker.noMatch')}</strong>
                <span>{$t('grpc.picker.noMatchHint')}</span>
              </div>
            {:else}
              {#each filteredGrpcServices as service (service.name)}
                <div class="mp-service"><span class="material-symbols-outlined" aria-hidden="true">schema</span>{service.name}</div>
                {#each service.methods as m (m.symbol)}
                  {@const kind = grpcMethodKind(m)}
                  {@const on = m.symbol === tab.grpc?.method}
                  <button class="mp-option" class:on role="menuitemradio" aria-checked={on} onpointerdown={(e) => { e.preventDefault(); grpcDoSelect(m.symbol); }} onclick={() => grpcDoSelect(m.symbol)} type="button" title={m.clientStreaming ? $t('grpc.picker.noClientStream') : undefined}>
                    <span class="mp-line">
                      <span class="mp-name">{m.name}</span>
                      <span class="mp-kind" class:stream={kind !== 'unary'}>{kind}</span>
                      {#if on}<span class="material-symbols-outlined mp-check" aria-hidden="true">check</span>{/if}
                    </span>
                    {#if on && m.inputType}
                      <span class="mp-types">{m.inputType.split('.').pop()}{#if m.outputType}<span class="arrow" aria-hidden="true">→</span>{m.outputType.split('.').pop()}{/if}</span>
                    {/if}
                  </button>
                {/each}
              {/each}
            {/if}
          </div>
          <div class="mp-foot">
            <button type="button" onclick={() => grpcDoConnect()}>
              <span class="material-symbols-outlined" aria-hidden="true">refresh</span>{isProtoSource ? $t('grpc.picker.rereadProto') : $t('grpc.picker.refreshReflection')}
            </button>
            <button type="button" onclick={importProto}>
              <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>{$t('grpc.picker.importProto')}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
  {#if streamWritable}
    <button class="bs-stream-btn" type="button" title={$t('grpc.endStreamTitle')} onclick={grpcEndStream}>{$t('grpc.endStream')}</button>
    <button class="bs-stream-btn stop" type="button" aria-label={$t('grpc.stop')} title={$t('grpc.stop')} onclick={grpcStop}><span class="stop-square" aria-hidden="true"></span></button>
  {/if}
  <button class="bs-send" disabled={noAddress && !grpcInvoking} class:cancelling={grpcInvoking && !streamMethod} class:stop={grpcInvoking && streamMethod && !streamWritable} aria-busy={grpcInvoking} title={grpcInvoking && !streamWritable ? $t('grpc.invoking') : undefined} onclick={grpcDoInvoke}>
    <span class="go">
      {#if streamWritable}<span>{$t('grpc.send')}</span>{:else if grpcInvoking && streamMethod}<span class="stop-square" aria-hidden="true"></span><span>{$t('grpc.stop')}</span>{:else if grpcInvoking}<span>{$t('common.cancel')}</span><kbd>Esc</kbd>{:else}<span>{$t('grpc.invoke')}</span>{/if}
    </span>
  </button>
</div>

<style>
  /* Request-side problems (schema, script, validation): a quiet Soft card, colour only on the icon. */
  .bs-grpc-connect-alert {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto 28px;
    align-items: center;
    gap: 12px;
    margin: 0 20px 10px;
    padding: 10px 10px 10px 12px;
    color: var(--color-text);
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .bs-grpc-connect-icon {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--color-danger);
    background: var(--color-danger-soft);
    border-radius: 50%;
  }
  .guidance .bs-grpc-connect-icon { color: var(--color-text-secondary); background: var(--color-raised); }
  .bs-grpc-connect-icon .material-symbols-outlined { font-size: 17px; }
  .bs-grpc-connect-copy { min-width: 0; }
  .bs-grpc-connect-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .bs-grpc-connect-title b { font: 600 var(--font-size-ui) var(--font-ui); }
  .bs-grpc-connect-title span {
    max-width: 280px;
    padding: 1px 8px;
    overflow: hidden;
    color: var(--color-text-muted);
    background: var(--color-raised);
    border-radius: var(--radius-control);
    font: var(--font-size-micro) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-grpc-connect-copy p { margin: 2px 0 0; color: var(--color-text-secondary); font: var(--font-size-body)/1.45 var(--font-ui); }
  .bs-grpc-connect-copy details { margin-top: 6px; color: var(--color-text-muted); font-size: var(--font-size-caption); }
  .bs-grpc-connect-copy summary { width: max-content; cursor: pointer; }
  .bs-grpc-connect-copy code {
    display: block;
    margin-top: 6px;
    padding: 8px 10px;
    color: var(--color-text-secondary);
    background: var(--color-panel);
    border-radius: var(--radius-md);
    font: var(--font-size-caption)/1.5 var(--font-code);
    white-space: pre-wrap;
  }
  .bs-grpc-connect-actions { display: flex; align-items: center; gap: 6px; }
  .bs-grpc-connect-actions button {
    height: 32px;
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    color: var(--color-text);
    background: var(--color-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .bs-grpc-connect-actions button:hover { background: var(--color-hover); }
  .bs-grpc-connect-dismiss {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    border-radius: 50%;
  }
  .bs-grpc-connect-dismiss:hover { color: var(--color-text); background: var(--color-hover); }
  .bs-grpc-connect-dismiss .material-symbols-outlined { font-size: 15px; }
  @media (max-width: 760px) {
    .bs-grpc-connect-alert { grid-template-columns: 32px minmax(0, 1fr) 28px; }
    .bs-grpc-connect-actions { grid-column: 2 / -1; justify-self: start; }
  }
</style>
<!-- Connection failures render in the response pane as S25 «Сервер недоступен»; this strip is for the rest. -->
{#if editorError && editorError.kind !== 'connection'}
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
        <details><summary>{$t('grpc.err.details')}</summary><code>{editorError.raw}</code></details>
      {/if}
    </div>
    <div class="bs-grpc-connect-actions">
      {#if editorError.kind === 'schema'}
        <button type="button" onclick={importProto}>{$t('grpc.picker.importProto')}</button>
      {/if}
    </div>
    <button class="bs-grpc-connect-dismiss" type="button" aria-label={$t('grpc.err.dismiss')} onclick={dismissGrpcError}>
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>
{/if}
{#snippet gtab(id: GrpcEditorSection, label: string, count = 0)}
  <button class="bs-rtab" class:on={gTab === id} role="tab" id="bs-gtab-{id}" aria-selected={gTab === id} aria-controls="bs-grpcpanel" tabindex={gTab === id ? 0 : -1} onclick={() => openGrpcEditorSection(tab.id, id)}>{label}{#if count}<span class="bs-tab-count">{count}</span>{/if}</button>
{/snippet}
<div class="bs-rtabs" role="tablist" aria-label={$t('grpc.tab.request')} use:tablist>
  {@render gtab('message', $t('grpc.tab.message'))}
  {@render gtab('metadata', $t('grpc.tab.metadata'), metadataCount)}
  {@render gtab('auth', $t('grpc.tab.auth'))}
  {@render gtab('proto', $t('grpc.tab.proto'))}
  <!-- Not in the S19 mock: kept only for requests that already carry scripts. -->
  {#if tab.grpc?.preRequestScript || tab.grpc?.testScript || gTab === 'scripts'}{@render gtab('scripts', $t('grpc.tab.scripts'))}{/if}
</div>
<div class="bs-reqpane" role="tabpanel" id="bs-grpcpanel" aria-labelledby="bs-gtab-{gTab}">
{#if gTab === 'message' && chooseSchema}
  {@const source = tab.grpc?.source ?? 'reflection'}
  {#snippet choice(id: 'reflection' | 'proto', icon: string, title: string, text: string, pro: string, con: string, recommended = false)}
    <button class="sc-card" class:on={source === id} type="button" role="radio" aria-checked={source === id} onclick={() => chooseSource(id)}>
      <span class="sc-top">
        <span class="sc-icon" aria-hidden="true"><span class="material-symbols-outlined">{icon}</span></span>
        <b>{title}</b>
        {#if recommended}<span class="sc-tag">{$t('grpc.schema.recommended')}</span>{/if}
        <span class="sc-radio" aria-hidden="true"></span>
      </span>
      <span class="sc-text">{text}</span>
      <span class="sc-point"><span class="material-symbols-outlined ok" aria-hidden="true">check</span>{pro}</span>
      <span class="sc-point"><span class="material-symbols-outlined" aria-hidden="true">info</span>{con}</span>
    </button>
  {/snippet}
  <div class="bs-http-body bs-grpc-schema">
    <div class="sc-head">
      <span class="sc-kicker">{$t('grpc.schema.title')}</span>
      <p>{$t('grpc.schema.sub')}</p>
    </div>
    <div class="sc-choices" role="radiogroup" aria-label={$t('grpc.schema.title')}>
      {@render choice('reflection', 'manage_search', 'Server reflection', $t('grpc.schema.reflectionText'), $t('grpc.schema.reflectionPro'), $t('grpc.schema.reflectionCon'), true)}
      {@render choice('proto', 'description', $t('grpc.schema.protoTitle'), $t('grpc.schema.protoText'), $t('grpc.schema.protoPro'), $t('grpc.schema.protoCon'))}
    </div>
    <p class="sc-tip"><span class="material-symbols-outlined" aria-hidden="true">lightbulb</span>{$t('grpc.schema.grpcurlTip')}</p>
  </div>
{:else if gTab === 'message'}
  <div class="bs-http-body bs-grpc-message">
    <div class="bs-body-head">
      <span class="bs-body-caption">{$t('grpc.tab.message')}{#if selectedMethod?.inputType}&nbsp;&nbsp;·&nbsp;&nbsp;{selectedMethod.inputType.split('.').pop()}{/if}</span>
      <span class="bs-body-source">{isProtoSource ? $t('grpc.msg.fromProto') : 'Server reflection'}</span>
      <button class="bs-body-beautify" type="button" onclick={grpcLoadExample}><span class="material-symbols-outlined" aria-hidden="true">description</span>{$t('grpc.msg.example')}</button>
    </div>
    <div class="bs-body-cm" class:invalid={violations.length > 0 || issues.length > 0}>
      <CodeEditor
        value={tab.grpc?.message ?? ''}
        onChange={(v) => setGrpc({ message: v })}
        lang="json"
        minHeight="140px"
        placeholder={tab.grpc?.tree && !tab.grpc.method ? $t('grpc.msg.pickMethodFirst') : $t('grpc.msg.placeholder')}
        completionSource={fieldCompletions}
        completionFooter={$t('grpc.msg.acFoot')}
        varHighlight={[varHighlight, errorFieldLines([...violations.map((v) => v.field), ...issues.map((i) => i.field)])]}
        docId={tab.id}
        ariaLabel={$t('grpc.msg.aria')}
      />
    </div>
    {#if violations.length}
      <div class="bs-grpc-valid warn" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        {$t('grpc.msg.errors', { n: violations.length, unit: $tp(violations.length, ['ошибка', 'ошибки', 'ошибок'], ['error', 'errors']), list: violations.map((v) => `${v.field} — ${v.description}`).join('; ') })}
      </div>
    {:else if issues.length}
      <div class="bs-grpc-valid warn" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        {$t('grpc.msg.errors', { n: issues.length, unit: $tp(issues.length, ['ошибка', 'ошибки', 'ошибок'], ['error', 'errors']), list: issues.map(issueText).join('; ') })}
      </div>
    {:else if selectedMethod?.inputType}
      <div class="bs-grpc-valid" class:bad={!messageValid}>
        <span class="material-symbols-outlined" aria-hidden="true">{messageValid ? 'check_circle' : 'error'}</span>
        {messageValid ? $t('grpc.msg.valid', { type: selectedMethod.inputType, n: selectedMethod.inputFields ?? 0, unit: $tp(selectedMethod.inputFields ?? 0, ['поле', 'поля', 'полей'], ['field', 'fields']) }) : $t('grpc.msg.invalidJson')}
      </div>
    {:else if tab.grpc?.tree && !tab.grpc.method}
      <div class="bs-grpc-valid">
        <span class="material-symbols-outlined" aria-hidden="true">description</span>
        {schemaSummary}
      </div>
    {/if}
  </div>
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

<ProtoImportDialog bind:open={protoDialogOpen} protoPaths={tab.grpc?.protoPaths ?? []} importPaths={tab.grpc?.importPaths ?? []} onConnect={connectProto} />
<svelte:window onpointerdown={() => (tlsOpen = false)} onkeydown={tlsKeydown} />
