<script lang="ts">
  import { workspace } from '$entities/workspace';
  import { history, openHistoryEntry } from '$entities/history';
  import { methodColor } from '$shared/model';
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
  const recent = $derived(recentRequests($history, workspace.tree));
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
          <span class="m" style="color:{methodColor(r.method === 'gRPC' ? 'GRPC' : r.method)}">{r.method}</span>
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
