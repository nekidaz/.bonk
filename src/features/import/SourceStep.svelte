<script lang="ts">
  // IM2 + IM6: pick the source (file, link, paste), see what was detected or why it doesn't read.
  import { CodeEditor } from '$shared/editor/components';
  import { errorAtLine } from '$shared/editor';
  import { timeAgo } from '$entities/environment';
  import { t } from '$shared/i18n';
  import { formatSize, sourceStats, SourceError, type Loaded } from './source';
  import type { RecentSource } from './store.svelte';

  let {
    tab = $bindable(),
    url = $bindable(),
    text = $bindable(),
    asNew = $bindable(),
    loaded,
    error,
    busy,
    match,
    recent,
    onPick,
    onLoadUrl,
    onRecent,
    onForget,
    onCancel,
    onNext,
  }: {
    tab: 'file' | 'url' | 'paste';
    url: string;
    text: string;
    asNew: boolean;
    loaded: Loaded | null;
    error: Error | null;
    busy: boolean;
    /** Name of the collection this source was imported into before. */
    match: string | null;
    recent: RecentSource[];
    onPick: () => void;
    onLoadUrl: () => void;
    onRecent: (r: RecentSource) => void;
    onForget: (r: RecentSource) => void;
    onCancel: () => void;
    onNext: () => void;
  } = $props();

  const tabs = [
    { id: 'file', icon: 'upload_file', label: 'import.tab.file' },
    { id: 'url', icon: 'link', label: 'import.tab.url' },
    { id: 'paste', icon: 'content_paste', label: 'import.tab.paste' },
  ] as const;
  const formats = ['OpenAPI 3.x', 'Swagger 2.0', 'Postman v2.1', 'Insomnia v4', 'HAR', 'cURL'];

  const srcErr = $derived(error instanceof SourceError ? error : null);
  // «К строке N» moves the paste editor there; any edit afterwards stops forcing it.
  let jump = $state(false);
  $effect(() => {
    void text;
    jump = false;
  });
  const marks = $derived(srcErr?.line && tab === 'paste' ? errorAtLine(srcErr.line, jump) : []);
  const pasteLang = $derived(/^\s*[[{]/.test(text) ? 'json' : 'text');

  const errTitle = $derived(
    srcErr?.line
      ? t('import.err.at', { syntax: srcErr.syntax ?? '', line: srcErr.line, col: srcErr.col ?? 1 })
      : t('import.err.read'),
  );
  const errDesc = $derived(
    !error
      ? ''
      : srcErr?.line
        ? srcErr.guess
          ? t('import.err.looks', { format: srcErr.guess, reason: srcErr.message })
          : t('import.err.stop', { reason: srcErr.message })
        : error.message,
  );
</script>

<div class="imp-body src">
  <div class="bs-seg imp-tabs" role="tablist" aria-label={t('import.title')}>
    {#each tabs as x (x.id)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === x.id}
        class:on={tab === x.id}
        onclick={() => (tab = x.id)}
      >
        <span class="material-symbols-outlined">{x.icon}</span>{t(x.label)}
      </button>
    {/each}
  </div>

  {#if tab === 'file'}
    <div class="drop">
      <span class="material-symbols-outlined">upload_file</span>
      <div class="drop-t">
        <div class="a">{t('import.file.drop')}</div>
        <div class="b">{t('import.file.dropSub')}</div>
      </div>
      <button type="button" class="imp-btn" onclick={onPick} disabled={busy}>{t('import.file.pick')}</button>
    </div>
  {:else if tab === 'url'}
    <form
      class="urlrow"
      onsubmit={(e) => {
        e.preventDefault();
        onLoadUrl();
      }}
    >
      <label class="urlfield">
        <span class="material-symbols-outlined">link</span>
        <input
          type="url"
          bind:value={url}
          placeholder={t('import.url.placeholder')}
          spellcheck="false"
          aria-label={t('import.tab.url')}
        />
      </label>
      <button type="submit" class="imp-btn" disabled={busy || !url.trim()}>
        <span class="material-symbols-outlined">{loaded?.origin.location === url.trim() ? 'refresh' : 'download'}</span>
        {busy
          ? t('import.loading')
          : loaded?.origin.location === url.trim()
            ? t('import.url.refresh')
            : t('import.url.load')}
      </button>
    </form>
  {:else}
    <div class="paste" class:bad={!!error}>
      <CodeEditor
        value={text}
        onChange={(v) => (text = v)}
        lang={pasteLang}
        placeholder={t('import.paste.placeholder')}
        fill
        bare
        folding={false}
        ariaLabel={t('import.tab.paste')}
        extensions={marks}
      />
    </div>
  {/if}

  {#if error}
    <div class="err" role="alert">
      <span class="material-symbols-outlined">error</span>
      <div class="err-t">
        <div class="a">{errTitle}</div>
        <div class="b">{errDesc}</div>
      </div>
      {#if srcErr?.line && tab === 'paste'}
        <button type="button" class="imp-link" onclick={() => (jump = true)}>
          {t('import.err.goto', { line: srcErr.line })}
        </button>
      {/if}
    </div>
  {:else if loaded}
    <div class="card">
      <span class="tile"><span class="material-symbols-outlined">description</span></span>
      <div class="card-main">
        <div class="card-h">
          <span class="ttl">{loaded.title}</span>
          {#if loaded.version}<span class="chip mono">v{loaded.version.replace(/^v/i, '')}</span>{/if}
          <span class="chip mono ok">{loaded.label}</span>
          {#if loaded.syntax !== 'text'}<span class="chip mono">{loaded.syntax}</span>{/if}
          {#if loaded.origin.size}<span class="chip mono">{formatSize(loaded.origin.size)}</span>{/if}
        </div>
        <div class="stats">{sourceStats(loaded).join('  ·  ')}</div>
      </div>
      <span class="det"><span class="material-symbols-outlined">check_circle</span>{t('import.detected')}</span>
    </div>
    {#if match}
      <div class="match">
        <span class="material-symbols-outlined">sync</span>
        <span>{t('import.match', { name: match })} —</span>
        <button type="button" class="imp-link" class:on={!asNew} onclick={() => (asNew = false)}
          >{t('import.match.update')}</button
        >
        <span>/</span>
        <button type="button" class="imp-link" class:on={asNew} onclick={() => (asNew = true)}
          >{t('import.match.new')}</button
        >
      </div>
    {/if}
  {/if}

  {#if tab !== 'paste' && recent.length}
    <div class="recent">
      <div class="imp-eyebrow">{t('import.recent')}</div>
      {#each recent as r (r.location)}
        <div class="rrow">
          <button type="button" class="rmain" onclick={() => onRecent(r)} disabled={busy}>
            <span class="material-symbols-outlined">{r.kind === 'url' ? 'link' : 'description'}</span>
            <span class="p">{r.location.replace(/^\/(?:Users|home)\/[^/]+/, '~')}</span>
            <span class="meta">{r.label}</span>
            <span class="when">{timeAgo(r.at)}</span>
          </button>
          <button type="button" class="x" aria-label={t('import.recent.forget')} onclick={() => onForget(r)}>
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="knows">
    <span>{t('import.knows')}</span>
    {#each formats as f (f)}<span class="chip mono">{f}</span>{/each}
  </div>
</div>

<div class="imp-foot">
  <span class="note">{t(`import.foot.${tab}`)}</span>
  <button type="button" class="imp-btn" onclick={onCancel}>{t('common.cancel')}</button>
  <button type="button" class="imp-btn primary" disabled={!loaded || busy} onclick={onNext}>
    {match && !asNew ? t('import.next.update') : t('import.next')}
  </button>
</div>

<style>
  .src {
    gap: 16px;
  }
  .imp-tabs {
    align-self: flex-start;
  }
  .imp-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .imp-tabs .material-symbols-outlined {
    font-size: 15px;
  }
  .drop {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 0 10px 0 18px;
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .drop > .material-symbols-outlined {
    font-size: 20px;
    color: var(--color-text-secondary);
  }
  .drop-t {
    flex: 1;
    min-width: 0;
  }
  .drop-t .a {
    font: var(--weight-medium) var(--font-size-ui) / 18px var(--font-ui);
  }
  .drop-t .b {
    color: var(--color-text-muted);
    font: var(--font-size-caption) / 16px var(--font-ui);
  }
  .urlrow {
    display: flex;
    gap: 12px;
  }
  .urlfield {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 16px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
  }
  .urlfield:focus-within {
    border-color: var(--color-text-muted);
  }
  .urlfield .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .urlfield input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-code);
  }
  .paste {
    flex: 1;
    min-height: 220px;
    display: flex;
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .paste.bad {
    border-color: var(--color-danger);
  }
  .paste :global(.cm-import-error) {
    background: var(--color-danger-soft);
  }
  .err {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-radius: var(--radius-card);
    background: var(--color-danger-soft);
  }
  .err > .material-symbols-outlined {
    font-size: 18px;
    color: var(--color-danger);
  }
  .err-t {
    flex: 1;
    min-width: 0;
  }
  .err-t .a {
    font: var(--weight-medium) var(--font-size-ui) / 20px var(--font-ui);
  }
  .err-t .b {
    color: var(--color-text-secondary);
    font: var(--font-size-body) / 18px var(--font-ui);
  }
  .card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-radius: var(--radius-card);
    background: var(--color-panel);
  }
  .tile {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .card-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-h {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .ttl {
    font: var(--weight-medium) var(--font-size-title) / 22px var(--font-ui);
  }
  .stats {
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-code);
  }
  .det {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-success);
    font: var(--font-size-body) var(--font-ui);
    white-space: nowrap;
  }
  .det .material-symbols-outlined {
    font-size: 16px;
  }
  .chip {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-hover-strong);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: 18px;
  }
  .chip.mono {
    font-family: var(--font-code);
  }
  .chip.ok {
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .match {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }
  .match .material-symbols-outlined {
    font-size: 15px;
  }
  .match .imp-link.on {
    color: var(--color-text);
    text-decoration: underline;
  }
  .recent {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recent .imp-eyebrow {
    margin-bottom: 6px;
  }
  .rrow {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .rrow:hover {
    background: var(--color-hover);
  }
  .rmain {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 6px 0 16px;
    text-align: left;
  }
  .rmain .material-symbols-outlined {
    flex: none;
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .p {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    font: var(--font-size-body) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    flex: 1;
    overflow: hidden;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .x {
    flex: none;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    margin-right: 6px;
    border-radius: 50%;
    color: var(--color-text-muted);
    opacity: 0;
  }
  .rrow:hover .x,
  .x:focus-visible {
    opacity: 1;
  }
  .x:hover {
    background: var(--color-hover-strong);
    color: var(--color-text);
  }
  .x .material-symbols-outlined {
    font-size: 14px;
  }
  .knows {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: auto;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
  }
</style>
