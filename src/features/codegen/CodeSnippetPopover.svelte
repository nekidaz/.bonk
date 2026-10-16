<script lang="ts">
  /**
   * S15 code snippet popover, anchored under the request header's `<>` button: the active request
   * as code in a chosen language. HTTP uses httpsnippet; gRPC produces a runnable grpcurl command.
   */
  import { t } from '$shared/i18n';
  import { GRPC_LANGUAGES, LANGUAGES, generateSnippet } from './codegen';
  import { methodShort } from '$entities/request';
  import { methodColor, type Tab } from '$shared/model';
  import { openapiExportSave } from '$shared/ipc';
  import { environments, currentVarScope } from '$entities/environment';
  import { withInheritedAuth, workspace } from '$entities/workspace';
  import { LabelSwitch } from '$shared/ui/components';

  let { tab, onClose }: { tab: Tab; onClose: () => void } = $props();

  // The five languages from the design up front; everything else stays one click away.
  const FEATURED = ['curl', 'httpie', 'js-fetch', 'python', 'go'];
  const FEATURED_LABEL: Record<string, string> = {
    curl: 'cURL',
    httpie: 'HTTPie',
    'js-fetch': 'fetch',
    python: 'Python',
    go: 'Go',
  };
  const EXT: Record<string, string> = {
    curl: 'sh',
    httpie: 'sh',
    grpcurl: 'sh',
    'js-fetch': 'js',
    python: 'py',
    go: 'go',
  };

  const featured = $derived(
    tab.protocol === 'grpc'
      ? GRPC_LANGUAGES
      : LANGUAGES.filter((l) => FEATURED.includes(l.id)).sort(
          (a, b) => FEATURED.indexOf(a.id) - FEATURED.indexOf(b.id),
        ),
  );
  let lang = $state('curl');
  $effect.pre(() => {
    if (tab.protocol === 'grpc') lang = 'grpcurl';
    else if (lang === 'grpcurl') lang = 'curl';
  });
  let resolve = $state(false);
  let code = $state('');
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lines = $derived(code.split('\n'));
  const title = $derived(
    tab.protocol === 'grpc'
      ? `gRPC  ·  ${tab.grpc?.method ? methodShort(tab.grpc.method) : tab.title}`
      : `${tab.request.method} ${tab.title}`,
  );
  // S15: name a secret the toggle protects when the request uses one.
  const sampleVar = $derived.by(() => {
    const used = lines.join('\n').match(/\{\{\s*[^{}"\s]+?\s*\}\}/g) ?? [];
    const secrets = new Set((environments.active?.vars ?? []).filter((v) => v.secret).map((v) => v.key));
    return used.find((u) => secrets.has(u.slice(2, -2).trim())) ?? used[0] ?? '{{var}}';
  });

  type TokenKind = 'plain' | 'command' | 'flag' | 'string' | 'var' | 'punctuation' | 'method';
  const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY']);
  const COMMANDS = new Set([
    'grpcurl',
    'curl',
    'http',
    'fetch',
    'const',
    'let',
    'await',
    'import',
    'from',
    'package',
    'func',
    'def',
    'requests',
  ]);
  const TOKEN_RE = /\{\{[^{}]+\}\}|--?[A-Za-z][\w-]*|\b[A-Za-z_$][\w$]*\b|[{}[\](),;:\\]/g;

  /** Lightweight tokenization for the read-only viewer: quoted strings, then commands/flags/{{vars}} inside. */
  function tokens(line: string): { text: string; kind: TokenKind }[] {
    const out: { text: string; kind: TokenKind }[] = [];
    for (const [i, part] of line.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/).entries()) {
      if (!part) continue;
      if (i % 2) {
        for (const [j, bit] of part.split(/(\{\{[^{}]+\}\})/).entries())
          if (bit) out.push({ text: bit, kind: j % 2 ? 'var' : 'string' });
        continue;
      }
      let cursor = 0;
      for (const m of part.matchAll(TOKEN_RE)) {
        const at = m.index ?? 0;
        if (at > cursor) out.push({ text: part.slice(cursor, at), kind: 'plain' });
        const t = m[0];
        out.push({
          text: t,
          kind: t.startsWith('{{')
            ? 'var'
            : t.startsWith('-')
              ? 'flag'
              : COMMANDS.has(t)
                ? 'command'
                : METHODS.has(t)
                  ? 'method'
                  : /^[{}[\](),;:\\]$/.test(t)
                    ? 'punctuation'
                    : 'plain',
        });
        cursor = at + t.length;
      }
      if (cursor < part.length) out.push({ text: part.slice(cursor), kind: 'plain' });
    }
    return out.length ? out : [{ text: ' ', kind: 'plain' }];
  }

  $effect(() => {
    const t = tab;
    const l = lang;
    void environments.globals;
    void workspace.tree;
    void environments.list;
    void environments.activeId;
    const scope = resolve ? currentVarScope(true) : {};
    let cancelled = false;
    void generateSnippet(withInheritedAuth(t, t.savedPath), l, scope).then((c) => {
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
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1200);
    } catch (e) {
      console.error('copy snippet failed', e);
    }
  }

  function download(): void {
    const name = `${tab.title.replace(/[^\w.-]+/g, '-').toLowerCase() || 'request'}.${EXT[lang] ?? 'txt'}`;
    void openapiExportSave(name, code, t('code.snippet.save_title'));
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault();
      void copy();
    }
  }
</script>

<svelte:window onpointerdown={onClose} />

<div
  class="bs-snippet"
  role="dialog"
  aria-label={t('code.snippet.aria')}
  tabindex="-1"
  onpointerdown={(e) => e.stopPropagation()}
  onkeydown={keydown}
  {@attach (el) => el.focus()}
>
  <div class="head">
    <span class="eyebrow">{t('code.snippet.eyebrow')}&nbsp;&nbsp;·&nbsp;&nbsp;{title}</span>
    <button class="close" type="button" aria-label={t('common.close')} onclick={onClose}
      ><span class="material-symbols-outlined">close</span></button
    >
  </div>
  <div class="langs" role="radiogroup" aria-label={t('code.snippet.lang_aria')}>
    {#each featured as l (l.id)}
      <button
        type="button"
        role="radio"
        class:on={lang === l.id}
        aria-checked={lang === l.id}
        onclick={() => (lang = l.id)}>{FEATURED_LABEL[l.id] ?? l.label}</button
      >
    {/each}
  </div>
  <div class="code" role="region" aria-label={t('code.snippet.generated_aria')}>
    {#each lines as line, i (i)}
      <div class="line">
        <span class="ln" aria-hidden="true">{i + 1}</span><code
          >{#each tokens(line) as t}<span
              class={t.kind}
              style={t.kind === 'method' ? `color:${methodColor(t.text)}` : undefined}>{t.text}</span
            >{/each}</code
        >
      </div>
    {/each}
  </div>
  <div class="foot">
    <LabelSwitch class="resolve">
      <input type="checkbox" role="switch" bind:checked={resolve} />
      <span class="track" aria-hidden="true"></span>
      <span class="text"
        ><b>{t('code.snippet.resolve')}</b><small
          >{resolve ? t('code.snippet.on') : t('code.snippet.off', { name: sampleVar })}</small
        ></span
      >
    </LabelSwitch>
    <button class="download" type="button" onclick={download}
      ><span class="material-symbols-outlined" aria-hidden="true">download</span>{t('code.snippet.download')}</button
    >
    <button class="copy" type="button" onclick={copy}
      ><span class="material-symbols-outlined" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>{copied
        ? t('common.copied')
        : t('common.copy')}<kbd>⌘C</kbd></button
    >
  </div>
</div>

<style>
  /* The `.foot .resolve.bs-switch` / `.foot .copy kbd` selectors outrank the global `:root .bs .bs-switch` / `:root .bs kbd`. */
  .bs-snippet {
    position: absolute;
    z-index: 100;
    top: calc(100% + 8px);
    right: -1px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 540px;
    max-width: calc(100vw - 40px);
    padding: 14px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 16px 40px #00000080;
    color: var(--color-text);
    text-align: left;
    cursor: default;
  }

  .bs-snippet:focus {
    outline: 1px solid var(--color-border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding-left: 4px;
  }

  .eyebrow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }

  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }

  .close:hover {
    background: var(--hover);
  }

  .close .material-symbols-outlined {
    font-size: 17px;
  }

  .langs {
    align-self: flex-start;
    display: inline-flex;
    gap: 2px;
    height: 30px;
    padding: 2px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
  }

  .langs button {
    height: 24px;
    margin: 1px 0;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  .langs button.on {
    background: var(--color-raised);
    color: var(--color-text);
    font-weight: 600;
    box-shadow: 0 1px 3px var(--color-shadow);
  }

  .code {
    max-height: 260px;
    overflow: auto;
    padding: 12px 16px 12px 0;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-md);
    background: var(--color-field);
    font: var(--font-size-body)/20px var(--font-code);
  }

  .line {
    display: flex;
    white-space: pre;
  }

  .ln {
    flex: 0 0 36px;
    padding-right: 12px;
    color: var(--color-text-muted);
    text-align: right;
    user-select: none;
  }

  code {
    font: inherit;
    color: var(--color-text);
  }

  code .command {
    font-weight: 600;
  }

  code :is(.flag, .punctuation) {
    color: var(--syntax-punct, var(--color-text-muted));
  }

  code .string {
    color: var(--ss);
  }

  code .var {
    color: var(--color-var);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding-left: 4px;
  }

  :global(:root .foot .resolve.bs-switch) {
    flex: 1;
    min-width: 0;
    gap: 10px;
  }

  :global(.bs-switch.resolve .text) {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  :global(.bs-switch.resolve b) {
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs-switch.resolve small) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  .download {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  .download:hover {
    background: var(--hover);
    color: var(--color-text);
  }

  .copy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 14px 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-action);
    color: var(--color-on-action);
    font: 600 var(--font-size-body) var(--font-ui);
  }

  .copy:hover {
    background: var(--primary-hover);
  }

  :is(.download, .copy) .material-symbols-outlined {
    font-size: 17px;
  }

  .foot .copy kbd {
    color: var(--color-on-action);
    font: var(--font-size-micro) var(--font-code);
    opacity: 0.7;
  }
</style>
