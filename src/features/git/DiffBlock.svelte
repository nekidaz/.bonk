<script lang="ts">
  /** Renders a unified-diff string as numbered, colored rows. Pure presentational. */
  import { t } from '$shared/i18n';
  import { diffRows } from './diff';
  let { text }: { text: string } = $props();
  const rows = $derived(diffRows(text));
</script>

<div class="bs-git-diff-code" role="region" aria-label={t('util.diff.aria')}>
  {#each rows as row, i (i)}
    <div class="bs-git-diff-row {row.cls}">
      <span class="old">{row.oldLine}</span>
      <span class="new">{row.newLine}</span>
      <code>{row.text}</code>
    </div>
  {/each}
</div>

<style>
  .bs-git-diff-row.add {
    background: color-mix(in srgb, var(--green) 10%, transparent);
  }

  .bs-git-diff-row.add :global(code) {
    color: var(--green);
  }

  .bs-git-diff-row.del {
    background: color-mix(in srgb, var(--red) 10%, transparent);
  }

  .bs-git-diff-row.del :global(code) {
    color: var(--red);
  }

  .bs-git-diff-row.hunk {
    background: color-mix(in srgb, var(--accent) 11%, transparent);
  }

  .bs-git-diff-row.hunk :global(code) {
    color: var(--accent);
    font-weight: 700;
  }

  .bs-git-diff-row.meta :global(code) {
    color: var(--t3);
  }

  .bs-git-diff-code {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 0 18px;
    background: var(--inset);
  }

  .bs-git-diff-row :global(.old) {
    padding: 0 10px;
    color: var(--t3);
    text-align: right;
    user-select: none;
    background: color-mix(in srgb, var(--surface) 35%, transparent);
    border-right: 0.5px solid var(--sepsoft);
  }

  .bs-git-diff-row :global(.new) {
    padding: 0 10px;
    color: var(--t3);
    text-align: right;
    user-select: none;
    background: color-mix(in srgb, var(--surface) 35%, transparent);
    border-right: 0.5px solid var(--sepsoft);
  }

  .bs-git-diff-row :global(code) {
    padding: 0 14px;
    font-family: inherit;
  }

  .bs-git-diff-row {
    display: grid;
    grid-template-columns: 58px 58px minmax(max-content, 1fr);
    min-height: 22px;
    align-items: stretch;
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 22px;
    white-space: pre;
    contain: paint;
  }
</style>
