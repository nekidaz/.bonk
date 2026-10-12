<script lang="ts">
  // IM3: a spec, collection or HAR dragged over the window shows «Отпустите, чтобы импортировать»;
  // dropping it opens the import window with the file. Tauri delivers file paths through the
  // webview, not HTML5 drop events (those never fire in the macOS webview).
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { importWindow } from '$entities/workspace';
  import { importReadFile, type ImportFile } from '$shared/ipc';
  import { t } from '$shared/i18n';
  import { loadSource } from './source';

  const IMPORTABLE = /\.(json|ya?ml|har|txt|sh|curl)$/i;

  let file = $state.raw<ImportFile | null>(null);
  let label = $state('');
  let over = $state(false);
  let seq = 0;

  async function enter(paths: string[]): Promise<void> {
    // The .proto dialog, Settings → Внешний вид (theme import) and «Окружения → Из JSON» take their own drops.
    const path = paths.find((p) => IMPORTABLE.test(p));
    if (!path || document.querySelector('.pid-overlay, [data-theme-drop], [data-env-drop]')) return;
    const id = ++seq;
    over = true;
    label = '';
    file = { name: path.split(/[\\/]/).pop() ?? path, path, size: 0, text: '' };
    try {
      const f = await importReadFile(path);
      if (id !== seq) return;
      file = f;
      label = loadSource(f.text, { kind: 'file', location: f.path, name: f.name, size: f.size }).label;
    } catch {
      /* the window shows why once it opens */
    }
  }

  async function drop(): Promise<void> {
    const f = file;
    over = false;
    if (!f) return;
    file = null;
    try {
      importWindow.open({ file: f.text ? f : await importReadFile(f.path) });
    } catch {
      importWindow.open();
    }
  }

  $effect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === 'enter') void enter(p.paths);
          else if (p.type === 'leave') {
            seq++;
            over = false;
            file = null;
          } else if (p.type === 'drop' && over) void drop();
        })
        .then((fn) => (cancelled ? fn() : (off = fn)))
        .catch(() => {});
    } catch {
      /* not inside Tauri (browser preview) */
    }
    return () => {
      cancelled = true;
      off?.();
    };
  });
</script>

{#if over && file}
  <div class="dz" aria-live="polite">
    <div class="frame">
      <span class="tile"><span class="material-symbols-outlined">download</span></span>
      <div class="ttl">{t('import.drop.title')}</div>
      <div class="chip">
        <span class="material-symbols-outlined">description</span>
        <span class="nm">{file.name}</span>
        {#if label}<span class="fmt">{label}</span>{/if}
      </div>
      <div class="sub">{t('import.drop.sub')}</div>
    </div>
  </div>
{/if}

<style>
  .dz {
    position: fixed;
    inset: 0;
    z-index: 1000;
    padding: 36px;
    background: color-mix(in srgb, var(--color-app) 82%, transparent);
    pointer-events: none;
  }
  .frame {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    border: 2px solid var(--color-var);
    border-radius: var(--radius-window);
  }
  .tile {
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-card);
    background: var(--color-var-soft);
    color: var(--color-var);
  }
  .tile .material-symbols-outlined {
    font-size: 30px;
  }
  .ttl {
    font: var(--weight-semibold) 24px / 30px var(--font-ui);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 6px 0 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-raised);
  }
  .chip .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-secondary);
  }
  .nm {
    font: var(--font-size-ui) var(--font-code);
  }
  .fmt {
    padding: 2px 8px;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font: var(--font-size-body) var(--font-code);
  }
  .sub {
    color: var(--color-text-secondary);
    font: var(--font-size-ui) var(--font-ui);
  }
</style>
