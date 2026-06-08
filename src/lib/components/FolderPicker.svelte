<script lang="ts">
  import type { TreeNode } from '../domain/types';

  // Shared recursive folder list used by the Save and Move dialogs. Renders the
  // "Workspace root" row plus every folder in `nodes`, recursing into children.
  // Clicking a row sets `selected` (undefined = workspace root). `excludeId`
  // skips that subtree (used by Move to hide the node being moved).
  let {
    nodes,
    selected = $bindable(),
    excludeId,
  }: {
    nodes: TreeNode[];
    selected: string | undefined;
    excludeId?: string;
  } = $props();
</script>

{#snippet folderRow(n: TreeNode, depth: number)}
  {#if n.kind === 'folder' && n.id !== excludeId}
    <button class="bs-collrow" class:sel={selected === n.id} style="padding-left:{10 + depth * 14}px" onclick={() => (selected = n.id)}>
      <span class="material-symbols-outlined" style="font-size:15px">folder</span>{n.name}
    </button>
    {#each n.children as c (c.id)}{@render folderRow(c, depth + 1)}{/each}
  {/if}
{/snippet}

<button class="bs-collrow" class:sel={selected === undefined} onclick={() => (selected = undefined)}>
  <span class="material-symbols-outlined" style="font-size:15px">home_storage</span>Workspace root
</button>
{#each nodes as n (n.id)}{@render folderRow(n, 0)}{/each}
