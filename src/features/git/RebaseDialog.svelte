<script lang="ts">
  /**
   * G9: interactive rebase as in GitKraken — the commits above `onto`, oldest on top. Drag a row by
   * its handle to reorder (pointer events: HTML5 drag & drop never fires in the macOS webview),
   * pick an action per commit (keys P R S F D on a focused row), edit a reword's message in place.
   * A squash / fixup folds into the nearest kept commit above it.
   */
  import { untrack } from 'svelte';
  import { workspace } from '$entities/workspace';
  import { git, rebaseInteractive } from '$entities/git';
  import { gitBranchList, gitRebasePlan } from '$shared/ipc';
  import type { GitBranch, RebasePlan, RebaseVerb } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import { GitBranchIcon } from '$shared/ui/components';
  import { foldTarget, rebasePlanError } from './rebasePlan';

  let { onto: initialOnto, onClose }: { onto: string; onClose: () => void } = $props();

  type Step = { hash: string; short: string; subject: string; pushed: boolean; action: RebaseVerb; message: string };

  let onto = $state(untrack(() => initialOnto));
  let plan = $state.raw<RebasePlan | null>(null);
  let steps = $state.raw<Step[]>([]);
  let branches = $state.raw<GitBranch[]>([]);
  let ontoOpen = $state(false);
  let error = $state('');
  let drag = $state<{ from: number; to: number } | null>(null);
  let list = $state<HTMLElement>();

  const VERBS: RebaseVerb[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];
  const KEYS: Record<string, RebaseVerb> = { p: 'pick', r: 'reword', s: 'squash', f: 'fixup', d: 'drop' };
  const current = $derived(git.status?.branch || 'HEAD');
  const kept = $derived(steps.filter((s) => s.action === 'pick' || s.action === 'reword').length);
  const pushed = $derived(steps.filter((s) => s.pushed).length);
  const invalid = $derived(rebasePlanError(steps));

  $effect(() => {
    const root = workspace.path;
    const target = onto;
    if (!root) return;
    void gitRebasePlan(root, target)
      .then((p) => {
        plan = p;
        error = '';
        reset();
      })
      .catch((err) => {
        plan = null;
        steps = [];
        error = String(err);
      });
  });

  $effect(() => {
    const root = workspace.path;
    if (root) void gitBranchList(root).then((b) => (branches = b.filter((x) => !x.current)));
  });

  function reset(): void {
    steps = (plan?.commits ?? []).map((c) => ({ ...c, action: 'pick', message: c.subject }));
  }

  function setVerb(i: number, action: RebaseVerb): void {
    steps = steps.map((s, k) => (k === i ? { ...s, action } : s));
    if (action === 'reword')
      requestAnimationFrame(() => list?.querySelector<HTMLInputElement>(`[data-msg="${i}"]`)?.focus());
  }

  function rowKey(e: KeyboardEvent, i: number): void {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    const verb = KEYS[e.key.toLowerCase()];
    if (verb) {
      e.preventDefault();
      setVerb(i, verb);
    }
  }

  // ---- Reorder by dragging the handle ----
  function rowAt(y: number): number {
    const rows = [...(list?.querySelectorAll<HTMLElement>('[data-step]') ?? [])];
    const i = rows.findIndex((r) => y < r.getBoundingClientRect().top + r.offsetHeight / 2);
    return i === -1 ? rows.length - 1 : i;
  }
  function dragStart(e: PointerEvent, i: number): void {
    e.preventDefault(); // no text selection across the rows while dragging
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { from: i, to: i };
  }
  function dragMove(e: PointerEvent): void {
    if (drag) drag = { ...drag, to: rowAt(e.clientY) };
  }
  function dragEnd(): void {
    if (drag && drag.from !== drag.to) {
      const next = steps.slice();
      const [moved] = next.splice(drag.from, 1);
      next.splice(drag.to, 0, moved);
      steps = next;
    }
    drag = null;
  }

  async function start(): Promise<void> {
    if (invalid || !steps.length) return;
    const actions = steps.map((s) => ({
      hash: s.hash,
      action: s.action,
      ...(s.action === 'reword' ? { message: s.message.trim() } : {}),
    }));
    onClose();
    await rebaseInteractive(onto, actions);
  }
</script>

<div class="bs-overlay" role="dialog" aria-modal="true" aria-labelledby="bs-rebase-title">
  <div class="bs-rebase">
    <div class="head">
      <div>
        <div class="eb">{t('git.rb.title')}</div>
        <h2 id="bs-rebase-title">{`${current} → ${onto}`}</h2>
        {#if plan}
          <p>
            {t('git.rb.sub', {
              n: steps.length,
              commits: tp(
                steps.length,
                ['коммит будет переписан', 'коммита будут переписаны', 'коммитов будут переписаны'],
                ['commit is rewritten', 'commits are rewritten'],
              ),
              short: plan.ontoShort,
              subject: plan.ontoSubject,
            })}
          </p>
        {/if}
      </div>
      <div class="onto">
        <button class="pick" onclick={() => (ontoOpen = !ontoOpen)}
          >onto <GitBranchIcon size={13} /><b>{onto}</b><span class="material-symbols-outlined">expand_more</span
          ></button
        >
        {#if ontoOpen}
          <div class="menu" role="menu">
            {#each branches as b (b.name)}
              <button
                role="menuitem"
                onclick={() => {
                  onto = b.name;
                  ontoOpen = false;
                }}
                >{#if b.remote}<span class="material-symbols-outlined">cloud</span>{:else}<GitBranchIcon
                    size={13}
                  />{/if}{b.name}</button
              >
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if error}
      <div class="bs-git-diff-error">{error}</div>
    {:else if plan && !steps.length}
      <div class="empty">{t('git.rb.nothing', { onto })}</div>
    {:else}
      <div class="list" bind:this={list}>
        <div class="lh">
          <span>{t('git.rb.oldestFirst')}</span><span>P pick · R reword · S squash · F fixup · D drop</span>
        </div>
        {#each steps as s, i (s.hash)}
          {@const fold = s.action === 'squash' || s.action === 'fixup' ? foldTarget(steps, i) : undefined}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            class="step {s.action}"
            class:folded={!!fold}
            class:dragging={drag?.from === i}
            class:over={drag && drag.to === i && drag.from !== i}
            data-step={i}
            tabindex="0"
            role="listitem"
            onkeydown={(e) => rowKey(e, i)}
          >
            <span
              class="grip"
              role="button"
              tabindex="-1"
              aria-label={t('git.rb.drag')}
              onpointerdown={(e) => dragStart(e, i)}
              onpointermove={dragMove}
              onpointerup={dragEnd}
              onpointercancel={() => (drag = null)}><span class="material-symbols-outlined">drag_indicator</span></span
            >
            {#if fold}<span class="material-symbols-outlined fold" aria-hidden="true">subdirectory_arrow_right</span
              >{/if}
            <select
              class="verb {s.action}"
              value={s.action}
              aria-label={t('git.rb.action')}
              onchange={(e) => setVerb(i, e.currentTarget.value as RebaseVerb)}
            >
              {#each VERBS as v (v)}<option value={v}>{v}</option>{/each}
            </select>
            <span class="hash">{s.short}</span>
            {#if s.action === 'reword'}
              <input
                class="msg"
                data-msg={i}
                value={s.message}
                aria-label={t('git.rb.message')}
                oninput={(e) => (steps = steps.map((x, k) => (k === i ? { ...x, message: e.currentTarget.value } : x)))}
              />
            {:else}
              <span class="subj" class:dropped={s.action === 'drop'}>{s.subject}</span>
            {/if}
            {#if fold}<span class="into">{`→ ${t('git.rb.into')} ${fold.short}`}</span>{/if}
            {#if s.pushed}<span class="material-symbols-outlined pushed" title={t('git.rb.pushedOne')}>cloud_done</span
              >{/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if pushed}
      <div class="warn">
        <span class="material-symbols-outlined">warning</span>{t('git.rb.pushed', {
          n: pushed,
          commits: tp(pushed, ['коммит уже', 'коммита уже', 'коммитов уже'], ['commit is', 'commits are']),
        })}
      </div>
    {/if}
    {#if invalid}<div class="bad">{t(invalid)}</div>{/if}

    <div class="foot">
      <span class="count"
        >{`${steps.length} → ${kept} ${tp(kept, ['коммит', 'коммита', 'коммитов'], ['commit', 'commits'])}`}</span
      >
      <button class="link" onclick={reset}>{t('git.rb.reset')}</button>
      <span class="grow"></span>
      <button class="bs-gbtn" onclick={onClose}>{t('common.cancel')}</button>
      <button class="bs-gbtn inv" disabled={!!invalid || !steps.length || git.busy} onclick={start}
        ><span class="material-symbols-outlined">play_arrow</span>{t('git.rb.start')}</button
      >
    </div>
  </div>
</div>

<style>
  .bs-rebase {
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 24px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: 0 24px 64px var(--color-shadow);
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .eb,
  .lh {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  h2 {
    margin: 6px 0 4px;
    color: var(--color-text);
    font: 600 20px var(--font-ui);
  }
  p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui);
  }
  .onto {
    position: relative;
    flex: none;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-ui);
  }
  .pick b {
    color: var(--method-patch);
    font: 500 var(--font-size-body) var(--font-code);
  }
  .pick .material-symbols-outlined {
    font-size: 15px;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 38px;
    z-index: 2;
    width: 240px;
    max-height: 280px;
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-raised);
    box-shadow: 0 12px 32px var(--color-shadow);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
  .menu button:hover {
    background: var(--color-hover);
  }
  .menu .material-symbols-outlined {
    font-size: 14px;
    color: var(--color-text-muted);
  }
  .list {
    min-height: 0;
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .lh {
    display: flex;
    justify-content: space-between;
    padding: 4px 8px 10px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 0 8px;
    border-radius: 14px;
    outline: none;
  }
  .step:focus-visible,
  .step:focus-within {
    background: var(--color-hover);
  }
  .step.folded {
    padding-left: 34px;
  }
  .step.dragging {
    opacity: 0.5;
  }
  .step.over {
    box-shadow: inset 0 2px 0 var(--color-text-secondary);
  }
  .grip {
    flex: none;
    display: inline-flex;
    padding: 4px 0;
    color: var(--color-text-muted);
    cursor: grab;
    touch-action: none;
  }
  .grip .material-symbols-outlined {
    font-size: 18px;
  }
  .folded .grip {
    margin-left: -26px;
  }
  .fold {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .verb {
    flex: none;
    width: 104px;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background-color: var(--color-raised);
    color: var(--color-text);
    font: 600 var(--font-size-body) var(--font-code);
  }
  .verb.reword {
    color: var(--method-get);
  }
  .verb.squash,
  .verb.fixup {
    color: var(--method-patch);
  }
  .verb.drop {
    color: var(--color-danger);
  }
  .hash {
    flex: none;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-code);
  }
  .subj {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font-size: var(--font-size-ui);
  }
  .subj.dropped {
    color: var(--color-text-muted);
    text-decoration: line-through;
  }
  .msg {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--method-get);
    border-radius: var(--radius-control);
    outline: none;
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
  }
  .into {
    flex: none;
    color: var(--method-get);
    font: var(--font-size-caption) var(--font-code);
  }
  .pushed {
    flex: none;
    font-size: 15px;
    color: var(--color-text-muted);
  }
  .warn,
  .bad {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font-size: var(--font-size-body);
  }
  .bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .warn .material-symbols-outlined {
    font-size: 16px;
  }
  .empty {
    padding: 24px;
    color: var(--color-text-muted);
    text-align: center;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .count {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  .link {
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
  }
  .link:hover {
    color: var(--color-text);
  }
  .grow {
    flex: 1;
  }
  .foot .bs-gbtn {
    height: 38px;
    padding: 0 18px;
  }
</style>
