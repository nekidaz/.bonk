<script lang="ts">
  /** Renders a unified-diff string as numbered, colored rows. Pure presentational. */
  import { diffRows } from '../domain/diff';
  let { text }: { text: string } = $props();
  const rows = $derived(diffRows(text));
</script>

<div class="bs-git-diff-code" role="region" aria-label="Git diff">
  {#each rows as row, i (i)}
    <div class="bs-git-diff-row {row.cls}">
      <span class="old">{row.oldLine}</span>
      <span class="new">{row.newLine}</span>
      <code>{row.text}</code>
    </div>
  {/each}
</div>
