<script lang="ts">
  /**
   * G1 / G1b: one file's full-context diff as the whole file with line numbers, either inline
   * (removed and added lines stacked) or side by side (HEAD left, the new side right, fillers
   * keeping blocks aligned, the changed middle of a replaced line marked). Presentational.
   */
  import { t } from '$shared/i18n';
  import { changedSpan, diffStats, fileLines, splitRows, type FileLine } from './diff';

  let {
    path,
    text,
    layout,
    leftLabel,
    rightLabel,
  }: { path: string; text: string; layout: 'inline' | 'split'; leftLabel: string; rightLabel: string } = $props();

  const lines = $derived(fileLines(text));
  const rows = $derived(layout === 'split' ? splitRows(lines) : []);
  const stats = $derived(diffStats(text));
  const sign = (l: FileLine) => (l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : '');
  /** The changed middle of `line` against the other side of its row, or null when nothing to mark. */
  function mark(line: FileLine, other: FileLine | undefined): [string, string, string] | null {
    if (!other || line.kind === 'ctx' || other.kind === 'ctx') return null;
    const [s, ea, eb] = changedSpan(
      line.kind === 'del' ? line.text : other.text,
      line.kind === 'del' ? other.text : line.text,
    );
    const end = line.kind === 'del' ? ea : eb;
    if (end === s) return null;
    return [line.text.slice(0, s), line.text.slice(s, end), line.text.slice(end)];
  }
</script>

{#snippet cell(line: FileLine | undefined, other: FileLine | undefined, side: 'old' | 'new')}
  {#if line}
    {@const m = mark(line, other)}
    <div class="ln {line.kind}">
      <span class="no">{side === 'old' ? line.old : line.new}</span>
      <span class="sg">{sign(line)}</span>
      <code
        >{#if m}{m[0]}<mark>{m[1]}</mark>{m[2]}{:else}{line.text}{/if}</code
      >
    </div>
  {:else}
    <div class="ln fill"><span class="no"></span><span class="sg"></span><code></code></div>
  {/if}
{/snippet}

<section class="bs-fdiff" aria-label={t('util.diff.aria')}>
  <header class="bar">
    <span class="material-symbols-outlined" aria-hidden="true">draft</span>
    <span class="path">{path}</span>
    <span class="plus">+{stats.additions}</span>
    <span class="minus">-{stats.deletions}</span>
  </header>
  {#if layout === 'split'}
    <div class="cols">
      <div class="col">
        <div class="lbl">{leftLabel}</div>
        {#each rows as r, i (i)}{@render cell(r.left, r.right, 'old')}{/each}
      </div>
      <div class="col">
        <div class="lbl">{rightLabel}</div>
        {#each rows as r, i (i)}{@render cell(r.right, r.left, 'new')}{/each}
      </div>
    </div>
  {:else}
    <div class="body">
      {#each lines as l, i (i)}{@render cell(l, undefined, l.kind === 'del' ? 'old' : 'new')}{/each}
    </div>
  {/if}
</section>

<style>
  .bs-fdiff {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 18px;
    border-bottom: 1px solid var(--color-border-subtle);
    font: 13px var(--font-code);
    color: var(--color-text-secondary);
  }
  .bar .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .bar .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plus {
    color: var(--color-success);
  }
  .minus {
    color: var(--color-danger);
  }
  .body,
  .cols {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 0 16px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
    padding-top: 0;
  }
  .col {
    min-width: 0;
    overflow-x: auto;
  }
  .col + .col {
    border-left: 1px solid var(--color-border-subtle);
    align-self: stretch;
  }
  .lbl {
    position: sticky;
    top: 0;
    height: 34px;
    line-height: 34px;
    padding: 0 20px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-field);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: pre;
  }
  .ln {
    display: flex;
    min-height: 27px;
    align-items: center;
    font: 13px/27px var(--font-code);
    color: var(--color-text);
    white-space: pre;
  }
  .no {
    flex: none;
    width: 48px;
    padding-right: 4px;
    text-align: right;
    color: var(--color-text-muted);
  }
  .sg {
    flex: none;
    width: 28px;
    text-align: center;
  }
  code {
    font: inherit;
    padding-right: 16px;
  }
  .ln.add {
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .ln.del {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .ln.add .no,
  .ln.del .no {
    color: inherit;
    opacity: 0.7;
  }
  .fill {
    background: var(--color-hover);
  }
  mark {
    background: color-mix(in srgb, currentColor 22%, transparent);
    color: inherit;
    border-radius: 3px;
  }
</style>
