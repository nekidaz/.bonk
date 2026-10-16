<script lang="ts">
  import { workspace } from '$entities/workspace';
  import { history, openHistoryEntry } from '$entities/history';
  import { methodColor, methodLabel } from '$shared/model';
  import { recentRequests, timeAgo } from '$entities/environment';
  import { t } from '$shared/i18n';

  // S01 (empty workspace) and S02 (no open tabs) share the main panel when nothing is open.
  let {
    onNewRequest,
    onImport,
    onPasteCurl,
  }: {
    onNewRequest: () => void;
    onImport: (source?: 'openapi' | 'postman' | 'insomnia' | 'har') => void;
    onPasteCurl: (text: string) => void;
  } = $props();

  let curlInput = $state<HTMLInputElement | null>(null);
  const workspaceName = $derived(workspace.path.split('/').filter(Boolean).at(-1) ?? t('workspace.local'));
  const recent = $derived(recentRequests(history.list, workspace.tree));
  const now = Date.now();

  function curlKeydown(e: KeyboardEvent): void {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onPasteCurl(value);
    }
  }
</script>

{#if workspace.tree.length === 0 || recent.length === 0}
  <section class="bs-welcome" aria-labelledby="bs-welcome-title">
    <div class="eyebrow">
      {workspaceName}&nbsp;&nbsp;·&nbsp;&nbsp;{workspace.tree.length === 0
        ? t('nav.welcome.newWorkspace')
        : t('nav.welcome.noTabs')}
    </div>
    <h1 id="bs-welcome-title">{t('nav.welcome.firstTitle')}</h1>
    <p>{t('nav.welcome.firstText')}</p>
    <div class="actions">
      <button class="primary" type="button" onclick={onNewRequest}
        ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('nav.welcome.newRequest')}<kbd>⌘N</kbd
        ></button
      >
      <button class="secondary" type="button" onclick={() => onImport()}>{t('nav.welcome.import')}</button>
    </div>
    <label class="paste">
      <span class="material-symbols-outlined" aria-hidden="true">terminal</span>
      <input
        bind:this={curlInput}
        placeholder={t('nav.welcome.pasteCurl')}
        aria-label={t('nav.welcome.pasteCurlAria')}
        spellcheck="false"
        onpaste={(e) => {
          const text = e.clipboardData?.getData('text') ?? '';
          if (/^\s*curl\s/i.test(text)) {
            e.preventDefault();
            onPasteCurl(text);
          }
        }}
        onkeydown={curlKeydown}
      />
      <kbd>⌘V</kbd>
    </label>
    <div class="sources">
      <span class="lbl">{t('nav.welcome.importFrom')}</span>
      <button type="button" onclick={() => curlInput?.focus()}>cURL</button>
      {#each [['OpenAPI 3', 'openapi'], ['Postman', 'postman'], ['Insomnia', 'insomnia'], ['HAR', 'har']] as const as [label, src] (src)}<button
          type="button"
          onclick={() => onImport(src)}>{label}</button
        >{/each}
    </div>
  </section>
{:else}
  <section class="bs-welcome bs-no-tabs" aria-labelledby="bs-welcome-title">
    <div class="eyebrow">{t('nav.welcome.noTabs')}</div>
    <h1 id="bs-welcome-title">{t('nav.welcome.continue')}</h1>
    <div class="recent">
      <div class="lbl">{t('nav.welcome.recent')}</div>
      {#each recent as r, i (r.entry.id)}
        <button class="row" class:on={i === 0} type="button" onclick={() => openHistoryEntry(r.entry)}>
          <span class="m" style="color:{methodColor(r.method === 'gRPC' ? 'GRPC' : r.method)}"
            >{r.method === 'gRPC' ? r.method : methodLabel(r.method)}</span
          >
          <span class="name">{r.name}</span>
          <span class="folder">{r.folder}</span>
          <span class="st" class:err={!r.ok}>{r.status}</span>
          <span class="when">{timeAgo(r.entry.at, now)}</span>
        </button>
      {/each}
    </div>
    <div class="hints">
      <span><kbd>⌘N</kbd>{t('nav.welcome.hintNew')}</span>
      <span><kbd>⌘K</kbd>{t('nav.welcome.hintSearch')}</span>
      <span><kbd>⌘E</kbd>{t('nav.welcome.hintEnv')}</span>
      <span><kbd>⌘⇧T</kbd>{t('nav.welcome.hintReopen')}</span>
    </div>
  </section>
{/if}

<style>
  /* Main panel with no open tabs: S01 (new workspace) and S02 (continue where you left off). */
  :global(.bs) .bs-welcome {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 0 24px 40px;
    overflow: auto;
    text-align: center;
  }

  :global(.bs) .bs-welcome :global(.eyebrow) {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }

  :global(.bs) .bs-welcome :global(h1) {
    margin: 0;
    color: var(--color-text);
    font: 600 30px/36px var(--font-ui);
    letter-spacing: -0.8px;
  }

  :global(.bs) .bs-welcome :global(p) {
    margin: 0;
    color: var(--color-text-secondary);
    font: 14px/17px var(--font-ui);
  }

  :global(.bs) .bs-welcome :global(.actions) {
    display: flex;
    gap: 8px;
    padding-top: 4px;
  }

  :global(.bs) .bs-welcome :global(.actions button) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-welcome :global(.actions .primary) {
    background: var(--color-action);
    color: var(--color-on-action);
    font-weight: 600;
  }

  :global(.bs) .bs-welcome :global(.actions .primary:hover) {
    background: var(--color-action-hover, var(--primary-hover));
  }

  :global(.bs) .bs-welcome :global(.actions .primary .material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-welcome :global(.actions .primary kbd) {
    color: var(--color-on-action);
    font: var(--font-size-micro) var(--font-code);
    opacity: 1;
  }

  :global(.bs .bs-welcome .actions) .secondary {
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    background: var(--color-panel);
    color: var(--color-text);
  }

  :global(.bs .bs-welcome .actions) .secondary:hover {
    background: var(--color-selected);
  }

  :global(.bs) .bs-welcome :global(.paste) {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 520px;
    max-width: 100%;
    height: 48px;
    padding: 0 8px 0 18px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-welcome :global(.paste:focus-within) {
    outline-color: var(--color-border);
  }

  :global(.bs) .bs-welcome :global(.paste .material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .bs-welcome :global(.paste input) {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-welcome :global(.paste input:focus) {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }

  :global(.bs) .bs-welcome :global(.paste input::placeholder) {
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-welcome :global(kbd) {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-code);
    opacity: 1;
  }

  :global(.bs) .bs-welcome :global(.actions kbd) {
    height: auto;
    padding: 0;
    background: none;
  }

  :global(.bs) .bs-welcome :global(.sources) {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
  }

  :global(.bs) .bs-welcome :global(.sources .lbl) {
    margin-right: 0;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-welcome :global(.sources button) {
    height: 22px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-welcome :global(.sources button:hover) {
    color: var(--color-text);
  }

  :global(.bs) .bs-no-tabs {
    gap: 24px;
  }

  :global(.bs) .bs-no-tabs :global(.eyebrow) {
    margin-bottom: -16px;
  }

  :global(.bs) .bs-no-tabs :global(h1) {
    font: 600 24px/29px var(--font-ui);
    letter-spacing: -0.5px;
  }

  :global(.bs) .bs-no-tabs :global(.recent) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 520px;
    max-width: 100%;
    padding: 6px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
    text-align: left;
  }

  :global(.bs) .bs-no-tabs :global(.recent .lbl) {
    height: 27px;
    padding: 8px 12px 6px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(.bs) .bs-no-tabs :global(.row) {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    text-align: left;
  }

  :global(.bs) .bs-no-tabs :global(.row.on) {
    background: var(--color-selected);
  }

  :global(.bs) .bs-no-tabs :global(.row:hover) {
    background: var(--color-selected);
  }

  :global(.bs) .bs-no-tabs :global(.row .m) {
    flex: 0 0 46px;
    font: 600 var(--font-size-micro) var(--font-code);
    letter-spacing: 0.4px;
  }

  :global(.bs) .bs-no-tabs :global(.row .name) {
    flex: none;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 500 13px var(--font-ui);
  }

  :global(.bs) .bs-no-tabs :global(.row .folder) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-no-tabs :global(.row .st) {
    color: var(--color-success);
    font: 600 var(--font-size-micro) var(--font-code);
  }

  :global(.bs) .bs-no-tabs :global(.row .st.err) {
    color: var(--color-danger);
  }

  :global(.bs) .bs-no-tabs :global(.row .when) {
    flex: 0 0 44px;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    text-align: right;
  }

  :global(.bs) .bs-no-tabs .hints {
    display: flex;
    gap: 18px;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-no-tabs .hints :global(span) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
</style>
