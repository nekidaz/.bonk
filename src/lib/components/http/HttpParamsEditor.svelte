<script lang="ts">
  import { t } from '../../i18n';
  import { syncUrlWithParams } from '../../domain/http';
  import { emptyParam, paramRows, titleFor } from '../../domain/httpHeaders';
  import { collections, updateActiveTab } from '../../stores';
  import { isParamChanged } from '../../domain/dirty';
  import { findNode } from '../../domain/tree';
  import type { Param, Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();
  const saved = $derived.by(() => { const n = tab.savedPath ? findNode($collections, tab.savedPath) : undefined; return n?.kind === 'request' ? n : undefined; });

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
  <div class="bs-qp"><span class="t">{$t('http.params.title')}<span aria-hidden="true">&nbsp;&nbsp;·&nbsp;&nbsp;</span>{(tab.params ?? []).filter((p) => p.key.trim()).length}</span></div>
  <div class="bs-pt">
    <div class="bs-pr h"><div class="bs-pc c"></div><div class="bs-pc k">{$t('http.col.key')}</div><div class="bs-pc v">{$t('http.col.value')}</div><div class="bs-pc d">{$t('http.col.description')}</div><div class="bs-pc m"></div></div>
    {#each paramRows(tab) as p, i (i)}
      <div class="bs-pr" class:disabled={!p.enabled} class:ph={!p.key && !p.value && !p.description} class:changed={isParamChanged(tab, saved, i)}>
        <div class="bs-pc c"><input type="checkbox" checked={p.enabled} onchange={() => toggleParam(i)} aria-label={$t('http.params.enable')} /></div>
        <div class="bs-pc k"><input placeholder={$t('http.col.key')} value={p.key} oninput={(e) => setParam(i, 'key', e.currentTarget.value)} /></div>
        <div class="bs-pc v"><input placeholder={$t('http.col.value')} value={p.value} oninput={(e) => setParam(i, 'value', e.currentTarget.value)} /></div>
        <div class="bs-pc d"><input placeholder={$t('http.col.description')} value={p.description} oninput={(e) => setParam(i, 'description', e.currentTarget.value)} /></div>
        <div class="bs-pc m"></div>
      </div>
    {/each}
  </div>
</div>
