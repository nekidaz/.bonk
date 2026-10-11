<script lang="ts">
  /**
   * G7: the files a stopped cherry-pick / merge / rebase / revert left in conflict. Each row says
   * what each side did and resolves it: Mine / Theirs / Merge… (the G8 editor) when both kept the
   * file, Keep deleted / Restore when one side deleted it. Files resolved since stay listed with
   * Open / Reset. Below, the selected file's first conflict, ours next to theirs.
   */
  import { findNode, workspace } from '$entities/workspace';
  import { describeFile, git, openGitDiffTab, openMergeTab, resolveSide, unresolve } from '$entities/git';
  import { gitConflicts, gitOperationInfo } from '$shared/ipc';
  import { methodColor, type ConflictFile, type OperationInfo } from '$shared/model';
  import { t, tp } from '$shared/i18n';
  import { merge3, type Chunk } from './merge3';

  let files = $state.raw<ConflictFile[]>([]);
  let op = $state.raw<OperationInfo | null>(null);
  let picked = $state('');
  let loadSeq = 0;

  $effect(() => {
    const root = workspace.path;
    void git.version;
    if (root) void load(root);
  });

  async function load(root: string): Promise<void> {
    const seq = ++loadSeq;
    try {
      const [c, o] = await Promise.all([gitConflicts(root), gitOperationInfo(root)]);
      if (seq !== loadSeq) return;
      files = c;
      op = o;
    } catch (err) {
      if (seq === loadSeq) git.error = String(err);
    }
  }

  const lines = (s: string | null) => (s === null ? [] : s.split('\n'));
  const info = (path: string) => describeFile(path, git.prefix, (id) => findNode(workspace.tree, id));
  // Every file of this operation: still conflicted first, then the ones resolved since.
  const rows = $derived([
    ...files.map((f) => ({ path: f.path, file: f })),
    ...git.opConflicts.filter((p) => !files.some((f) => f.path === p)).map((path) => ({ path, file: undefined })),
  ]);
  const selected = $derived(files.find((f) => f.path === picked) ?? files[0]);
  const chunksOf = (f: ConflictFile) => merge3(lines(f.base), lines(f.mine), lines(f.theirs));
  const short = (h: string) => h.slice(0, 7);
  const sideWord = (side: string | null, base: string | null) =>
    side === null ? t('git.cf.deleted') : base === null ? t('git.cf.added') : t('git.cf.changed');

  function summary(f: ConflictFile): string {
    if (f.mine === null || f.theirs === null)
      return f.mine === null ? t('git.cf.deletedMine') : t('git.cf.deletedTheirs');
    const chunks = chunksOf(f);
    const n = chunks.filter((c) => c.kind === 'change' && c.conflict).length;
    const auto = chunks.reduce(
      (sum, c) => sum + (c.kind === 'change' && !c.conflict ? Math.max(c.mine.length, c.theirs.length) : 0),
      0,
    );
    return t('git.cf.summary', {
      n,
      conflicts: tp(n, ['конфликт', 'конфликта', 'конфликтов'], ['conflict', 'conflicts']),
      auto,
    });
  }

  /** The selected file's first conflict with two lines of context on each side, for the preview. */
  function preview(f: ConflictFile): { mine: Line[]; theirs: Line[] } | null {
    const chunks = chunksOf(f);
    const at = chunks.findIndex((c) => c.kind === 'change' && c.conflict);
    if (at === -1) return null;
    const side = (s: 'mine' | 'theirs') => {
      const out: Line[] = [];
      let n = 1;
      chunks.forEach((c: Chunk, i) => {
        const ls = c.kind === 'same' ? c.lines : c[s];
        ls.forEach((text, k) => {
          const near = c.kind === 'same' && ((i === at - 1 && k >= ls.length - 2) || (i === at + 1 && k < 2));
          if (i === at || near) out.push({ n, text, hot: i === at });
          n++;
        });
      });
      return out;
    };
    return { mine: side('mine'), theirs: side('theirs') };
  }
  type Line = { n: number; text: string; hot: boolean };
  const pv = $derived(selected ? preview(selected) : null);
</script>

<div class="bs-gview">
  <div class="bs-ghead">
    <div class="ttl">
      <span class="crumb"
        >{op?.kind ? `${op.kind}  ${op.theirs}  →  ${op.mine}` : `${t('git.title')}  /  ${t('git.conflicts')}`}</span
      >
      <div class="row">
        <h2>{t('git.conflicts')}</h2>
        {#if rows.length}
          <span class="bs-gtag" class:bad={files.length > 0}
            >{t('git.cf.left', {
              n: files.length,
              total: rows.length,
              files: tp(rows.length, ['файла', 'файлов', 'файлов'], ['file', 'files']),
            })}</span
          >
        {/if}
      </div>
    </div>
    <button
      class="bs-gbtn"
      disabled={!files.length || git.busy}
      onclick={() =>
        resolveSide(
          files.map((f) => f.path),
          'mine',
        )}><span class="material-symbols-outlined">chevron_left</span>{t('git.cf.allMine')}</button
    >
    <button
      class="bs-gbtn"
      disabled={!files.length || git.busy}
      onclick={() =>
        resolveSide(
          files.map((f) => f.path),
          'theirs',
        )}><span class="material-symbols-outlined">chevron_right</span>{t('git.cf.allTheirs')}</button
    >
  </div>

  <div class="bs-gview-body">
    {#if !rows.length}
      <div class="bs-gview-empty">{op?.kind ? t('git.op.ready') : t('git.cf.none')}</div>
    {:else}
      <div class="table">
        <div class="th">
          <span>{t('git.cf.request')}</span>
          <span>{`${t('git.cf.mine')}  ·  ${op?.mine ?? ''}`}</span>
          <span>{`${t('git.cf.theirs')}  ·  ${op?.theirs ?? ''}`}</span>
          <span></span>
        </div>
        {#each rows as r (r.path)}
          {@const i = info(r.path)}
          {@const f = r.file}
          <div
            class="tr"
            class:sel={!!f && selected?.path === f.path}
            role="row"
            tabindex="-1"
            onclick={() => (picked = r.path)}
            onkeydown={() => {}}
          >
            <span class="req">
              <span class="material-symbols-outlined st" class:ok={!f} aria-hidden="true"
                >{f ? 'error' : 'check_circle'}</span
              >
              <span class="two">
                <span class="nm"
                  ><b style:color={i.method ? methodColor(i.method === 'gRPC' ? 'GRPC' : i.method) : undefined}
                    >{i.method}</b
                  >{i.name}</span
                >
                <span class="sub" class:ok={!f}>{f ? summary(f) : t('git.cf.resolved')}</span>
              </span>
            </span>
            {#if f}
              <span class="side"><i class:del={f.mine === null}></i>{sideWord(f.mine, f.base)}</span>
              <span class="side"><i class:del={f.theirs === null}></i>{sideWord(f.theirs, f.base)}</span>
              <span class="acts">
                {#if f.mine === null || f.theirs === null}
                  <button
                    class="bs-gbtn"
                    disabled={git.busy}
                    onclick={() => resolveSide([f.path], f.mine === null ? 'mine' : 'theirs')}
                    >{t('git.cf.keepDeleted')}</button
                  >
                  <button
                    class="bs-gbtn"
                    disabled={git.busy}
                    onclick={() => resolveSide([f.path], f.mine === null ? 'theirs' : 'mine')}
                    ><span class="material-symbols-outlined">restore</span>{t('git.cf.restore')}</button
                  >
                {:else}
                  <button class="bs-gbtn" disabled={git.busy} onclick={() => resolveSide([f.path], 'mine')}
                    >{t('git.cf.takeMine')}</button
                  >
                  <button class="bs-gbtn" disabled={git.busy} onclick={() => resolveSide([f.path], 'theirs')}
                    >{t('git.cf.takeTheirs')}</button
                  >
                  <button class="bs-gbtn inv" onclick={() => openMergeTab(f.path, i.name)}
                    ><span class="material-symbols-outlined">merge</span>{t('git.cf.merge')}</button
                  >
                {/if}
              </span>
            {:else}
              <span class="side"></span>
              <span class="side"></span>
              <span class="acts">
                <button class="bs-gbtn" onclick={() => openGitDiffTab(r.path, 'staged', i.name)}
                  ><span class="material-symbols-outlined">visibility</span>{t('git.cf.open')}</button
                >
                <button class="bs-gbtn" disabled={git.busy} onclick={() => unresolve([r.path])}
                  ><span class="material-symbols-outlined">undo</span>{t('git.cf.reset')}</button
                >
              </span>
            {/if}
          </div>
        {/each}
      </div>

      {#if selected && pv}
        <div class="pv">
          {#each [['mine', pv.mine, op?.mine ?? '', git.log[0]?.short ?? '', git.log[0]?.subject ?? ''], ['theirs', pv.theirs, op?.theirs ?? '', short(op?.hash ?? ''), op?.subject ?? '']] as const as [side, ls, label, hash, subject] (side)}
            <div class="card {side}">
              <div class="ch">
                <span class="eb">{`${side === 'mine' ? t('git.cf.mine') : t('git.cf.theirs')}  ·  ${label}`}</span>
                <span class="hash">{hash}</span>
              </div>
              <div class="subj">{subject}</div>
              <div class="code">
                {#each ls as l (l.n)}
                  <div class="ln" class:hot={l.hot}><span class="no">{l.n}</span><code>{l.text}</code></div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <p class="note">
          <span class="material-symbols-outlined">info</span>{t('git.cf.note')}
        </p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .table {
    flex: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .th,
  .tr {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr) minmax(0, 0.8fr) auto;
    align-items: center;
    gap: 12px;
    padding: 0 20px;
  }
  .th {
    height: 42px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  .tr {
    min-height: 60px;
    cursor: default;
  }
  .tr + .tr {
    border-top: 1px solid var(--color-border-subtle);
  }
  .tr.sel {
    background: var(--color-hover);
  }
  .req {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .st {
    font-size: 18px;
    color: var(--color-danger);
  }
  .st.ok {
    color: var(--color-success);
  }
  .two {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font-size: var(--font-size-label);
  }
  .nm b {
    margin-right: 8px;
    font: 700 var(--font-size-caption) var(--font-code);
  }
  .sub {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .sub.ok {
    color: var(--color-success);
  }
  .side {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
  }
  .side i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning);
  }
  .side i.del {
    background: var(--color-danger);
  }
  .acts {
    display: flex;
    gap: 8px;
  }
  .pv {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .card {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .ch {
    display: flex;
    justify-content: space-between;
    padding: 14px 18px 0;
  }
  .eb {
    padding-left: 8px;
    border-left: 3px solid var(--method-get);
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  .theirs .eb {
    border-color: var(--color-warning);
  }
  .hash {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  .subj {
    padding: 6px 18px 12px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text);
    font-size: var(--font-size-label);
  }
  .code {
    padding: 6px 0;
    font: 13px/26px var(--font-code);
  }
  .ln {
    display: flex;
    white-space: pre;
    color: var(--color-text);
  }
  .ln.hot {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .no {
    flex: none;
    width: 40px;
    padding-right: 12px;
    text-align: right;
    color: var(--color-text-muted);
  }
  code {
    font: inherit;
  }
  .note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
  }
  .note .material-symbols-outlined {
    font-size: 15px;
  }
</style>
