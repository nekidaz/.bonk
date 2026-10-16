<script lang="ts">
  // Flow · Issues (CT7–CT12): failures folded by cause / request / host; the counters on top are
  // filters; one host behind many failures gets a banner; ⇧⌘J adds facets on the left.
  import { t } from '$shared/i18n';
  import { appConsole } from '$entities/request';
  import { timeAgo } from '$entities/environment';
  import { openEntry, retryEntry } from './actions';
  import { utilityUi } from './store.svelte';
  import {
    countByKind,
    facetCounts,
    filterFacets,
    groupIssues,
    ISSUE_KINDS,
    issueHint,
    issueReport,
    matchesIssueFilter,
    nOf,
    outage,
    sparkline,
    type IssueFacet,
    type IssueGroup,
    type IssueGroupBy,
    type IssueKind,
  } from './issues';
  import { formatElapsed } from './utilPanel';
  import { Spacer } from '$shared/ui/components';

  const HOUR = 3_600_000;
  const FACETS: IssueFacet[] = ['host', 'env', 'collection', 'time'];
  const GROUP_BY: IssueGroupBy[] = ['cause', 'request', 'host'];

  let now = $state(Date.now());
  let copiedKey = $state<string | null>(null);

  // Everything open, then “Hide older than an hour”, facets (CT12) and the text filter.
  const base = $derived(
    utilityUi.issues.filter(
      (x) => (!utilityUi.hideOld || now - x.entry.at < HOUR) && matchesIssueFilter(x, utilityUi.issuesFilter),
    ),
  );
  const faceted = $derived(utilityUi.expanded ? filterFacets(base, utilityUi.facets, now) : base);
  const counts = $derived(countByKind(faceted));
  const shown = $derived(
    utilityUi.issuesKind === 'all' ? faceted : faceted.filter((x) => x.kind === utilityUi.issuesKind),
  );
  const groups = $derived(groupIssues(shown, utilityUi.groupBy, utilityUi.sort));
  const facets = $derived(facetCounts(base, utilityUi.facets, now));
  const facetsOn = $derived(Object.values(utilityUi.facets).filter(Boolean) as string[]);
  const down = $derived(outage(shown, appConsole.entries));

  const tone = (k: IssueKind) => (k === '4xx' ? 'warn' : 'err');
  const time = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const facetLabel = (f: IssueFacet, v: string) => (f === 'time' ? t(`issues.time.${v}`) : v);

  function toggleFacet(f: IssueFacet, v: string): void {
    utilityUi.facets = { ...utilityUi.facets, [f]: utilityUi.facets[f] === v ? undefined : v };
  }

  async function copyReport(g: IssueGroup): Promise<void> {
    await navigator.clipboard.writeText(issueReport(g)).catch(() => {});
    copiedKey = g.key;
    setTimeout(() => (copiedKey = null), 1200);
  }

  // “2 min ago” keeps up while the tab is open.
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
</script>

<div class="bs-issues-bar">
  <button
    type="button"
    class="bs-chip"
    class:on={utilityUi.issuesKind === 'all'}
    onclick={() => (utilityUi.issuesKind = 'all')}
    >{t('issues.kind.all')} <span class="n">{faceted.length}</span></button
  >
  {#each ISSUE_KINDS as k (k)}
    <button
      type="button"
      class="bs-chip"
      class:on={utilityUi.issuesKind === k}
      aria-pressed={utilityUi.issuesKind === k}
      onclick={() => (utilityUi.issuesKind = utilityUi.issuesKind === k ? 'all' : k)}
      ><span class="dot {tone(k)}"></span>{t(`issues.kind.${k}`)} <span class="n">{counts[k]}</span></button
    >
  {/each}
  <Spacer />
  <div class="bs-issues-by" role="radiogroup" aria-label={t('issues.groupBy')}>
    <span>{t('issues.by')}</span>
    {#each GROUP_BY as g (g)}
      <button
        type="button"
        role="radio"
        aria-checked={utilityUi.groupBy === g}
        class:on={utilityUi.groupBy === g}
        onclick={() => (utilityUi.groupBy = g)}>{t(`issues.by.${g}`)}</button
      >
    {/each}
  </div>
  <button
    type="button"
    class="bs-issues-sort"
    onclick={() => (utilityUi.sort = utilityUi.sort === 'count' ? 'recent' : 'count')}
    ><span class="material-symbols-outlined" aria-hidden="true">sort</span>{t(`issues.sort.${utilityUi.sort}`)}</button
  >
</div>

{#if down}
  <div class="bs-issues-banner">
    <span class="material-symbols-outlined" aria-hidden="true">wifi_off</span>
    <div>
      <b
        >{t('issues.outage.title', {
          host: down.host,
          requests: nOf.requests(down.count),
          minutes: nOf.minutes(down.minutes),
        })}</b
      >
      <div>
        {t('issues.outage.text')}{down.lastOkAt ? ` ${t('issues.outage.lastOk', { time: time(down.lastOkAt) })}` : ''}
      </div>
    </div>
    <button
      type="button"
      onclick={() => {
        const last = shown.findLast((x) => x.host === down.host);
        if (last) void retryEntry(last.entry);
      }}
      ><span class="material-symbols-outlined" aria-hidden="true">network_check</span>{t('issues.outage.check')}</button
    >
  </div>
{/if}

<div class="bs-issues-main" class:expanded={utilityUi.expanded}>
  {#if utilityUi.expanded}
    <aside class="bs-issues-facets" aria-label={t('issues.facets')}>
      {#each FACETS as f (f)}
        {#if facets[f].length}
          <h4>{t(`issues.facet.${f}`)}</h4>
          {#each facets[f] as v (v.value)}
            <label class:on={utilityUi.facets[f] === v.value}>
              <input
                type="checkbox"
                checked={utilityUi.facets[f] === v.value}
                onchange={() => toggleFacet(f, v.value)}
              />
              <span class="v" class:mono={f === 'host'}>{facetLabel(f, v.value)}</span>
              <span class="n">{v.count}</span>
            </label>
          {/each}
        {/if}
      {/each}
    </aside>
  {/if}

  <div class="bs-issues-list" role="list">
    {#if utilityUi.expanded}
      <div class="bs-issues-result">
        {nOf.groups(groups.length)} · {nOf.requests(shown.length)}{#if facetsOn.length}<span class="on"
            >· {facetsOn.map((v) => (v === 'hour' || v === 'today' ? t(`issues.time.${v}`) : v)).join(' · ')}</span
          >{/if}
        <Spacer />
        {#if facetsOn.length}<button type="button" onclick={() => (utilityUi.facets = {})}>{t('util.reset')}</button
          >{/if}
      </div>
    {/if}
    {#if groups.length === 0}
      <div class="bs-utility-empty">
        <span class="material-symbols-outlined">check_circle</span>
        <div>{t('util.empty.issues')}</div>
      </div>
    {/if}
    {#each groups as g (g.key)}
      {@const open = utilityUi.openGroup === g.key}
      {@const spark = sparkline(g.issues, now)}
      {@const peak = Math.max(1, ...spark)}
      <div class="bs-issue" class:open role="listitem">
        <button
          type="button"
          class="bs-issue-row"
          aria-expanded={open}
          onclick={() => (utilityUi.openGroup = open ? null : g.key)}
        >
          <span class="icon {tone(g.kind)}"><span class="material-symbols-outlined">{g.icon}</span></span>
          <span class="title" class:mono={utilityUi.groupBy !== 'cause'}>{t(g.title, { name: g.arg ?? '' })}</span>
          {#each g.codes as c (c)}<span class="code {tone(g.kind)}">{c}</span>{/each}
          <span class="detail">{g.detail}</span>
          <span class="spark {tone(g.kind)}" aria-hidden="true"
            >{#each spark as v, i (i)}<i style:height="{v ? 3 + (v / peak) * 11 : 1}px"></i>{/each}</span
          >
          <span class="count">×{g.count}</span>
          <span class="ago">{timeAgo(g.lastAt, now)}</span>
          <span class="material-symbols-outlined chevron" aria-hidden="true"
            >{open ? 'expand_less' : 'expand_more'}</span
          >
        </button>
        {#if open}
          {#if utilityUi.groupBy === 'host'}
            {#each g.children as c (c.key)}
              <div class="bs-issue-child"><span>{c.label}</span><span class="count">×{c.count}</span></div>
            {/each}
          {:else}
            {@const hint = issueHint(g.issues[0])}
            <div class="bs-issue-occ">
              {#each g.issues.slice(0, 20) as x, i (i)}
                <div>
                  <time>{time(x.entry.at)}</time>
                  <span class="msg {tone(x.kind)}">{x.detail || x.entry.status}</span>
                  <span class="env">{x.entry.env ?? ''}</span>
                  <span class="ms">{formatElapsed(x.entry.elapsedMs)}</span>
                </div>
              {/each}
            </div>
            <div class="bs-issue-hint">
              <span class="material-symbols-outlined" aria-hidden="true">lightbulb</span>
              <div>
                <div>{t(hint.title)}</div>
                <div class="text">{t(hint.text, hint.params)}</div>
              </div>
            </div>
            <div class="bs-issue-actions">
              <button
                type="button"
                disabled={!g.issues[0].entry.tabId && !g.issues[0].entry.nodeId}
                onclick={() => openEntry(g.issues[0].entry)}
                ><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>{t(
                  'util.act.open',
                )}</button
              >
              <button
                type="button"
                disabled={!g.issues[0].entry.tabId && !g.issues[0].entry.nodeId}
                onclick={() => void retryEntry(g.issues[0].entry)}
                ><span class="material-symbols-outlined" aria-hidden="true">replay</span>{t('util.act.retry')}</button
              >
              <button type="button" onclick={() => void copyReport(g)}
                ><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>{copiedKey === g.key
                  ? t('util.act.copied')
                  : t('issues.act.report')}</button
              >
              <button type="button" onclick={() => utilityUi.mute([...new Set(g.issues.map((x) => x.cause))])}
                ><span class="material-symbols-outlined" aria-hidden="true">notifications_off</span>{t(
                  'issues.act.mute',
                )}</button
              >
            </div>
          {/if}
        {/if}
      </div>
    {/each}
    {#if groups.length}
      <div class="bs-issues-foot">
        <span>{t('issues.note')}</span>
        <Spacer />
        <button type="button" class:on={utilityUi.hideOld} onclick={() => (utilityUi.hideOld = !utilityUi.hideOld)}
          >{t(utilityUi.hideOld ? 'issues.showOld' : 'issues.hideOld')}</button
        >
        <button type="button" onclick={() => (utilityUi.clearedAt = Date.now())}>{t('issues.clearAll')}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .bs-issues-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px 4px;
    font-size: 11.5px;
  }
  .bs-issues-bar .n {
    margin-left: 3px;
    color: var(--t3);
    font-family: var(--mono);
    font-size: 10.5px;
  }
  .dot {
    width: 6px;
    height: 6px;
    margin-right: 5px;
    border-radius: 50%;
    background: var(--red);
  }
  .dot.warn {
    background: var(--orange);
  }
  .bs-issues-by {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-control);
    background: var(--inset);
    color: var(--t3);
  }
  .bs-issues-by > span {
    padding: 0 4px 0 6px;
  }
  .bs-issues-by button {
    height: 20px;
    padding: 0 9px;
    border-radius: var(--radius-control);
    color: var(--t2);
  }
  .bs-issues-by button.on {
    color: var(--text);
    background: var(--hover2);
    font-weight: 600;
  }
  .bs-issues-sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    margin-left: 6px;
    padding: 0 6px;
    color: var(--t2);
    border-radius: var(--radius-control);
  }
  .bs-issues-sort:hover {
    color: var(--text);
    background: var(--hover);
  }
  .bs-issues-sort .material-symbols-outlined {
    font-size: 14px;
  }
  .bs-issues-banner {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 10px;
    padding: 9px 12px;
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--red) 13%, transparent);
    font-size: 12px;
    line-height: 1.45;
  }
  .bs-issues-banner > .material-symbols-outlined {
    color: var(--red);
    font-size: 18px;
  }
  .bs-issues-banner > div {
    min-width: 0;
    flex: 1;
  }
  .bs-issues-banner > div > div {
    color: var(--t2);
  }
  .bs-issues-banner button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 14px;
    border-radius: 999px;
    color: var(--text);
    background: var(--surface);
  }
  .bs-issues-banner button .material-symbols-outlined {
    font-size: 15px;
  }
  .bs-issues-main {
    min-height: 0;
    flex: 1;
    display: flex;
  }
  .bs-issues-facets {
    flex: 0 0 214px;
    overflow: auto;
    margin: 4px 0 8px 10px;
    padding: 8px;
    border-radius: var(--radius-card);
    background: var(--inset);
    font-size: 12px;
  }
  .bs-issues-facets h4 {
    margin: 12px 6px 4px;
    color: var(--t3);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .bs-issues-facets h4:first-child {
    margin-top: 2px;
  }
  .bs-issues-facets label {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    color: var(--t2);
    cursor: pointer;
  }
  .bs-issues-facets input {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: var(--text);
  }
  .bs-issues-facets label.on {
    color: var(--text);
    background: var(--hover);
  }
  .bs-issues-facets .v {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-issues-facets .n {
    color: var(--t3);
    font-family: var(--mono);
    font-size: 10.5px;
  }
  .mono {
    font-family: var(--mono);
  }
  .bs-issues-list {
    min-width: 0;
    flex: 1;
    overflow: auto;
    padding: 2px 8px 8px;
    scrollbar-gutter: stable;
  }
  .bs-issues-result {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    color: var(--t3);
    font-size: 11.5px;
  }
  .bs-issues-result .on {
    color: var(--t2);
  }
  .bs-issues-result button {
    color: var(--t2);
  }
  .bs-issue {
    border: 1px solid transparent;
    border-radius: var(--radius-card);
  }
  .bs-issue.open {
    padding-bottom: 8px;
    border-color: var(--sepsoft);
    background: color-mix(in srgb, var(--hover) 50%, transparent);
  }
  .bs-issue-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-card);
    color: var(--text);
    font-size: 12.5px;
    text-align: left;
  }
  .bs-issue-row:hover {
    background: var(--hover);
  }
  .bs-issue-row .icon {
    width: 20px;
    height: 20px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
  }
  .bs-issue-row .icon.warn {
    color: var(--orange);
    background: color-mix(in srgb, var(--orange) 14%, transparent);
  }
  .bs-issue-row .icon .material-symbols-outlined {
    font-size: 13px;
  }
  .bs-issue-row .title {
    flex: none;
    white-space: nowrap;
  }
  .code {
    flex: none;
    height: 16px;
    padding: 0 6px;
    border-radius: var(--radius-xs);
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    white-space: nowrap;
  }
  .code.warn {
    color: var(--orange);
    background: color-mix(in srgb, var(--orange) 14%, transparent);
  }
  .bs-issue-row .detail {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--t3);
    font-family: var(--mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spark {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
    margin-left: 8px;
  }
  .spark i {
    width: 2px;
    background: var(--red);
    border-radius: 1px;
  }
  .spark.warn i {
    background: var(--orange);
  }
  .count {
    flex: none;
    min-width: 30px;
    padding: 0 6px;
    border-radius: 999px;
    color: var(--t2);
    background: var(--hover);
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 18px;
    text-align: center;
  }
  .ago {
    flex: none;
    width: 76px;
    color: var(--t3);
    font-size: 11.5px;
    text-align: right;
  }
  .chevron {
    flex: none;
    color: var(--t3);
    font-size: 15px;
  }
  .bs-issue-child {
    display: flex;
    justify-content: space-between;
    padding: 5px 120px 5px 36px;
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .bs-issue-child .count {
    background: none;
    color: var(--t3);
  }
  .bs-issue-occ {
    padding: 4px 34px 6px 36px;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.7;
  }
  .bs-issue-occ > div {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr) auto 50px;
    gap: 8px;
  }
  .bs-issue-occ time,
  .bs-issue-occ .ms {
    color: var(--t3);
  }
  .bs-issue-occ .ms {
    text-align: right;
  }
  .bs-issue-occ .env {
    color: var(--t2);
    font-family: var(--font-ui);
  }
  .bs-issue-occ .msg {
    overflow: hidden;
    color: var(--red);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-issue-occ .msg.warn {
    color: var(--orange);
  }
  .bs-issue-hint {
    display: flex;
    gap: 10px;
    margin: 2px 8px 8px 36px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--inset);
    font-size: 12px;
    line-height: 1.5;
  }
  .bs-issue-hint .material-symbols-outlined {
    color: var(--orange);
    font-size: 15px;
  }
  .bs-issue-hint .text {
    color: var(--t2);
  }
  .bs-issue-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: 36px;
  }
  .bs-issue-actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    color: var(--t2);
    border-radius: var(--radius-control);
    font-size: 12px;
  }
  .bs-issue-actions button:first-child {
    color: var(--text);
    background: var(--hover);
  }
  .bs-issue-actions button:hover:not(:disabled) {
    color: var(--text);
    background: var(--hover2);
  }
  .bs-issue-actions button:disabled {
    opacity: 0.45;
  }
  .bs-issue-actions .material-symbols-outlined {
    font-size: 15px;
  }
  .bs-issues-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 10px 2px;
    color: var(--t3);
    font-size: 11.5px;
  }
  .bs-issues-foot button {
    color: var(--t2);
    white-space: nowrap;
  }
  .bs-issues-foot button:hover,
  .bs-issues-foot button.on {
    color: var(--text);
  }
</style>
