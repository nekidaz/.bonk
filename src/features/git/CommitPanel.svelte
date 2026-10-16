<script lang="ts">
  /**
   * G5 / G6: details of the selected commit(s) beside the graph — message, author, date, parent or
   * range, branches, the requests it changed (each opens its diff at that commit), and actions:
   * Checkout / Branch for one commit, Cherry-pick / Revert for several, ⋯ for the full menu.
   */
  import { findNode, workspace } from '$entities/workspace';
  import { describeFile, git, openGitDiffTab, statusColor } from '$entities/git';
  import { methodColor, type CommitDetail, type GraphCommit } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import { GitBranchIcon } from '$shared/ui/components';
  import { commitDate, commitDateTime, initials, joinSubjects, type CommitAction } from './graph';
  import { GitButton } from '$entities/git/components';

  let {
    commits,
    details,
    onAction,
    onMenu,
  }: {
    /** The selection, newest first. */
    commits: GraphCommit[];
    details: Record<string, CommitDetail>;
    onAction: (a: CommitAction) => void;
    onMenu: (e: MouseEvent) => void;
  } = $props();

  const now = $derived.by(() => (void git.version, Date.now()));
  const one = $derived(commits.length === 1);
  const d = $derived(one ? details[commits[0].hash] : undefined);
  const loaded = $derived(commits.map((c) => details[c.hash]).filter((x): x is CommitDetail => !!x));
  // Until the details arrive the count would read «0 changed»; GraphView fetches at most 30.
  const ready = $derived(loaded.length >= Math.min(commits.length, 30));
  const current = $derived(git.status?.branch ?? '');

  // Changed files of the whole selection: summed counts, the newest commit's status and hash.
  const files = $derived.by(() => {
    const byPath = new Map<
      string,
      { path: string; status: string; additions: number; deletions: number; rev: string }
    >();
    for (const det of [...loaded].reverse()) {
      for (const f of det.files) {
        const prev = byPath.get(f.path);
        byPath.set(f.path, {
          ...f,
          additions: (prev?.additions ?? 0) + f.additions,
          deletions: (prev?.deletions ?? 0) + f.deletions,
          rev: det.hash,
        });
      }
    }
    return [...byPath.values()];
  });
  const plus = $derived(files.reduce((n, f) => n + f.additions, 0));
  const minus = $derived(files.reduce((n, f) => n + f.deletions, 0));
  const branches = $derived(
    loaded.length
      ? loaded.slice(1).reduce((acc, x) => acc.filter((b) => x.branches.includes(b)), loaded[0].branches)
      : [],
  );
  const authors = $derived([...new Set(commits.map((c) => c.author))].join(', '));
  const info = (path: string) => describeFile(path, git.prefix, (id) => findNode(workspace.tree, id));
</script>

<aside class="bs-commitpanel">
  <div class="top">
    <div class="eb">
      <span
        >{one
          ? `${t('git.graph.commit')}  ·  ${commits[0].short}`
          : `${t('git.graph.selected')}  ·  ${commits.length} ${tp(commits.length, ['commit', 'commits'])}`}</span
      >
      <button class="ico" title={t('git.graph.copy')} onclick={() => onAction({ kind: 'copy' })}
        ><span class="material-symbols-outlined">content_copy</span></button
      >
    </div>
    <h3>{one ? commits[0].subject : joinSubjects(commits.map((c) => c.subject))}</h3>
    {#if one && d?.body}
      <p class="body">{d.body}</p>
    {:else if !one}
      <p class="body">
        {t('git.graph.multiHint', {
          n: commits.length,
          commits: tp(commits.length, ['commit', 'commits']),
          branch: current || 'HEAD',
        })}
      </p>
    {/if}
  </div>

  <dl class="meta">
    <dt>{t('git.graph.author')}</dt>
    <dd>
      {#if one}<span class="av">{initials(commits[0].author)}</span>{/if}<span title={one ? commits[0].email : ''}
        >{authors}</span
      >
    </dd>
    <dt>{t('git.graph.date')}</dt>
    <dd>
      {one
        ? commitDateTime(commits[0].time, now)
        : `${commitDate(commits.at(-1)!.time, now)} — ${commitDate(commits[0].time, now)}`}
    </dd>
    {#if one}
      <dt>{commits[0].parents.length > 1 ? t('git.graph.parents') : t('git.graph.parent')}</dt>
      <dd class="mono">{commits[0].parents.map((p) => p.slice(0, 7)).join(', ') || '—'}</dd>
    {:else}
      <dt>{t('git.graph.range')}</dt>
      <dd class="mono">{`${commits.at(-1)!.short}..${commits[0].short}`}</dd>
    {/if}
    {#if branches.length}
      <dt>{t('git.graph.branches')}</dt>
      <dd class="pills">
        {#each branches.slice(0, 4) as b (b)}
          <span class="pill"><GitBranchIcon size={11} />{b}</span>
        {/each}
        {#if branches.length > 4}<span class="more">+{branches.length - 4}</span>{/if}
      </dd>
    {/if}
  </dl>

  <div class="files">
    <div class="eb">
      <span>{ready ? `${t('git.graph.changed')}  ·  ${files.length}` : t('git.graph.changed')}</span>
      {#if ready}<span class="stat"><i class="plus">+{plus}</i> <i class="minus">-{minus}</i></span>{/if}
    </div>
    {#each files as f (f.path)}
      {@const i = info(f.path)}
      <button class="row" title={f.path} onclick={() => openGitDiffTab(f.path, 'working', i.name, f.rev)}>
        <span class="m" style:color={i.method ? methodColor(i.method === 'gRPC' ? 'GRPC' : i.method) : undefined}
          >{i.method}</span
        >
        <span class="nm">{i.name}</span>
        <span class="material-symbols-outlined open">north_east</span>
        <span class="st" style:color={statusColor(f.status)}>{f.status}</span>
      </button>
    {/each}
  </div>

  <div class="foot">
    {#if one}
      <GitButton class="inv" onclick={() => onAction({ kind: 'checkout' })}
        ><span class="material-symbols-outlined">login</span>{t('git.graph.checkout')}</GitButton
      >
      <GitButton onclick={() => onAction({ kind: 'branch' })}
        ><GitBranchIcon size={15} />{t('git.graph.newBranch')}</GitButton
      >
    {:else}
      <GitButton class="inv" disabled={!current} onclick={() => onAction({ kind: 'cherry-pick' })}
        ><span class="material-symbols-outlined">commit</span>{`Cherry-pick ${commits.length}`}</GitButton
      >
      {#if commits.length === 2}
        <GitButton onclick={() => onAction({ kind: 'compare' })}
          ><span class="material-symbols-outlined">compare_arrows</span>{t('git.compare.action')}</GitButton
        >
      {:else}
        <GitButton onclick={() => onAction({ kind: 'revert' })}
          ><span class="material-symbols-outlined">undo</span>Revert</GitButton
        >
      {/if}
    {/if}
    <GitButton class="more" title={t('git.graph.actions')} aria-label={t('git.graph.actions')} onclick={onMenu}
      ><span class="material-symbols-outlined">more_horiz</span></GitButton
    >
  </div>
</aside>

<style>
  .bs-commitpanel {
    flex: none;
    width: 330px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .top {
    padding: 16px 18px 14px;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .eb {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  h3 {
    margin: 8px 0 0;
    color: var(--color-text);
    font: 600 var(--font-size-title) / 1.35 var(--font-ui);
  }
  .body {
    margin: 8px 0 0;
    max-height: 120px;
    overflow: auto;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .ico {
    display: inline-flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--color-text-muted);
  }
  .ico:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .ico .material-symbols-outlined {
    font-size: 14px;
  }
  .meta {
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr);
    gap: 10px 8px;
    margin: 0;
    padding: 14px 18px;
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: var(--font-size-body);
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin: 0;
    color: var(--color-text);
  }
  dd > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-family: var(--font-code);
  }
  .av {
    flex: none;
    display: inline-flex;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-selected);
    color: var(--color-text-secondary);
    font: 600 8.5px var(--font-ui);
  }
  .pills {
    flex-wrap: wrap;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .files {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 10px;
  }
  .files .eb {
    padding: 0 8px 8px;
  }
  .stat {
    letter-spacing: 0;
    font-size: var(--font-size-caption);
  }
  .plus {
    color: var(--color-success);
    font-style: normal;
  }
  .minus {
    color: var(--color-danger);
    font-style: normal;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    text-align: left;
  }
  .row:hover {
    background: var(--color-hover);
  }
  .m {
    flex: none;
    width: 36px;
    font: 700 10px var(--font-code);
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-ui);
  }
  .open {
    display: none;
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .row:hover .open {
    display: inline;
  }
  .st {
    flex: none;
    width: 10px;
    font: 700 var(--font-size-micro) var(--font-code);
  }
  .foot {
    flex: none;
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--color-border-subtle);
  }
  :global(:root .foot .bs-gbtn) {
    flex: 1;
    height: 34px;
  }
  .foot :global(.more) {
    flex: none;
    width: 34px;
    padding: 0;
  }
</style>
