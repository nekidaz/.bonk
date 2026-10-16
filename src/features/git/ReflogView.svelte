<script lang="ts">
  /**
   * HEAD's reflog as a tab: everywhere HEAD has been (commits, checkouts, resets, rebases), newest
   * first. The way back to work a reset or a deleted branch lost: check out an old position, put a
   * branch on it, or reset the current branch there.
   */
  import { workspace } from '$entities/workspace';
  import { checkoutCommit, createBranchAt, git, openGraphTab, resetTo, shortAgo } from '$entities/git';
  import { gitReflog } from '$shared/ipc';
  import { requestConfirm } from '$shared/ui';
  import type { ReflogEntry } from '$shared/model';
  import { t } from '$shared/i18n';
  import { GitButton, GitHead, GitView, GitViewBody, GitViewEmpty, GitError } from '$entities/git/components';

  const LIMIT = 300;
  let entries = $state.raw<ReflogEntry[]>([]);
  let loaded = $state(false);
  let error = $state('');
  /** The entry whose «Ветка отсюда» name field is open. */
  let naming = $state(-1);
  let branchName = $state('');

  const now = $derived.by(() => (void git.version, Date.now()));
  const current = $derived(git.status?.branch || 'HEAD');

  $effect(() => {
    const root = workspace.path;
    void git.version;
    if (!root) return;
    void gitReflog(root, LIMIT)
      .then((e) => {
        entries = e;
        error = '';
      })
      .catch((err) => (error = String(err)))
      .finally(() => (loaded = true));
  });

  /** «checkout: moving from a to b» → the verb and the rest, for a coloured verb. */
  function split(action: string): { verb: string; rest: string } {
    const i = action.indexOf(':');
    return i > 0 ? { verb: action.slice(0, i), rest: action.slice(i + 1).trim() } : { verb: '', rest: action };
  }

  async function branchHere(e: ReflogEntry, i: number): Promise<void> {
    // Enter closes the field, and its blur then fires too: only the first one counts.
    if (naming !== i) return;
    const name = branchName.trim();
    naming = -1;
    if (name) await createBranchAt(name, e.hash, false);
  }

  async function resetHere(e: ReflogEntry): Promise<void> {
    if (await requestConfirm(t('git.reflog.resetConfirm', { branch: current, short: e.short }), 'Reset'))
      await resetTo(e.hash, 'mixed');
  }
</script>

<GitView>
  <GitHead>
    <div class="ttl">
      <span class="crumb">{`${t('git.title')}  /  reflog`}</span>
      <div class="row"><h2>Reflog</h2></div>
    </div>
  </GitHead>
  <GitViewBody>
    {#if error}
      <GitError>{error}</GitError>
    {:else if !loaded}
      <GitViewEmpty>{t('git.diff.loading')}</GitViewEmpty>
    {:else if !entries.length}
      <GitViewEmpty>{t('git.reflog.empty')}</GitViewEmpty>
    {:else}
      <p class="hint">{t('git.reflog.hint')}</p>
      <div class="list">
        {#each entries as e, i (i)}
          {@const a = split(e.action)}
          <div class="entry">
            <button class="hash" title={t('git.tab.graph')} onclick={() => openGraphTab(e.hash)}>{e.short}</button>
            <span class="what"><b>{a.verb}</b> {a.rest}</span>
            <span class="when">{shortAgo(e.time, now)}</span>
            {#if naming === i}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="name"
                bind:value={branchName}
                autofocus
                placeholder={t('git.reflog.branchName')}
                aria-label={t('git.reflog.branchName')}
                onkeydown={(ev) => {
                  if (ev.key === 'Enter') void branchHere(e, i);
                  else if (ev.key === 'Escape') naming = -1;
                }}
                onblur={() => branchName.trim() && void branchHere(e, i)}
              />
            {:else}
              <span class="acts">
                <GitButton
                  disabled={git.busy}
                  onclick={() => {
                    branchName = '';
                    naming = i;
                  }}>{t('git.reflog.branch')}</GitButton
                >
                <GitButton disabled={git.busy} onclick={() => checkoutCommit(e.hash)}>Checkout</GitButton>
                <GitButton disabled={git.busy} onclick={() => resetHere(e)}>Reset</GitButton>
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </GitViewBody>
</GitView>

<style>
  .hint {
    margin: 0 20px 10px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 20px 16px;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 10px;
    border-radius: var(--radius-md);
  }
  .entry:hover {
    background: var(--color-hover);
  }
  .hash {
    flex: none;
    color: var(--method-patch);
    font: 500 var(--font-size-body) var(--font-code);
  }
  .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui);
  }
  .what b {
    color: var(--color-text);
    font-weight: 600;
  }
  .when {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
  }
  .acts {
    flex: none;
    display: flex;
    gap: 6px;
    opacity: 0;
  }
  .entry:hover .acts,
  .entry:focus-within .acts {
    opacity: 1;
  }
  .name {
    flex: none;
    width: 200px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    outline: none;
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
</style>
