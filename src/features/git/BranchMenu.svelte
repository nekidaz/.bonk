<script lang="ts">
  /**
   * G3: the branch popover, opened from the status-bar branch chip or the sidebar branch row
   * (`git.branchMenu` holds its anchor). Search, local branches with ahead/behind, remote branches
   * not checked out yet, «New branch from …», and Pull / Push.
   */
  import { GitBranchIcon } from '$shared/ui/components';
  import { untrack } from 'svelte';
  import { workspace } from '$entities/workspace';
  import { createBranch, git, pull, push, requestCheckout } from '$entities/git';
  import { gitBranchList } from '$shared/ipc';
  import type { GitBranch } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import { requestConfirm } from '$shared/ui';

  let branches = $state.raw<GitBranch[]>([]);
  let query = $state('');
  let input = $state<HTMLInputElement>();

  const at = $derived(git.branchMenu);
  const current = $derived(git.status?.branch ?? '');
  const q = $derived(query.trim().toLowerCase());
  const tracked = $derived(new Set(branches.map((b) => b.upstream).filter(Boolean)));
  const locals = $derived(branches.filter((b) => !b.remote && b.name.toLowerCase().includes(q)));
  const remotes = $derived(
    branches.filter((b) => b.remote && !tracked.has(b.name) && b.name.toLowerCase().includes(q)),
  );
  const remoteName = $derived(remotes[0]?.name.split('/')[0] ?? 'origin');
  // Diverged (after a rebase / amend of pushed commits): a plain push is refused, so offer the lease.
  const diverged = $derived(!!git.status?.ahead && !!git.status?.behind);

  async function pushNow(): Promise<void> {
    close();
    if (!diverged) return void push();
    const n = git.status?.behind ?? 0;
    const ok = await requestConfirm(
      t('git.branch.forceConfirm', {
        upstream: git.status?.upstream ?? remoteName,
        n: `${n} ${tp(n, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits'])}`,
      }),
      'Force push',
    );
    if (ok) void push(true);
  }

  $effect(() => {
    if (!at) return;
    untrack(() => {
      query = '';
      void load();
      requestAnimationFrame(() => input?.focus());
    });
  });

  async function load(): Promise<void> {
    const root = workspace.path;
    if (!root) return;
    try {
      branches = await gitBranchList(root);
    } catch (err) {
      git.error = String(err);
      branches = [];
    }
  }

  const close = () => (git.branchMenu = null);

  function pick(b: GitBranch): void {
    close();
    void requestCheckout(b.name, b.remote);
  }

  function create(): void {
    const name = query.trim();
    if (!name) {
      input?.focus();
      return;
    }
    close();
    void createBranch(name);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = [...locals, ...remotes].find((b) => b.name.toLowerCase() === q);
      const first = exact ?? (locals.length + remotes.length === 1 ? (locals[0] ?? remotes[0]) : undefined);
      if (first) pick(first);
      else create();
    }
  }

  const track = (b: GitBranch) => `${b.behind ? `↓${b.behind}` : ''} ${b.ahead ? `↑${b.ahead}` : ''}`.trim();
</script>

{#if at}
  <!-- A transparent layer closes the popover on a click outside it (a window pointerdown
       misjudges clicks in the Tauri webview). -->
  <div class="bs-gitlayer" role="presentation" onpointerdown={close}></div>
  <div
    class="bs-branchmenu"
    role="dialog"
    aria-label={t('git.branch.switch')}
    style:left="{at.x}px"
    style:top={at.up ? undefined : `${at.y}px`}
    style:bottom={at.up ? `${window.innerHeight - at.y}px` : undefined}
  >
    <label class="search">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <input
        bind:this={input}
        bind:value={query}
        placeholder={t('git.branch.search')}
        aria-label={t('git.branch.search')}
        onkeydown={onKey}
      />
    </label>
    <div class="list">
      {#if locals.length}
        <div class="eyebrow">{t('git.branch.local')}</div>
        {#each locals as b (b.name)}
          <button class="item" class:cur={b.name === current} onclick={() => pick(b)}>
            {#if b.name === current}<span class="material-symbols-outlined" aria-hidden="true">check</span>{:else}<span
                class="ic"><GitBranchIcon size={14} /></span
              >{/if}
            <span class="nm">{b.name}</span>
            <span class="tr">{track(b)}</span>
          </button>
        {/each}
      {/if}
      {#if remotes.length}
        <div class="eyebrow">{`${t('git.branch.remote')}  ·  ${remoteName}`}</div>
        {#each remotes as b (b.name)}
          <button class="item" onclick={() => pick(b)}>
            <span class="material-symbols-outlined" aria-hidden="true">cloud</span>
            <span class="nm">{b.name}</span>
          </button>
        {/each}
      {/if}
      {#if !locals.length && !remotes.length && q}
        <div class="none">{t('git.branch.none')}</div>
      {/if}
    </div>
    <button class="item new" onclick={create}>
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
      <span class="nm"
        >{query.trim() ? t('git.branch.newNamed', { name: query.trim() }) : t('git.branch.new')}
        <span class="from">{t('git.branch.from', { branch: current || 'HEAD' })}</span></span
      >
    </button>
    <div class="sync">
      <button
        class="bs-gbtn"
        disabled={git.busy}
        onclick={() => {
          close();
          void pull();
        }}
        ><span class="material-symbols-outlined">arrow_downward</span>Pull{#if git.status?.behind}<span class="n"
            >{git.status.behind}</span
          >{/if}</button
      >
      <button
        class="bs-gbtn"
        disabled={git.busy}
        title={diverged ? 'git push --force-with-lease' : undefined}
        onclick={pushNow}
        ><span class="material-symbols-outlined">arrow_upward</span>{diverged
          ? 'Force push'
          : 'Push'}{#if git.status?.ahead}<span class="n">{git.status.ahead}</span>{/if}</button
      >
    </div>
  </div>
{/if}

<style>
  .bs-branchmenu {
    position: fixed;
    z-index: 60;
    width: 320px;
    max-height: min(560px, 80vh);
    display: flex;
    flex-direction: column;
    padding: 6px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 18px 48px var(--color-shadow);
  }
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }
  .search .material-symbols-outlined {
    font-size: 16px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0;
  }
  .eyebrow {
    padding: 12px 12px 6px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
    text-align: left;
  }
  .item:hover {
    background: var(--color-hover);
  }
  .item .ic {
    display: inline-flex;
    width: 15px;
    justify-content: center;
    color: var(--color-text-muted);
  }
  .item .material-symbols-outlined {
    font-size: 15px;
    color: var(--color-text-muted);
  }
  .item.cur .material-symbols-outlined {
    color: var(--color-text);
  }
  .item.cur .nm {
    font-weight: 600;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tr {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .new {
    flex: none;
    margin-top: 2px;
    border-top: 1px solid var(--color-border-subtle);
    border-radius: 0;
    height: 40px;
    font-family: var(--font-ui);
  }
  .from {
    color: var(--color-text-muted);
  }
  .none {
    padding: 10px 12px;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
  }
  .sync {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 4px 4px 2px;
  }
  .sync .bs-gbtn {
    height: 34px;
    background: var(--color-field);
  }
  .sync .n {
    color: var(--color-text-muted);
    font-weight: 400;
  }
</style>
