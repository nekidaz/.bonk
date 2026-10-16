<script lang="ts">
  /**
   * Runner R1 «Что запустить?»: pick a collection (or any folder via search),
   * or repeat one of the recent runs. Picking opens the run setup (R2).
   * Shared atoms (.rn-eyebrow, .rn-btn …) are styled by RunnerView.
   */
  import { findNode, workspace } from '$entities/workspace';
  import {
    setRunnerFolders,
    setRunnerStage,
    repeatRun,
    applyPreset,
    deletePreset,
    composeFrom,
    runner,
  } from './store.svelte';
  import RequestPicker from './RequestPicker.svelte';
  import { uiLanguage, t, tp } from '$shared/i18n';
  import { relDay } from './runnerStats';
  import type { FolderNode, TreeNode } from '$shared/model';

  let query = $state('');
  let composing = $state(false);

  function stats(n: FolderNode): { requests: number; grpc: number; folders: number } {
    const s = { requests: 0, grpc: 0, folders: 0 };
    const walk = (list: TreeNode[]) => {
      for (const c of list) {
        if (c.kind === 'folder') {
          s.folders++;
          walk(c.children);
        } else {
          s.requests++;
          if (c.protocol === 'grpc') s.grpc++;
        }
      }
    };
    walk(n.children);
    return s;
  }
  function allFolders(list: TreeNode[], out: FolderNode[] = []): FolderNode[] {
    for (const n of list) if (n.kind === 'folder') (out.push(n), allFolders(n.children, out));
    return out;
  }

  const q = $derived(query.trim().toLowerCase());
  // Top-level folders are the collections; a search reaches any folder.
  const items = $derived(
    q
      ? allFolders(workspace.tree).filter((f) => f.name.toLowerCase().includes(q))
      : workspace.tree.filter((n): n is FolderNode => n.kind === 'folder'),
  );
  // History is app-wide; show only runs whose folders exist in this workspace.
  const recent = $derived(
    [...runner.history]
      .reverse()
      .filter((h) => h.folderIds?.every((id) => findNode(workspace.tree, id)))
      .slice(0, 3),
  );
  const lastFor = (id: string) => runner.history.findLast((h) => h.folderIds?.[0] === id);

  function subtitle(f: FolderNode): string {
    const s = stats(f);
    const unit =
      s.grpc === s.requests && s.requests > 0
        ? tp(s.requests, ['метод', 'метода', 'методов'], ['method', 'methods'])
        : tp(s.requests, ['запрос', 'запроса', 'запросов'], ['request', 'requests']);
    const folders = s.folders
      ? ` · ${s.folders} ${tp(s.folders, ['папка', 'папки', 'папок'], ['folder', 'folders'])}`
      : '';
    return `${s.requests} ${unit}${folders}`;
  }

  function pick(id: string): void {
    setRunnerFolders([id]);
    setRunnerStage('setup');
  }
</script>

<div class="rp">
  <div class="rp-col">
    <div class="rp-head">
      <div class="rn-eyebrow">{t('runner.pick.crumb')}</div>
      <h2>{t('runner.pick.title')}</h2>
      <p>{t('runner.pick.sub')}</p>
    </div>

    <label class="rp-search">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="search"
        bind:value={query}
        placeholder={t('runner.pick.search')}
        aria-label={t('runner.pick.search')}
        autofocus
        onkeydown={(e) => e.key === 'Enter' && items[0] && pick(items[0].id)}
      />
    </label>

    {#if composing}
      <div class="rp-compose">
        <RequestPicker onpick={composeFrom} onclose={() => (composing = false)} />
      </div>
    {:else}
      <button class="rp-item rp-new" type="button" onclick={() => (composing = true)}>
        <span class="rp-ico"><span class="material-symbols-outlined" aria-hidden="true">playlist_add</span></span>
        <span class="rp-name"><b>{t('runner.compose.start')}</b><small>{t('runner.compose.startSub')}</small></span>
        <span class="material-symbols-outlined rp-chev" aria-hidden="true">chevron_right</span>
      </button>
    {/if}

    {#if items.length > 0}
      <div class="rp-list">
        {#each items as f (f.id)}
          {@const last = lastFor(f.id)}
          <button class="rp-item" type="button" onclick={() => pick(f.id)}>
            <span class="rp-ico"><span class="material-symbols-outlined" aria-hidden="true">folder</span></span>
            <span class="rp-name"><b>{f.name}</b><small>{subtitle(f)}</small></span>
            <span class="rp-last">
              {#if last}
                <i class="rn-dot" class:bad={last.passed < last.total}></i>{t('runner.pick.last', {
                  passed: last.passed,
                  total: last.total,
                  when: relDay(last.startedAt, uiLanguage.current),
                })}
              {:else}
                {t('runner.pick.never')}
              {/if}
            </span>
            <span class="material-symbols-outlined rp-chev" aria-hidden="true">chevron_right</span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="rn-muted rp-empty">{q ? t('runner.pick.none') : t('runner.pick.empty')}</p>
    {/if}

    {#if recent.length > 0}
      <div class="rn-eyebrow">{t('runner.pick.recent')}</div>
      <div class="rp-recent">
        {#each recent as h (h.n)}
          <button class="rp-card" type="button" onclick={() => repeatRun(h)}>
            <span class="rp-card-top"
              ><span>#{h.n}</span><b class:bad={h.passed < h.total}>{h.passed}/{h.total}</b></span
            >
            <span class="rp-card-name">{h.title}</span>
            <small>{[h.envName ?? t('runner.noEnv'), `×${h.iterations ?? 1}`].join(' · ')}</small>
          </button>
        {/each}
      </div>
    {/if}

    {#if runner.presets.length > 0}
      <div class="rn-eyebrow">{t('runner.preset.title')}</div>
      <div class="rp-recent">
        {#each [...runner.presets].reverse() as p (p.name)}
          <div class="rp-card rp-preset">
            <button class="rp-pbody" type="button" onclick={() => applyPreset(p)}>
              <span class="rp-card-name">{p.name}</span>
              <small>{[`×${p.iterations}`, p.delayMs ? `${p.delayMs} ms` : ''].filter(Boolean).join(' · ')}</small>
            </button>
            <button
              class="rp-pdel"
              type="button"
              title={t('runner.preset.delete')}
              aria-label={t('runner.preset.delete')}
              onclick={() => deletePreset(p.name)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <p class="rp-hint">
      <span class="material-symbols-outlined" aria-hidden="true">info</span>{t('runner.pick.hint')}
    </p>
  </div>
</div>

<style>
  .rp {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    justify-content: center;
    padding: 26px 0 20px;
  }
  .rp-col {
    width: 640px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .rp-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 4px;
  }
  .rp-head h2 {
    margin: 2px 0 0;
    font: 600 26px/32px var(--font-ui);
    letter-spacing: -0.5px;
  }
  .rp-head p {
    margin: 0;
    color: var(--color-text-secondary);
    font: 13px/18px var(--font-ui);
  }

  .rp-new {
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .rp-compose {
    display: flex;
    flex-direction: column;
  }
  .rp-search {
    height: 40px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    background: var(--color-field);
  }
  .rp-search:focus-within {
    border-color: var(--color-border);
  }
  .rp-search .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .rp-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    box-shadow: none;
    background: none;
    color: var(--color-text);
    font: 13px var(--font-ui);
  }

  .rp-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
  }
  .rp-item {
    height: 58px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 14px;
    border-radius: 12px;
    text-align: left;
    color: var(--color-text);
  }
  .rp-item:hover,
  .rp-item:focus-visible {
    background: var(--color-selected);
    outline: 0;
  }
  .rp-ico {
    flex: none;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: var(--color-panel);
    color: var(--color-text-secondary);
  }
  .rp-ico .material-symbols-outlined {
    font-size: 17px;
  }
  .rp-name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rp-name b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 14px/18px var(--font-ui);
  }
  .rp-name small {
    color: var(--color-text-muted);
    font: 11px/14px var(--font-ui);
  }
  .rp-last {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--color-text-secondary);
    font: 11px var(--font-ui);
  }
  .rp-last .rn-dot {
    background: var(--color-success);
  }
  .rp-last .rn-dot.bad {
    background: var(--color-danger);
  }
  .rp-chev {
    flex: none;
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .rp-empty {
    margin: 8px 4px;
  }

  .rp-recent {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .rp-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 11px 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 14px;
    background: var(--color-field);
    text-align: left;
    color: var(--color-text);
  }
  .rp-card:hover {
    border-color: var(--color-border);
  }
  .rp-card-top {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-muted);
    font: 10px/13px var(--font-code);
  }
  .rp-card-top b {
    color: var(--color-success);
    font-weight: 600;
  }
  .rp-card-top b.bad {
    color: var(--color-danger);
  }
  .rp-card-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 12px/16px var(--font-ui);
  }
  .rp-card small {
    color: var(--color-text-muted);
    font: 11px/14px var(--font-ui);
  }

  .rp-preset {
    position: relative;
    padding: 0;
  }
  .rp-pbody {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 11px 28px 11px 12px;
    text-align: left;
    color: inherit;
    min-width: 0;
  }
  .rp-pdel {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    color: var(--color-text-muted);
  }
  .rp-pdel:hover {
    color: var(--color-text);
  }
  .rp-pdel .material-symbols-outlined {
    font-size: 14px;
  }
  .rp-hint {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 2px 0 0;
    color: var(--color-text-muted);
    font: 11px var(--font-ui);
  }
  .rp-hint .material-symbols-outlined {
    font-size: 14px;
  }
</style>
