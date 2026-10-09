<script lang="ts">
  import { untrack } from 'svelte';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import {
    grpcProtoInspect,
    protoPick,
    terminalDefaultCwd,
    workspacePickFolder,
    type ProtoFileInfo,
  } from '../api';
  import { abbrevHome } from '../domain/proto';
  import { t, tp } from '../i18n';

  let {
    open = $bindable(),
    protoPaths,
    importPaths,
    onConnect,
  }: {
    open: boolean;
    protoPaths: string[];
    importPaths: string[];
    onConnect: (protoPaths: string[], importPaths: string[]) => void;
  } = $props();

  let paths = $state<string[]>([]);
  let imports = $state<string[]>([]);
  let files = $state<ProtoFileInfo[]>([]);
  let dragOver = $state(false);
  let home = $state('');
  let seq = 0;

  const okFiles = $derived(files.filter((f) => f.ok));
  const errCount = $derived(files.length - okFiles.length);
  const serviceCount = $derived(okFiles.reduce((n, f) => n + f.services.length, 0));
  const methodCount = $derived(
    okFiles.reduce((n, f) => n + f.services.reduce((m, s) => m + s.methods.length, 0), 0),
  );

  /** Re-inspect; folders are expanded into their files and become import roots. */
  async function refresh(): Promise<void> {
    const id = ++seq;
    if (paths.length === 0) {
      files = [];
      return;
    }
    try {
      const r = await grpcProtoInspect(paths, imports);
      if (id !== seq) return;
      files = r.files;
      paths = r.files.map((f) => f.path);
      imports = r.importPaths;
    } catch (err) {
      console.error('proto inspect failed', err);
    }
  }

  function add(newPaths: string[]): void {
    // Dropped folders have no extension; anything else must be a .proto file.
    const wanted = newPaths.filter((p) => p.endsWith('.proto') || !/\.[^/\\]+$/.test(p));
    paths = [...new Set([...paths, ...wanted])];
    void refresh();
  }

  async function pickFiles(): Promise<void> {
    const picked = await protoPick();
    if (picked) add(picked);
  }

  async function pickImportFolder(): Promise<void> {
    const dir = await workspacePickFolder();
    if (!dir) return;
    if (!imports.includes(dir)) imports = [...imports, dir];
    void refresh();
  }

  function removeFile(path: string): void {
    paths = paths.filter((p) => p !== path);
    void refresh();
  }

  function removeImport(dir: string): void {
    imports = imports.filter((p) => p !== dir);
    void refresh();
  }

  function connect(): void {
    onConnect(okFiles.map((f) => f.path), imports);
    open = false;
  }

  function close(): void {
    open = false;
  }

  type Tp = (n: number, ru: [string, string, string], en: [string, string]) => string;
  const nServices = (tp: Tp, n: number): string => `${n} ${tp(n, ['сервис', 'сервиса', 'сервисов'], ['service', 'services'])}`;
  const nMethods = (tp: Tp, n: number): string => `${n} ${tp(n, ['метод', 'метода', 'методов'], ['method', 'methods'])}`;
  const nFiles = (tp: Tp, n: number): string => `${n} ${tp(n, ['файл', 'файла', 'файлов'], ['file', 'files'])}`;
  function subtitle(f: ProtoFileInfo, tp: Tp): string {
    const names = f.services.map((s) => s.name.split('.').pop()).join(', ');
    const methods = nMethods(tp, f.services.reduce((n, s) => n + s.methods.length, 0));
    const wk = f.wellKnownDeps.map((d) => ` · + ${d.split('/').pop()} (well-known)`).join('');
    return `${names ? names + ' · ' : ''}${methods}${wk}`;
  }

  // Reset from props each time the dialog opens. Only `open` is tracked:
  // refresh() reads and rewrites `paths`/`imports`, which would loop.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      paths = [...protoPaths];
      imports = [...importPaths];
      files = [];
      void refresh();
    });
    void terminalDefaultCwd().then((h) => (home = h)).catch(() => {});
  });

  // Tauri delivers dropped file paths through the webview, not HTML5 drop.
  $effect(() => {
    if (!open) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'over' || p.type === 'enter') dragOver = true;
        else if (p.type === 'leave') dragOver = false;
        else if (p.type === 'drop') {
          dragOver = false;
          add(p.paths);
        }
      })
      .then((fn) => (cancelled ? fn() : (off = fn)))
      .catch(() => {});
    return () => {
      cancelled = true;
      off?.();
      dragOver = false;
    };
  });

  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="bs-overlay pid-overlay" role="dialog" aria-modal="true" aria-labelledby="pid-title">
    <div class="pid">
      <div class="pid-head">
        <h2 id="pid-title" class="pid-title">{$t('import.proto.title')}</h2>
        <p class="pid-sub">{$t('import.proto.sub')}</p>
      </div>

      <div class="pid-drop" class:over={dragOver}>
        <span class="material-symbols-outlined pid-drop-ic">upload_file</span>
        <div class="pid-drop-t">
          <div class="a">{$t('import.proto.dropA')}</div>
          <div class="b">{$t('import.proto.dropB')}</div>
        </div>
        <button type="button" class="pid-pill" onclick={pickFiles}>{$t('import.proto.pick')}</button>
      </div>

      {#if files.length > 0}
        <div class="pid-list">
          {#each files as f (f.path)}
            {#if f.ok}
              <div class="pid-row">
                <span class="material-symbols-outlined pid-ic ok">check_circle</span>
                <div class="pid-main">
                  <div class="pid-name">{f.name}</div>
                  <div class="pid-meta">{subtitle(f, $tp)}</div>
                </div>
                <button type="button" class="pid-x" aria-label={$t('import.proto.remove', { name: f.name })} onclick={() => removeFile(f.path)}>
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            {:else}
              <div class="pid-row warn">
                <span class="material-symbols-outlined pid-ic warn">error</span>
                <div class="pid-main">
                  <div class="pid-name">{f.name}</div>
                  <div class="pid-msg">{f.error?.message ?? ''}</div>
                </div>
                {#if f.error?.kind === 'missing_import'}
                  <button type="button" class="pid-link" onclick={pickImportFolder}>
                    <span class="material-symbols-outlined">create_new_folder</span>{$t('import.proto.setPath')}
                  </button>
                {/if}
                <button type="button" class="pid-x" aria-label={$t('import.proto.remove', { name: f.name })} onclick={() => removeFile(f.path)}>
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            {/if}
          {/each}
        </div>
      {/if}

      <div class="pid-paths">
      <div class="pid-eyebrow">{$t('import.proto.eyebrow')}</div>
      <div class="pid-chips">
        {#each imports as dir (dir)}
          <span class="pid-chip">
            <span class="pid-chip-t" title={dir}>{abbrevHome(dir, home)}</span>
            <button type="button" class="pid-chip-x" aria-label={$t('import.proto.remove', { name: dir })} onclick={() => removeImport(dir)}>
              <span class="material-symbols-outlined">close</span>
            </button>
          </span>
        {/each}
        <button type="button" class="pid-chip add" onclick={pickImportFolder}>
          <span class="material-symbols-outlined">add</span>{$t('import.proto.addPath')}
        </button>
      </div>
      </div>

      <div class="pid-foot">
        <div class="pid-stat">
          <div class="a">{nServices($tp, serviceCount)} · {nMethods($tp, methodCount)}</div>
          {#if errCount > 0}
            <div class="w">
              {errCount === 1
                ? $t('import.proto.oneErr')
                : $t('import.proto.manyErr', { files: nFiles($tp, errCount) })}
            </div>
          {/if}
        </div>
        <button type="button" class="pid-btn" onclick={close}>{$t('common.cancel')}</button>
        <button type="button" class="pid-btn primary" disabled={okFiles.length === 0} onclick={connect}>
          {$t('import.proto.connect', { n: okFiles.length, total: files.length })}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Sizes follow the S27 mock (Pencil node «Proto import dialog»). */
  .pid-overlay { background: var(--color-scrim); }
  .pid { width: 600px; max-width: 92vw; max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 18px; padding: 28px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-dialog); background: var(--color-raised); box-shadow: var(--shadow-panel); color: var(--color-text); }
  .pid-head { display: flex; flex-direction: column; gap: 6px; }
  .pid-title { margin: 0; font: 600 18px/22px var(--font-ui); }
  .pid-sub { margin: 0; color: var(--color-text-secondary); font: var(--font-size-body)/18px var(--font-ui); }
  .pid-drop { display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 10px 0 18px; border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-field); transition: border-color var(--duration-hover), background var(--duration-hover); }
  .pid-drop.over { border-color: var(--color-text); border-style: dashed; background: var(--color-selected); }
  .pid-drop-ic { font-size: 20px; color: var(--color-text-secondary); }
  .pid-drop-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pid-drop-t .a { font: 500 var(--font-size-ui)/16px var(--font-ui); }
  .pid-drop-t .b { color: var(--color-text-muted); font: var(--font-size-caption)/13px var(--font-ui); }
  .pid-pill { height: 34px; padding: 0 16px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-panel); color: var(--color-text); font: 500 var(--font-size-body) var(--font-ui); }
  .pid-pill:hover { background: var(--color-selected); }
  .pid-list { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-card); }
  .pid-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
  .pid-row + .pid-row { border-top: 1px solid var(--color-border-subtle); }
  .pid-row.warn { background: var(--color-warning-soft); }
  .pid-ic { flex-shrink: 0; font-size: 16px; }
  .pid-ic.ok { color: var(--color-success); }
  .pid-ic.warn { color: var(--color-warning); }
  .pid-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pid-name { overflow: hidden; font: 500 var(--font-size-body)/16px var(--font-code); text-overflow: ellipsis; white-space: nowrap; }
  .pid-meta { overflow: hidden; color: var(--color-text-muted); font: var(--font-size-caption)/13px var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .pid-msg { color: var(--color-warning); font: var(--font-size-caption)/15px var(--font-code); }
  .pid-x { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; color: var(--color-text-secondary); }
  .pid-x:hover { background: var(--color-hover); color: var(--color-text); }
  .pid-x .material-symbols-outlined { font-size: 15px; }
  .pid-link { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px; border-radius: var(--radius-control); color: var(--color-text-secondary); font: 500 var(--font-size-body) var(--font-ui); }
  .pid-link:hover { background: var(--color-hover); color: var(--color-text); }
  .pid-link .material-symbols-outlined { font-size: 16px; }
  .pid-paths { display: flex; flex-direction: column; gap: 8px; }
  .pid-eyebrow { color: var(--color-text-muted); font: 500 var(--font-size-micro)/13px var(--font-code); letter-spacing: var(--tracking-eyebrow); }
  .pid-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pid-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 12px; border-radius: var(--radius-control); background: var(--color-selected); font: var(--font-size-caption) var(--font-code); }
  .pid-chip-t { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pid-chip-x { display: flex; color: var(--color-text-muted); }
  .pid-chip-x:hover { color: var(--color-text); }
  .pid-chip-x .material-symbols-outlined { font-size: 13px; }
  .pid-chip.add { gap: 4px; padding: 0 12px 0 8px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); font-family: var(--font-ui); }
  .pid-chip.add:hover { background: var(--color-hover); }
  .pid-chip.add .material-symbols-outlined { font-size: 14px; }
  .pid-foot { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
  .pid-stat { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pid-stat .a { font: 600 var(--font-size-body)/15px var(--font-ui); }
  .pid-stat .w { color: var(--color-warning); font: var(--font-size-caption)/13px var(--font-ui); }
  .pid-btn { height: 34px; padding: 0 16px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-panel); color: var(--color-text); font: 500 var(--font-size-body) var(--font-ui); }
  .pid-btn:hover { background: var(--color-selected); }
  .pid-btn.primary { border-color: transparent; background: var(--color-action); color: var(--color-on-action); font-weight: 600; }
  .pid-btn.primary:hover { background: var(--primary-hover); }
  .pid-btn.primary:disabled { opacity: 0.5; cursor: default; }
</style>
