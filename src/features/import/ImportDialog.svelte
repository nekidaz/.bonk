<script lang="ts">
  // The import window (Flow · Schema import): one window for every format. Source (IM2/IM6) →
  // preview (IM4/IM5/IM9) → import; or, for a collection imported before, → update (IM8).
  import { untrack } from 'svelte';
  import { findNode, importWindow, workspace, type ImportWindowRequest } from '$entities/workspace';
  import { workspaceName } from '$shared/ui';
  import { t, tp } from '$shared/i18n';
  import type { FolderNode, TreeNode } from '$shared/model';
  import PreviewStep from './PreviewStep.svelte';
  import SourceStep from './SourceStep.svelte';
  import UpdateStep from './UpdateStep.svelte';
  import type { ImportResult } from './apply';
  import { fetchUrl, fromFile, pickFile, readFile, type Fetched } from './load';
  import { loadSource, SourceError, type Loaded } from './source';
  import { forgetSource, recentSources, rememberSource, type RecentSource } from './store.svelte';
  import { Overlay } from '$shared/ui/components';

  let {
    onImported,
    onUpdated,
  }: {
    onImported: (r: ImportResult) => void;
    onUpdated: (name: string, n: number) => void;
  } = $props();

  let step = $state<'source' | 'preview' | 'update'>('source');
  let tab = $state<'file' | 'url' | 'paste'>('file');
  let url = $state('');
  let text = $state('');
  let loaded = $state.raw<Loaded | null>(null);
  let error = $state.raw<Error | null>(null);
  let busy = $state(false);
  let asNew = $state(false);
  /** The collection “Update from the spec” was asked for. */
  let updateId = $state<string | null>(null);

  /** Collections made by import, by their source location. */
  function imported(nodes: TreeNode[], location: string): FolderNode | undefined {
    for (const n of nodes) {
      if (n.kind !== 'folder') continue;
      if (n.source?.location === location) return n;
      const deeper = imported(n.children, location);
      if (deeper) return deeper;
    }
    return undefined;
  }
  const match = $derived(
    loaded && loaded.origin.kind !== 'paste' ? imported(workspace.tree, loaded.origin.location) : undefined,
  );
  const target = $derived.by(() => {
    const n = updateId ? findNode(workspace.tree, updateId) : match;
    return n?.kind === 'folder' ? n : undefined;
  });

  $effect(() => {
    const r = importWindow.current;
    if (r) untrack(() => start(r));
  });

  function start(r: ImportWindowRequest): void {
    step = 'source';
    tab = 'file';
    url = '';
    text = '';
    loaded = null;
    error = null;
    busy = false;
    asNew = false;
    updateId = null;
    if (r.file) accept(fromFile(r.file), true);
    else if (r.update) void startUpdate(r.update);
  }

  async function startUpdate(id: string): Promise<void> {
    const folder = findNode(workspace.tree, id);
    const src = folder?.kind === 'folder' ? folder.source : undefined;
    if (!src) {
      error = new Error(folder ? t('import.err.noSource') : t('import.err.gone'));
      return;
    }
    updateId = id;
    tab = src.kind;
    if (src.kind === 'url') url = src.location;
    await load(() => (src.kind === 'url' ? fetchUrl(src.location) : readFile(src.location)), true);
  }

  /** Parse fetched text; `auto` goes on to the next step when it reads. */
  function accept(f: Fetched, auto: boolean): void {
    try {
      loaded = loadSource(f.text, f.origin);
      error = null;
      if (f.origin.kind !== 'paste')
        rememberSource({
          kind: f.origin.kind,
          location: f.origin.location,
          label: `${loaded.title} · ${loaded.label}`,
        });
      if (auto) next();
    } catch (e) {
      loaded = null;
      error = e instanceof Error ? e : new Error(String(e));
      // A file or link that doesn't parse opens in the paste editor, where the line can be fixed (IM6).
      if (e instanceof SourceError && e.line && f.origin.kind !== 'paste') {
        text = f.text;
        tab = 'paste';
      }
    }
  }

  async function load(get: () => Promise<Fetched | null>, auto = false): Promise<void> {
    busy = true;
    try {
      const f = await get();
      if (f) accept(f, auto);
    } catch (e) {
      loaded = null;
      error = e instanceof Error ? e : new Error(String(e));
    } finally {
      busy = false;
    }
  }

  // The paste is checked as you type.
  $effect(() => {
    if (tab !== 'paste') return;
    const value = text;
    const timer = setTimeout(
      () =>
        untrack(() => {
          if (!value.trim()) {
            loaded = null;
            error = null;
          } else
            accept({ text: value, origin: { kind: 'paste', location: '', name: 'pasted', size: value.length } }, false);
        }),
      250,
    );
    return () => clearTimeout(timer);
  });

  function next(): void {
    step = (updateId || match) && !asNew ? 'update' : 'preview';
  }

  function openRecent(r: RecentSource): void {
    tab = r.kind;
    if (r.kind === 'url') url = r.location;
    void load(() => (r.kind === 'url' ? fetchUrl(r.location) : readFile(r.location)));
  }

  const close = (): void => importWindow.close();

  function onKeydown(e: KeyboardEvent): void {
    if (importWindow.current && e.key === 'Escape' && !busy) {
      e.stopPropagation();
      close();
    }
  }

  const host = (s: string): string => s.replace(/^\w+:\/\//, '');
  const eyebrow = $derived.by(() => {
    if (step === 'source' || !loaded) {
      const ws = workspaceName(workspace.path);
      return [ws, t('import.eyebrow')].filter(Boolean);
    }
    if (step === 'update') {
      const was = target?.source?.version;
      const v =
        was && loaded.version && was !== loaded.version
          ? `v${was} → v${loaded.version}`
          : loaded.version
            ? `v${loaded.version}`
            : '';
      const where = loaded.origin.kind === 'url' ? host(loaded.origin.location) : loaded.origin.name;
      return [loaded.title, v, where].filter(Boolean);
    }
    if (loaded.format === 'har') {
      const n = loaded.har.entries.length;
      return ['HAR', loaded.origin.name, `${n} ${tp(n, ['entry', 'entries'])}`];
    }
    return [loaded.title, loaded.label, loaded.version ? `v${loaded.version}` : ''].filter(Boolean);
  });
  const title = $derived(
    step === 'update' ? t('import.upd.title') : step === 'preview' ? t('import.preview') : t('import.title'),
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if importWindow.current}
  <Overlay class="imp-overlay" role="dialog" aria-modal="true" aria-labelledby="imp-title">
    <div class="imp">
      <div class="imp-head">
        <div class="imp-eyebrow">{eyebrow.join('  ·  ').toUpperCase()}</div>
        <h2 id="imp-title">{title}</h2>
        <button type="button" class="x" aria-label={t('common.close')} onclick={close}>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      {#if step === 'preview' && loaded}
        <PreviewStep
          {loaded}
          onBack={() => (step = 'source')}
          onDone={(r) => {
            close();
            onImported(r);
          }}
        />
      {:else if step === 'update' && loaded && target}
        <UpdateStep
          collection={target}
          {loaded}
          onBack={() => (updateId ? close() : (step = 'source'))}
          onDone={(n) => {
            close();
            onUpdated(target.name, n);
          }}
        />
      {:else}
        <SourceStep
          bind:tab
          bind:url
          bind:text
          bind:asNew
          {loaded}
          {error}
          {busy}
          match={updateId ? (target?.name ?? null) : (match?.name ?? null)}
          recent={recentSources.current}
          onPick={() => load(pickFile)}
          onLoadUrl={() => load(() => fetchUrl(url.trim()))}
          onRecent={openRecent}
          onForget={(r) => forgetSource(r.location)}
          onCancel={close}
          onNext={next}
        />
      {/if}
    </div>
  </Overlay>
{/if}

<style>
  /* Sizes follow the Flow · Schema import mock (Pencil «Import dialog», 1040×660). */
  :global(:root .imp-overlay) {
    background: var(--color-scrim);
  }
  .imp {
    position: relative;
    width: 1040px;
    max-width: 94vw;
    height: 660px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
  }
  .imp-head {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 24px 64px 18px 28px;
  }
  .imp-head h2 {
    margin: 0;
    font: var(--weight-semibold) var(--font-size-heading) / 26px var(--font-ui);
  }
  .x {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }
  .x:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .x .material-symbols-outlined {
    font-size: 18px;
  }

  /* Shared by the steps (they render inside .imp). */
  .imp :global(.imp-eyebrow) {
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-micro) / 14px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .imp :global(.imp-body) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 28px 16px;
    overflow: auto;
  }
  /* The preview is two columns edge to edge: the tree panel and the settings. */
  .imp :global(.imp-body.split) {
    flex-direction: row;
    padding: 0;
    overflow: hidden;
  }
  .imp :global(.imp-foot) {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px 18px 28px;
  }
  .imp :global(.imp-foot .note) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-body) / 18px var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .imp :global(.imp-foot .note.bad) {
    color: var(--color-danger);
    white-space: normal;
  }
  .imp :global(.imp-btn) {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 18px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: var(--weight-medium) var(--font-size-ui) var(--font-ui);
    white-space: nowrap;
  }
  .imp :global(.imp-btn .material-symbols-outlined) {
    font-size: 16px;
  }
  .imp :global(.imp-btn:hover:not(:disabled)) {
    background: var(--color-hover-strong);
  }
  .imp :global(.imp-btn.primary) {
    border-color: transparent;
    background: var(--color-action);
    color: var(--color-on-action);
  }
  .imp :global(.imp-btn.primary:hover:not(:disabled)) {
    background: var(--color-action);
    opacity: 0.9;
  }
  .imp :global(.imp-btn:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  .imp :global(.imp-link) {
    flex: none;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
    white-space: nowrap;
  }
  .imp :global(.imp-link:hover),
  .imp :global(.imp-link.strong) {
    color: var(--color-text);
  }
  .imp :global(.imp-card) {
    display: flex;
    flex-direction: column;
    padding: 4px 18px;
    border-radius: var(--radius-card);
    background: var(--color-panel);
  }
  .imp :global(.imp-row) {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 52px;
    padding: 8px 0;
  }
  .imp :global(.imp-row + .imp-row) {
    border-top: 1px solid var(--color-border-subtle);
  }
  .imp :global(.imp-lbl) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .imp :global(.imp-lbl .a) {
    font: var(--font-size-ui) / 18px var(--font-ui);
  }
  .imp :global(.imp-lbl .b) {
    color: var(--color-text-muted);
    font: var(--font-size-body) / 16px var(--font-ui);
  }
  .imp :global(.imp-input) {
    width: 50%;
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    outline: 0;
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
  }
  .imp :global(.imp-input:focus) {
    border-color: var(--color-text-muted);
  }
</style>
