/** Pure helpers behind GrpcEditor.svelte: no stores, no components. */
import type { Completion } from '@codemirror/autocomplete';
import type { Translate } from '$shared/i18n';
import { isGrpcConnectionCode, grpcFieldStub, type GrpcTabError, type GrpcurlImport } from '$entities/request';
import { grpcErrorCode } from '$shared/ipc';
import { type GrpcField, type GrpcResult, type GrpcStreamMessage, type Tab } from '$shared/model';

export type EditorErrorKind = 'connection' | 'schema' | 'validation' | 'script' | 'unknown';
export interface EditorErrorPresentation {
  kind: EditorErrorKind;
  title: string;
  message: string;
  raw: string;
  icon: string;
}

/** Classify an editor-side error (not a gRPC status) into the banner shown above the request tabs. */
export function presentEditorError(
  { message: error, code }: GrpcTabError,
  guiding: boolean,
  endpoint: string,
  tr: Translate,
): EditorErrorPresentation {
  if (guiding)
    return { kind: 'schema', title: tr('grpc.err.schemaTitle'), message: error, raw: error, icon: 'description' };
  if (isGrpcConnectionCode(code)) {
    const target = endpoint.trim() || tr('grpc.err.theServer');
    return {
      kind: 'connection',
      title: tr('grpc.err.connTitle'),
      message: tr('grpc.err.connMsg', { target }),
      raw: error,
      icon: 'cloud_off',
    };
  }
  if (/pre-request script/i.test(error)) {
    return {
      kind: 'script',
      title: tr('grpc.err.scriptTitle'),
      message: tr('grpc.err.scriptMsg'),
      raw: error,
      icon: 'javascript',
    };
  }
  if (/json|select a method|enter an endpoint|выберите метод|укажите адрес/i.test(error)) {
    return { kind: 'validation', title: tr('grpc.err.validationTitle'), message: error, raw: error, icon: 'edit_note' };
  }
  return { kind: 'unknown', title: tr('grpc.err.unknownTitle'), message: error, raw: error, icon: 'error' };
}

/**
 * A connection error is drawn by the response pane, but only when the tab has no response yet.
 * Drop a stale result/stream so a failed connect/reflect is not hidden behind the previous reply.
 */
export function withoutStaleResponse(tab: Tab, code: string | undefined): Tab {
  return isGrpcConnectionCode(code) ? { ...tab, grpcResult: undefined, grpcStream: undefined } : tab;
}

/** `pkg.Service.Method` -> its service and method name. */
export function splitMethodSymbol(symbol: string): { service: string; name: string } {
  const cut = symbol.lastIndexOf('.');
  return cut === -1 ? { service: '', name: symbol } : { service: symbol.slice(0, cut), name: symbol.slice(cut + 1) };
}

/** Feed rows for messages we sent: an array is one message per element. */
export function sentEntries(json: string, sentSoFar: number, now = Date.now()): GrpcStreamMessage[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map((m, i) => ({
    index: sentSoFar + i + 1,
    atMs: now,
    body: JSON.stringify(m),
    sizeBytes: 0,
    sent: true,
  }));
}

/** Last path segment, either separator. */
export const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** Whole days until a certificate expires (negative once expired) and its short localized date. */
export function certExpiry(notAfter: number, lang: string, now = Date.now()): { days: number; date: string } {
  return {
    days: Math.floor((notAfter * 1000 - now) / 86_400_000),
    date: new Date(notAfter * 1000)
      .toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })
      .replace(' г.', '')
      .replace('.', ''),
  };
}

/** G4: completion options for the request's top-level fields; `present` = keys already in the message. */
export function fieldCompletionOptions(
  fields: GrpcField[],
  present: Set<string>,
  inputShort: string,
  tr: Translate,
): Completion[] {
  const section = { name: tr('grpc.msg.fieldsHead', { type: inputShort }) };
  return fields.map((f, i) => {
    const set = present.has(f.name) || present.has(f.protoName);
    return {
      label: f.protoName,
      detail: f.typeLabel,
      doc: set ? tr('grpc.msg.fieldSet') : f.doc || f.enumValues?.join(' · ') || '',
      set,
      section,
      boost: set ? -99 : 50 - Math.min(i, 48),
      apply: (view, _c, from, to) => {
        const start = view.state.sliceDoc(from - 1, from) === '"' ? from - 1 : from;
        const end = view.state.sliceDoc(to, to + 1) === '"' ? to + 1 : to;
        const stub = grpcFieldStub(f);
        const insert = `"${f.protoName}": ${stub}`;
        const caret = start + insert.length - (/^(""|\[\]|\{\})$/.test(stub) ? 1 : 0);
        view.dispatch({
          changes: { from: start, to: end, insert },
          selection: { anchor: caret },
          userEvent: 'input.complete',
        });
      },
    } as Completion;
  });
}

/** A copy of `map` without `key` (the same object when the key is absent). */
export function omitKey<V>(map: Record<string, V>, key: string): Record<string, V> {
  if (!(key in map)) return map;
  const { [key]: _removed, ...rest } = map;
  return rest;
}

/** The synthetic response shown when an invoke fails before/while the call runs. */
export function invokeFailureResult(e: unknown): GrpcResult {
  const code = grpcErrorCode(e);
  return {
    ok: false,
    status: code ?? 'ERROR',
    body: code === 'CANCELLED' ? 'Request cancelled' : e instanceof Error ? e.message : String(e),
    elapsed_ms: 0,
    size_bytes: 0,
  };
}

/** Endpoint edit: retitle (unless renamed by hand) and drop the stale connection so the next action reconnects. */
export function withGrpcEndpoint(t: Tab, endpoint: string, title: string): Tab {
  if (!t.grpc) return t;
  return {
    ...t,
    title: t.manualTitle ? t.title : title,
    grpc: { ...t.grpc, endpoint, connectionId: undefined, tree: undefined },
  };
}

/** G1: a pasted `grpcurl …` fills endpoint, TLS, method, message and metadata. */
export function applyGrpcurlImport(t: Tab, cmd: GrpcurlImport, title: string): Tab {
  if (!t.grpc) return t;
  const abs = (p: string) => /^(\/|~\/)/.test(p);
  const protoPaths = cmd.protoPaths.filter(abs);
  return {
    ...t,
    title: t.manualTitle ? t.title : title,
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
  };
}
