<script lang="ts">
  /**
   * Right-docked "Code snippet" panel (Postman-style): renders the active request
   * as code in a chosen language via httpsnippet, with a language dropdown and a
   * copy button. HTTP tabs only; overlays the right edge of the work area.
   */
  import { LANGUAGES, generateSnippet } from '../domain/codegen';
  import { activeEnvironmentId, environments, globals, currentVarScope } from '../stores';
  import type { Tab } from '../domain/types';

  let { tab, onClose, width = $bindable(420) }: { tab: Tab; onClose: () => void; width?: number } = $props();

  // Drag the left edge to resize. Panel is right-docked, so width = distance
  // from the right window edge to the pointer.
  function startResize(e: PointerEvent): void {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      width = Math.max(300, Math.min(window.innerWidth * 0.75, window.innerWidth - ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  let lang = $state('curl');
  let code = $state('');
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Regenerate whenever the request (immutable tab), selected language, or the
  // variable scope (globals / environments / active env) changes. Referencing
  // the three stores keeps the effect subscribed so snippets re-render when a
  // variable value or the active environment changes.
  $effect(() => {
    const t = tab;
    const l = lang;
    void $globals;
    void $environments;
    void $activeEnvironmentId;
    const scope = currentVarScope();
    let cancelled = false;
    void generateSnippet(t, l, scope).then((c) => {
      if (!cancelled) code = c;
    });
    return () => {
      cancelled = true;
    };
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1200);
    } catch (e) {
      console.error('copy snippet failed', e);
    }
  }
</script>

<aside class="bs-codepanel" style="width:{width}px">
  <div class="bs-codepanel-resize" role="separator" aria-label="Resize code panel" onpointerdown={startResize}></div>
  <div class="bs-codepanel-h">
    <span class="t">Code snippet</span>
    <button class="x" aria-label="Close" onclick={onClose}>
      <span class="material-symbols-outlined" style="font-size:18px">close</span>
    </button>
  </div>
  <div class="bs-codepanel-sub">
    <select class="bs-codepanel-lang" bind:value={lang} aria-label="Snippet language">
      {#each LANGUAGES as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
    </select>
    <button class="copy" title="Copy" onclick={copy}>
      <span class="material-symbols-outlined" style="font-size:14px">{copied ? 'check' : 'content_copy'}</span>{copied ? 'Copied' : 'Copy'}
    </button>
  </div>
  <pre class="bs-codepanel-code">{code}</pre>
</aside>

<style>
  .bs-codepanel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    min-width: 300px;
    background: var(--bg);
    border-left: 0.5px solid var(--sep);
    display: flex;
    flex-direction: column;
    z-index: 6;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  }
  .bs-codepanel-resize {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 7;
  }
  .bs-codepanel-resize:hover {
    background: var(--accent);
    opacity: 0.35;
  }
  .bs-codepanel-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 0.5px solid var(--sep);
  }
  .bs-codepanel-h .t {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }
  .bs-codepanel-h .x {
    background: none;
    border: none;
    color: var(--t3);
    cursor: pointer;
    display: flex;
  }
  .bs-codepanel-sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 14px 6px;
  }
  .bs-codepanel-lang {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    background: var(--inset);
    border: 0.5px solid var(--sep);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
    outline: none;
    max-width: 220px;
  }
  .bs-codepanel-sub .copy {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--t2);
    background: var(--surface);
    border: 0.5px solid var(--sep);
    border-radius: 6px;
    padding: 3px 8px;
    cursor: pointer;
    flex: none;
  }
  .bs-codepanel-code {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 4px 14px 14px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre;
  }
</style>
