<script lang="ts">
  import { t } from '$shared/i18n';
  import { syncUrlWithParams, type Param, type Tab } from '$shared/model';
  import { emptyParam, paramRows, titleFor } from './httpHeaders';
  import { findNode, workspace } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import { isParamChanged } from '$entities/request';
  import { KvPanel, KvHead, KvTable, KvRow, KvCell } from '$entities/request/components';

  let { tab }: { tab: Tab } = $props();
  const saved = $derived.by(() => {
    const n = tab.savedPath ? findNode(workspace.tree, tab.savedPath) : undefined;
    return n?.kind === 'request' ? n : undefined;
  });

  function setParam(i: number, field: keyof Param, value: string): void {
    tabs.updateActive((t) => {
      const ps = [...(t.params ?? [])];
      while (i >= ps.length) ps.push(emptyParam());
      ps[i] = { ...ps[i], [field]: value };
      const nextUrl = syncUrlWithParams(t.request.url, ps);
      return { ...t, params: ps, request: { ...t.request, url: nextUrl }, title: titleFor(t, nextUrl) };
    });
  }

  function toggleParam(i: number): void {
    tabs.updateActive((t) => {
      const ps = [...(t.params ?? [])];
      while (i >= ps.length) ps.push(emptyParam());
      ps[i] = { ...ps[i], enabled: !ps[i].enabled };
      const nextUrl = syncUrlWithParams(t.request.url, ps);
      return { ...t, params: ps, request: { ...t.request, url: nextUrl }, title: titleFor(t, nextUrl) };
    });
  }
</script>

<KvPanel>
  <KvHead>
    <span class="t"
      >{t('http.params.title')}<span aria-hidden="true">&nbsp;&nbsp;·&nbsp;&nbsp;</span>{(tab.params ?? []).filter(
        (p) => p.key.trim(),
      ).length}</span
    >
  </KvHead>
  <KvTable>
    <KvRow class="h">
      <KvCell class="c"></KvCell>
      <KvCell class="k">{t('http.col.key')}</KvCell>
      <KvCell class="v">{t('http.col.value')}</KvCell>
      <KvCell class="d">{t('http.col.description')}</KvCell>
      <KvCell class="m"></KvCell>
    </KvRow>
    {#each paramRows(tab) as p, i (i)}
      <KvRow
        class={{
          disabled: !p.enabled,
          ph: !p.key && !p.value && !p.description,
          changed: isParamChanged(tab, saved, i),
        }}
      >
        <KvCell class="c">
          <input
            type="checkbox"
            checked={p.enabled}
            onchange={() => toggleParam(i)}
            aria-label={t('http.params.enable')}
          />
        </KvCell>
        <KvCell class="k">
          <input
            placeholder={t('http.col.key')}
            value={p.key}
            oninput={(e) => setParam(i, 'key', e.currentTarget.value)}
          />
        </KvCell>
        <KvCell class="v">
          <input
            placeholder={t('http.col.value')}
            value={p.value}
            oninput={(e) => setParam(i, 'value', e.currentTarget.value)}
          />
        </KvCell>
        <KvCell class="d">
          <input
            placeholder={t('http.col.description')}
            value={p.description}
            oninput={(e) => setParam(i, 'description', e.currentTarget.value)}
          />
        </KvCell>
        <KvCell class="m"></KvCell>
      </KvRow>
    {/each}
  </KvTable>
</KvPanel>

<style>
  :global(:root .bs .bs-pr.changed) {
    background: var(--color-hover);
  }
</style>
