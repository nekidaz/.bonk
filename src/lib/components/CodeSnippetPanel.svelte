<script lang="ts">
  /**
   * Right-docked "Code snippet" panel (Postman-style): renders the active request
   * as code in a chosen language, with a language dropdown and a copy button.
   * HTTP uses httpsnippet; gRPC produces a directly runnable grpcurl command.
  */
  import { GRPC_LANGUAGES, LANGUAGES, generateSnippet } from '../domain/codegen';
  import { methodShort } from '../domain/grpc';
  import { snapPanelSize } from '../domain/appShell';
  import { activeEnvironmentId, environments, globals, currentVarScope } from '../stores';
  import type { Tab } from '../domain/types';

  let {
    tab,
    onClose,
    onResizeEnd = () => {},
    width = $bindable(420),
  }: {
    tab: Tab;
    onClose: () => void;
    onResizeEnd?: () => void;
    width?: number;
  } = $props();

  const PANEL_MIN = 300;
  const PANEL_COLLAPSE_AT = 160;
  let collapsePreview = $state(false);

  // Drag the shared edge to resize. The panel is a real flex column beside the
  // main workspace, so resizing it also resizes the editor instead of covering it.
  function startResize(e: PointerEvent): void {
    e.preventDefault();
    const panel = (e.currentTarget as HTMLElement).parentElement;
    const main = panel?.previousElementSibling as HTMLElement | null;
    const host = panel?.parentElement;
    if (!panel || !main || !host) return;
    const hostRight = host.getBoundingClientRect().right;
    const startWidth = width;
    const maxWidth = Math.max(PANEL_MIN, panel.getBoundingClientRect().width + main.getBoundingClientRect().width - 360);
    const onMove = (ev: PointerEvent) => {
      const snapped = snapPanelSize(hostRight - ev.clientX, PANEL_MIN, maxWidth, PANEL_COLLAPSE_AT);
      collapsePreview = snapped.collapsed;
      width = snapped.collapsed ? startWidth : snapped.size;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const collapse = collapsePreview;
      collapsePreview = false;
      if (collapse) onClose();
      else onResizeEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  const languages = $derived(tab.protocol === 'grpc' ? GRPC_LANGUAGES : LANGUAGES);
  let lang = $state('curl');
  let languageProtocol = $state<Tab['protocol'] | undefined>(undefined);
  let code = $state('');
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const codeLines = $derived(code.split('\n'));
  const requestLabel = $derived(
    tab.protocol === 'grpc'
      ? (tab.grpc?.method ? methodShort(tab.grpc.method) : 'gRPC request')
      : `${tab.request.method || 'HTTP'} request`,
  );

  type TokenKind = 'plain' | 'command' | 'flag' | 'string' | 'number' | 'punctuation';
  type SnippetToken = { text: string; kind: TokenKind };
  const COMMANDS = new Set([
    'grpcurl', 'curl', 'fetch', 'const', 'let', 'var', 'new', 'await', 'async',
    'function', 'return', 'import', 'from', 'package', 'func', 'def', 'class',
  ]);
  const TOKEN_RE = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|--?[A-Za-z][\w-]*|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b|[{}[\](),;:\\]/g;

  /** Lightweight tokenization for the read-only viewer; Svelte escapes text. */
  function snippetTokens(line: string): SnippetToken[] {
    const tokens: SnippetToken[] = [];
    let cursor = 0;
    for (const match of line.matchAll(TOKEN_RE)) {
      const index = match.index ?? 0;
      if (index > cursor) tokens.push({ text: line.slice(cursor, index), kind: 'plain' });
      const text = match[0];
      let kind: TokenKind = 'plain';
      if (/^['"`]/.test(text)) kind = 'string';
      else if (/^--?[A-Za-z]/.test(text)) kind = 'flag';
      else if (COMMANDS.has(text)) kind = 'command';
      else if (/^\d/.test(text)) kind = 'number';
      else if (/^[{}[\](),;:\\]$/.test(text)) kind = 'punctuation';
      tokens.push({ text, kind });
      cursor = index + text.length;
    }
    if (cursor < line.length) tokens.push({ text: line.slice(cursor), kind: 'plain' });
    return tokens.length ? tokens : [{ text: line || ' ', kind: 'plain' }];
  }

  // The same request tab can be switched between HTTP and gRPC in place.
  // Reset only when that protocol changes, not on every immutable tab edit.
  $effect(() => {
    const protocol = tab.protocol;
    if (languageProtocol === protocol) return;
    languageProtocol = protocol;
    lang = protocol === 'grpc' ? 'grpcurl' : 'curl';
  });

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

<aside class="bs-codepanel" class:collapsing={collapsePreview} style="width:{width}px">
  <div class="bs-codepanel-resize" role="separator" aria-label="Resize code panel" onpointerdown={startResize}></div>
  <div class="bs-codepanel-h">
    <div class="bs-codepanel-title">
      <span class="bs-codepanel-title-icon material-symbols-outlined" aria-hidden="true">terminal</span>
      <div>
        <div class="t">Code snippet <span>{tab.protocol === 'grpc' ? 'gRPC' : 'HTTP'}</span></div>
        <div class="sub">{requestLabel}</div>
      </div>
    </div>
    <button class="x" aria-label="Close" onclick={onClose}>
      <span class="material-symbols-outlined" style="font-size:18px">close</span>
    </button>
  </div>
  <div class="bs-codepanel-sub">
    <label class="bs-codepanel-lang-wrap">
      <span class="material-symbols-outlined" aria-hidden="true">code</span>
      <select class="bs-codepanel-lang" bind:value={lang} aria-label="Snippet language">
        {#each languages as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
      </select>
      <span class="material-symbols-outlined chevron" aria-hidden="true">expand_more</span>
    </label>
    <button class="copy" class:copied title="Copy" onclick={copy}>
      <span class="material-symbols-outlined">{copied ? 'check' : 'content_copy'}</span>{copied ? 'Copied' : 'Copy'}
    </button>
  </div>
  <div class="bs-codepanel-view">
    <div class="bs-codepanel-view-h">
      <span><i></i>Live preview</span>
      <span>{codeLines.length} {codeLines.length === 1 ? 'line' : 'lines'}</span>
    </div>
    <div class="bs-codepanel-code" role="region" aria-label="Generated code snippet">
      {#each codeLines as line, index (index)}
        <div class="bs-codepanel-line">
          <span class="ln" aria-hidden="true">{index + 1}</span>
          <code>{#each snippetTokens(line) as token}<span class:command={token.kind === 'command'} class:flag={token.kind === 'flag'} class:string={token.kind === 'string'} class:number={token.kind === 'number'} class:punctuation={token.kind === 'punctuation'}>{token.text}</span>{/each}</code>
        </div>
      {/each}
    </div>
  </div>
</aside>

<style>
  .bs-codepanel {
    position: relative;
    flex: none;
    min-height: 0;
    min-width: 300px;
    background: var(--surface);
    border-left: 1px solid var(--sep);
    display: flex;
    flex-direction: column;
  }
  .bs-codepanel.collapsing {
    width: 0 !important;
    min-width: 0;
    overflow: hidden;
    border-left-color: var(--accent);
  }
  .bs-codepanel-resize {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 2;
  }
  .bs-codepanel-resize:hover {
    background: var(--accent);
    opacity: 0.35;
  }
  .bs-codepanel-h {
    min-height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 14px;
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-codepanel-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .bs-codepanel-title-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--accent);
    background: var(--accentsoft);
    border-radius: 8px;
    font-size: 17px;
  }
  .bs-codepanel-h .t {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }
  .bs-codepanel-h .t span {
    margin-left: 5px;
    padding: 2px 5px;
    color: var(--t3);
    background: var(--inset);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 700;
  }
  .bs-codepanel-h .sub {
    max-width: 250px;
    margin-top: 2px;
    overflow: hidden;
    color: var(--t3);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-codepanel-h .x {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--t3);
    border-radius: 6px;
  }
  .bs-codepanel-h .x:hover { color: var(--text); background: var(--hover); }
  .bs-codepanel-sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--sepsoft);
  }
  .bs-codepanel-lang-wrap {
    height: 32px;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    position: relative;
    color: var(--t3);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 7px;
  }
  .bs-codepanel-lang-wrap > .material-symbols-outlined { margin-left: 8px; font-size: 15px; }
  .bs-codepanel-lang-wrap > .chevron { margin: 0 7px 0 2px; pointer-events: none; }
  .bs-codepanel-lang {
    height: 100%;
    min-width: 88px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    background: transparent;
    border: 0;
    padding: 0 2px 0 7px;
    cursor: pointer;
    outline: none;
    appearance: none;
    max-width: 220px;
  }
  .bs-codepanel-sub .copy {
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--t2);
    background: var(--inset);
    border: 1px solid var(--sep);
    border-radius: 7px;
    flex: none;
  }
  .bs-codepanel-sub .copy:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 38%, var(--sep)); }
  .bs-codepanel-sub .copy.copied { color: var(--green); }
  .bs-codepanel-sub .copy .material-symbols-outlined { font-size: 15px; }
  .bs-codepanel-view {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    margin: 12px;
    overflow: hidden;
    background: var(--canvas);
    border: 1px solid var(--sepsoft);
    border-radius: 9px;
  }
  .bs-codepanel-view-h {
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    padding: 0 10px;
    color: var(--t3);
    background: color-mix(in srgb, var(--surface) 72%, transparent);
    border-bottom: 1px solid var(--sepsoft);
    font-size: 10px;
  }
  .bs-codepanel-view-h span:first-child { display: inline-flex; align-items: center; gap: 6px; }
  .bs-codepanel-view-h i { width: 6px; height: 6px; background: var(--green); border-radius: 50%; }
  .bs-codepanel-code {
    flex: 1;
    overflow: auto;
    padding: 8px 0 18px;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.72;
    color: var(--text);
    outline: none;
  }
  .bs-codepanel-line {
    min-width: max-content;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    padding-right: 14px;
  }
  .bs-codepanel-line:hover { background: color-mix(in srgb, var(--hover) 72%, transparent); }
  .bs-codepanel-line .ln {
    padding-right: 11px;
    color: color-mix(in srgb, var(--t3) 66%, transparent);
    border-right: 1px solid var(--sepsoft);
    text-align: right;
    user-select: none;
  }
  .bs-codepanel-line code {
    display: block;
    padding-left: 12px;
    font: inherit;
    white-space: pre;
  }
  .bs-codepanel-line .command { color: var(--accent); font-weight: 650; }
  .bs-codepanel-line .flag { color: var(--syn-key, #74a7d8); }
  .bs-codepanel-line .string { color: var(--syn-string, #78a76f); }
  .bs-codepanel-line .number { color: var(--syn-number, #b68bd4); }
  .bs-codepanel-line .punctuation { color: var(--t3); }
</style>
