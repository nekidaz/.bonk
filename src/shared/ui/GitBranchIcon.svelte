<script lang="ts">
  /**
   * The git-branch glyph from the design (Material Symbols has none). Sized and coloured like a
   * symbol icon: 1em square in the text colour, so `font-size` on it or its parent sets the size.
   */
  let { size }: { size?: number } = $props();
</script>

<svg
  class="bs-gitbranch"
  viewBox="0 0 24 24"
  width={size ?? '1em'}
  height={size ?? '1em'}
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  ><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path
    d="M18 9a9 9 0 0 1-9 9"
  /></svg
>

<style>
  .bs-gitbranch {
    flex: none;
  }
</style>
