<script lang="ts">
  import { grpcProtoInspect, protoRead, terminalDefaultCwd, type ProtoFileInfo } from '$shared/ipc';
  import type { Tab } from '$shared/model';
  import { abbrevHome } from './proto';
  import { t, tp } from '$shared/i18n';

  const svc = (n: number): string => `${n} ${tp(n, ['service', 'services'])}`;
  const mth = (n: number): string => `${n} ${tp(n, ['method', 'methods'])}`;

  let {
    tab,
    onSetSource,
    onAddProto,
  }: {
    tab: Tab;
    onSetSource: (source: 'reflection' | 'proto') => void;
    onAddProto: () => void;
  } = $props();

  const KEYWORDS = new Set([
    'syntax',
    'package',
    'import',
    'option',
    'service',
    'rpc',
    'returns',
    'message',
    'enum',
    'oneof',
    'map',
    'repeated',
    'optional',
    'required',
    'stream',
    'reserved',
    'extend',
    'public',
    'weak',
  ]);
  const SCALARS = new Set([
    'double',
    'float',
    'int32',
    'int64',
    'uint32',
    'uint64',
    'sint32',
    'sint64',
    'fixed32',
    'fixed64',
    'sfixed32',
    'sfixed64',
    'bool',
    'string',
    'bytes',
  ]);
  type Tok = { text: string; cls: string };

  /** Tiny proto tokenizer: comments, strings, numbers, words, everything else. */
  function tokenize(line: string): Tok[] {
    const out: Tok[] = [];
    const re = /(\/\/.*)|("(?:[^"\\]|\\.)*")|(\d+)|([A-Za-z_][\w.]*)|(\s+)|(.)/g;
    for (const m of line.matchAll(re)) {
      if (m[1]) out.push({ text: m[1], cls: 'c' });
      else if (m[2]) out.push({ text: m[2], cls: 's' });
      else if (m[3]) out.push({ text: m[3], cls: 'n' });
      else if (m[4]) out.push({ text: m[4], cls: KEYWORDS.has(m[4]) ? 'k' : SCALARS.has(m[4]) ? 't' : '' });
      else out.push({ text: m[0], cls: m[6] ? 'p' : '' });
    }
    return out;
  }

  const source = $derived(tab.grpc?.source ?? 'reflection');
  const protoPaths = $derived(tab.grpc?.protoPaths ?? []);
  const importPaths = $derived(tab.grpc?.importPaths ?? []);
  const method = $derived(tab.grpc?.method ?? '');
  const methodName = $derived(method.split('.').pop() ?? '');
  const serviceName = $derived(method.slice(0, Math.max(0, method.lastIndexOf('.'))));

  let files = $state<ProtoFileInfo[]>([]);
  let rootDir = $state('');
  let home = $state('');
  let selected = $state(''); // file path, or a well-known name like google/protobuf/x.proto
  let text = $state('');
  let readError = $state('');

  const okFiles = $derived(files.filter((f) => f.ok));
  const wellKnown = $derived([...new Set(files.flatMap((f) => f.wellKnownDeps))]);
  const serviceCount = $derived(okFiles.reduce((n, f) => n + f.services.length, 0));
  const methodCount = $derived(okFiles.reduce((n, f) => n + f.services.reduce((m, s) => m + s.methods.length, 0), 0));
  const lines = $derived(text === '' ? [] : text.replace(/\n$/, '').split('\n'));
  const currentLine = $derived(
    methodName && selectedOwnsService()
      ? lines.findIndex((l) => new RegExp(`\\brpc\\s+${methodName}\\b`).test(l)) + 1
      : 0,
  );

  function selectedOwnsService(): boolean {
    return files.some((f) => f.path === selected && f.services.some((s) => s.name === serviceName));
  }

  const treeServices = $derived(tab.grpc?.tree?.services ?? []);
  const treeMethods = $derived(treeServices.reduce((n, s) => n + s.methods.length, 0));

  // Re-inspect when the file set changes.
  let inspectKey = '';
  $effect(() => {
    const key = JSON.stringify([protoPaths, importPaths]);
    if (source !== 'proto' || key === inspectKey) return;
    inspectKey = key;
    if (protoPaths.length === 0) {
      files = [];
      return;
    }
    grpcProtoInspect(protoPaths, importPaths)
      .then((r) => {
        files = r.files;
        rootDir = r.importPaths[0] ?? r.files[0]?.path.replace(/[/\\][^/\\]*$/, '') ?? '';
        const owner = r.files.find((f) => f.services.some((s) => s.name === serviceName));
        if (!r.files.some((f) => f.path === selected)) selected = (owner ?? r.files[0])?.path ?? '';
      })
      .catch((err) => console.error('proto inspect failed', err));
  });

  // Keep the viewer on the file that owns the current method.
  $effect(() => {
    const owner = files.find((f) => f.services.some((s) => s.name === serviceName));
    if (owner) selected = owner.path;
  });

  $effect(() => {
    const path = selected;
    if (!path) {
      text = '';
      readError = '';
      return;
    }
    protoRead(path)
      .then((t) => {
        if (path !== selected) return;
        text = t;
        readError = '';
      })
      .catch((err) => {
        if (path !== selected) return;
        text = '';
        readError = String(err);
      });
  });

  $effect(() => {
    void terminalDefaultCwd()
      .then((h) => (home = h))
      .catch(() => {});
  });

  let viewer: HTMLElement | undefined = $state();
  $effect(() => {
    if (currentLine > 0) viewer?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  });

  const fileMeta = (f: ProtoFileInfo): string =>
    f.ok
      ? `${svc(f.services.length)} · ${mth(f.services.reduce((n, s) => n + s.methods.length, 0))}`
      : (f.error?.message ?? '');
</script>

<div class="gpp">
  <div class="gpp-bar">
    <div class="gpp-seg" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={source === 'reflection'}
        class:on={source === 'reflection'}
        onclick={() => onSetSource('reflection')}>{t('grpc.proto.reflection')}</button
      >
      <button
        type="button"
        role="tab"
        aria-selected={source === 'proto'}
        class:on={source === 'proto'}
        onclick={() => onSetSource('proto')}>{t('grpc.proto.files')}</button
      >
    </div>
    <div class="gpp-grow"></div>
    {#if source === 'proto' && okFiles.length > 0}
      <span class="gpp-counts">
        {`${okFiles.length} ${tp(okFiles.length, ['FILE', 'FILES'])} · ${svc(serviceCount).toUpperCase()} · ${mth(methodCount).toUpperCase()}`}
      </span>
    {/if}
    <button type="button" class="gpp-add" onclick={onAddProto}>
      <span class="material-symbols-outlined">upload_file</span>{t('grpc.proto.add')}
    </button>
  </div>

  {#if source === 'reflection'}
    <div class="gpp-empty">
      <div class="a">{t('grpc.proto.reflectionNote')}</div>
      <div class="b">
        {#if treeServices.length > 0}
          {svc(treeServices.length)} · {mth(treeMethods)}
        {:else}
          {t('grpc.proto.connectHint')}
        {/if}
      </div>
    </div>
  {:else if files.length === 0}
    <div class="gpp-empty">
      <div class="a">{t('grpc.proto.none')}</div>
      <div class="b">{t('grpc.proto.noneHint')}</div>
      <button type="button" class="gpp-add" onclick={onAddProto}>{t('grpc.proto.add')}</button>
    </div>
  {:else}
    <div class="gpp-body">
      <div class="gpp-files">
        <div class="gpp-root" title={rootDir}>
          <span class="material-symbols-outlined">folder_open</span>{abbrevHome(rootDir, home)}
        </div>
        {#each files as f (f.path)}
          <button type="button" class="gpp-file" class:on={selected === f.path} onclick={() => (selected = f.path)}>
            <span class="material-symbols-outlined ic" class:ok={f.ok} class:warn={!f.ok}
              >{f.ok ? 'check_circle' : 'error'}</span
            >
            <span class="gpp-fmain">
              <span class="gpp-fname">{f.name}</span>
              <span class="gpp-fmeta" class:warn={!f.ok}>{fileMeta(f)}</span>
            </span>
          </button>
        {/each}
        {#each wellKnown as wk (wk)}
          <button type="button" class="gpp-file" class:on={selected === wk} onclick={() => (selected = wk)}>
            <span class="material-symbols-outlined ic">link</span>
            <span class="gpp-fmain">
              <span class="gpp-fname">{wk}</span>
              <span class="gpp-fmeta">{t('grpc.proto.wellKnown')}</span>
            </span>
          </button>
        {/each}
      </div>
      <div class="gpp-view" bind:this={viewer}>
        {#if readError}
          <div class="gpp-readerr">{readError}</div>
        {:else}
          {#each lines as line, i (i)}
            <div class="gpp-line" class:cur={i + 1 === currentLine}>
              <span class="gpp-ln">{i + 1}</span>
              <span class="gpp-code"
                >{#each tokenize(line) as tok}<span class={tok.cls}>{tok.text}</span>{/each}</span
              >
              {#if i + 1 === currentLine}<span class="gpp-pill">{t('grpc.proto.current')}</span>{/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .gpp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
  }
  .gpp-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .gpp-grow {
    flex: 1;
  }
  .gpp-seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    background: var(--inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .gpp-seg button {
    height: 28px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    font-size: var(--font-size-ui);
    color: var(--text2);
  }
  .gpp-seg button.on {
    background: var(--s3);
    color: var(--text);
    font-weight: var(--weight-medium);
  }
  .gpp-counts {
    font-family: var(--font-code);
    font-size: var(--font-size-micro);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--t3);
  }
  .gpp-add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-ui);
    color: var(--text2);
  }
  .gpp-add:hover {
    color: var(--text);
  }
  .gpp-add .material-symbols-outlined {
    font-size: 16px;
  }
  .gpp-empty {
    padding: var(--space-8) var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    background: var(--inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
  }
  .gpp-empty .a {
    font-size: var(--font-size-ui);
    font-weight: var(--weight-medium);
  }
  .gpp-empty .b {
    font-size: var(--font-size-caption);
    color: var(--t3);
  }
  .gpp-body {
    display: flex;
    min-height: 220px;
    max-height: 360px;
    background: var(--inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .gpp-files {
    width: 300px;
    flex-shrink: 0;
    overflow: auto;
    padding: var(--space-2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .gpp-root {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    font-family: var(--font-code);
    font-size: var(--font-size-caption);
    color: var(--t3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gpp-root .material-symbols-outlined {
    font-size: 16px;
  }
  .gpp-file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .gpp-file:hover {
    background: var(--hover2);
  }
  .gpp-file.on {
    background: var(--s3);
  }
  .gpp-file .ic {
    font-size: 16px;
    flex-shrink: 0;
    color: var(--t3);
  }
  .gpp-file .ic.ok {
    color: var(--success);
  }
  .gpp-file .ic.warn {
    color: var(--warning);
  }
  .gpp-fmain {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .gpp-fname {
    font-family: var(--font-code);
    font-size: var(--font-size-body);
    word-break: break-all;
  }
  .gpp-fmeta {
    font-size: var(--font-size-micro);
    color: var(--t3);
    margin-top: 2px;
  }
  .gpp-fmeta.warn {
    color: var(--warning);
  }
  .gpp-view {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: var(--space-2) 0;
    font-family: var(--font-code);
    font-size: var(--font-size-body);
    line-height: var(--line-height-code);
  }
  .gpp-line {
    display: flex;
    align-items: center;
    padding-right: var(--space-3);
    white-space: pre;
  }
  .gpp-line.cur {
    background: var(--hover);
  }
  .gpp-ln {
    width: 44px;
    flex-shrink: 0;
    text-align: right;
    padding-right: var(--space-3);
    color: var(--t3);
    user-select: none;
  }
  .gpp-code {
    flex: 1;
  }
  .gpp-code .k {
    color: var(--sk);
  }
  .gpp-code .s {
    color: var(--ss);
  }
  .gpp-code .n {
    color: var(--sn);
  }
  .gpp-code .t {
    color: var(--method-query);
  }
  .gpp-code .c {
    color: var(--t3);
  }
  .gpp-code .p {
    color: var(--syntax-punct);
  }
  .gpp-pill {
    margin-left: var(--space-3);
    padding: 2px 8px;
    border-radius: var(--radius-control);
    background: var(--inverse);
    color: var(--on-inverse);
    font-family: var(--font-ui);
    font-size: var(--font-size-micro);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.06em;
  }
  .gpp-readerr {
    padding: var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--font-size-caption);
    color: var(--t3);
  }
</style>
