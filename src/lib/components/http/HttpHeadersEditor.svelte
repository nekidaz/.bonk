<script lang="ts">
  import { autoHeaderRows, headerRows } from '../../domain/httpHeaders';
  import { updateActiveTab } from '../../stores';
  import type { Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();

  function setHeaderRow(i: number, field: 'key' | 'value', value: string): void {
    updateActiveTab((t) => {
      const rows = Object.entries(t.request.headers ?? {});
      while (i >= rows.length) rows.push(['', '']);
      const [key, val] = rows[i];
      rows[i] = field === 'key' ? [value, val] : [key, value];
      const headers: Record<string, string> = {};
      for (const [nextKey, nextValue] of rows) {
        const cleanKey = nextKey.trim();
        if (cleanKey) headers[cleanKey] = nextValue;
      }
      return { ...t, request: { ...t.request, headers } };
    });
  }
</script>

<div class="bs-pwrap bs-hwrap">
  <div class="bs-qp"><span class="t">Auto-generated Headers</span><span class="be">{autoHeaderRows(tab).length} active</span></div>
  <div class="bs-pt bs-headers">
    <div class="bs-pr h"><div class="bs-pc k">Key</div><div class="bs-pc v">Value</div><div class="bs-pc d">Source</div></div>
    {#if autoHeaderRows(tab).length === 0}
      <div class="bs-h-empty">No active auto headers.</div>
    {:else}
      {#each autoHeaderRows(tab) as h (h.key)}
        <div class="bs-pr readonly">
          <div class="bs-pc k">{h.key}</div>
          <div class="bs-pc v">{h.value}</div>
          <div class="bs-pc d"><span class="bs-source">{h.source}</span></div>
        </div>
      {/each}
    {/if}
  </div>
  <div class="bs-qp manual"><span class="t">Headers</span><span class="be">Manual overrides</span></div>
  <div class="bs-pt bs-headers">
    <div class="bs-pr h"><div class="bs-pc k">Key</div><div class="bs-pc v">Value</div><div class="bs-pc d">Description</div></div>
    {#each headerRows(tab) as h, i (i)}
      <div class="bs-pr">
        <div class="bs-pc k"><input placeholder="Key" value={h.key} oninput={(e) => setHeaderRow(i, 'key', e.currentTarget.value)} /></div>
        <div class="bs-pc v"><input placeholder="Value" value={h.value} oninput={(e) => setHeaderRow(i, 'value', e.currentTarget.value)} /></div>
        <div class="bs-pc d">{h.key ? 'Manual' : ''}</div>
      </div>
    {/each}
  </div>
</div>
