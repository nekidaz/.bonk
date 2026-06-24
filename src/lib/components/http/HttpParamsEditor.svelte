<script lang="ts">
  import { syncUrlWithParams } from '../../domain/http';
  import { emptyParam, paramRows, titleFor } from '../../domain/httpHeaders';
  import { updateActiveTab } from '../../stores';
  import type { Param, Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();

  function setParam(i: number, field: keyof Param, value: string): void {
    updateActiveTab((t) => {
      const ps = [...(t.params ?? [])];
      while (i >= ps.length) ps.push(emptyParam());
      ps[i] = { ...ps[i], [field]: value };
      const nextUrl = syncUrlWithParams(t.request.url, ps);
      return { ...t, params: ps, request: { ...t.request, url: nextUrl }, title: titleFor(t, nextUrl) };
    });
  }

  function toggleParam(i: number): void {
    updateActiveTab((t) => {
      const ps = [...(t.params ?? [])];
      while (i >= ps.length) ps.push(emptyParam());
      ps[i] = { ...ps[i], enabled: !ps[i].enabled };
      const nextUrl = syncUrlWithParams(t.request.url, ps);
      return { ...t, params: ps, request: { ...t.request, url: nextUrl }, title: titleFor(t, nextUrl) };
    });
  }
</script>

<div class="bs-pwrap">
  <div class="bs-qp"><span class="t">Query Params</span></div>
  <div class="bs-pt">
    <div class="bs-pr h"><div class="bs-pc c"></div><div class="bs-pc k">Key</div><div class="bs-pc v">Value</div><div class="bs-pc d">Description</div></div>
    {#each paramRows(tab) as p, i (i)}
      <div class="bs-pr" class:disabled={!p.enabled}>
        <div class="bs-pc c"><input type="checkbox" checked={p.enabled} onchange={() => toggleParam(i)} aria-label="Enable query parameter" /></div>
        <div class="bs-pc k"><input placeholder="Key" value={p.key} oninput={(e) => setParam(i, 'key', e.currentTarget.value)} /></div>
        <div class="bs-pc v"><input placeholder="Value" value={p.value} oninput={(e) => setParam(i, 'value', e.currentTarget.value)} /></div>
        <div class="bs-pc d"><input placeholder="Description" value={p.description} oninput={(e) => setParam(i, 'description', e.currentTarget.value)} /></div>
      </div>
    {/each}
  </div>
</div>
