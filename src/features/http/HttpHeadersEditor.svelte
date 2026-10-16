<!--
  HTTP request → Headers tab: the key/value table of headers (entities/request Kv* components),
  each row with its own «send this header» switch.
-->
<script lang="ts">
  import { t } from '$shared/i18n';
  import { autoHeaderRows, headerRows } from './httpHeaders';
  import { withInheritedAuth, workspace } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import type { HttpRequest, Tab } from '$shared/model';
  import { KvPanel, KvHead, KvTable, KvRow, KvCell, KvVarInput } from '$entities/request/components';
  import { LabelSwitch } from '$shared/ui/components';

  let { tab }: { tab: Tab } = $props();

  // S12: one table — manual headers (toggle + description), then the headers bonk adds itself.
  let showAuto = $state(true);
  const auto = $derived(autoHeaderRows((void workspace.tree, withInheritedAuth(tab, tab.savedPath))));
  const manualCount = $derived(Object.keys(tab.request.headers ?? {}).length);

  function patch(fn: (req: HttpRequest) => HttpRequest): void {
    tabs.updateActive((t) => ({ ...t, request: fn(t.request) }));
  }

  function setHeaderRow(i: number, field: 'key' | 'value', value: string): void {
    patch((req) => {
      const rows = Object.entries(req.headers ?? {});
      while (i >= rows.length) rows.push(['', '']);
      const [oldKey, val] = rows[i];
      rows[i] = field === 'key' ? [value, val] : [oldKey, value];
      const headers: Record<string, string> = {};
      for (const [k, v] of rows) if (k.trim()) headers[k.trim()] = v;
      // A renamed header keeps its description and on/off state.
      const newKey = field === 'key' ? value.trim() : oldKey;
      const notes = { ...req.headerNotes };
      let disabled = req.disabledHeaders ?? [];
      if (field === 'key' && oldKey !== newKey) {
        if (notes[oldKey] !== undefined) {
          if (newKey) notes[newKey] = notes[oldKey];
          delete notes[oldKey];
        }
        disabled = disabled.map((k) => (k === oldKey ? newKey : k)).filter(Boolean);
      }
      return { ...req, headers, headerNotes: notes, disabledHeaders: disabled };
    });
  }

  function setNote(key: string, note: string): void {
    if (!key) return;
    patch((req) => ({ ...req, headerNotes: { ...req.headerNotes, [key]: note } }));
  }

  function toggle(key: string): void {
    if (!key) return;
    patch((req) => {
      const off = req.disabledHeaders ?? [];
      return { ...req, disabledHeaders: off.includes(key) ? off.filter((k) => k !== key) : [...off, key] };
    });
  }
</script>

<KvPanel class="bs-hwrap">
  <KvHead class="bs-headers-head">
    <span class="t"
      >{t(
        'http.headers.title',
      )}&nbsp;&nbsp;·&nbsp;&nbsp;{manualCount}{#if auto.length}&nbsp;&nbsp;+&nbsp;&nbsp;{auto.length} auto{/if}</span
    >
    <LabelSwitch>
      <input type="checkbox" role="switch" bind:checked={showAuto} />
      <span class="track" aria-hidden="true"></span>
      {t('http.headers.show_auto')}
    </LabelSwitch>
  </KvHead>
  <KvTable class="bs-headers">
    <KvRow class="h">
      <KvCell class="c"></KvCell>
      <KvCell class="k">{t('http.col.key')}</KvCell>
      <KvCell class="v">{t('http.col.value')}</KvCell>
      <KvCell class="d">{t('http.col.description')}</KvCell>
      <KvCell class="m"></KvCell>
    </KvRow>
    {#each headerRows(tab) as h, i (i)}
      {@const enabled = !(tab.request.disabledHeaders ?? []).includes(h.key)}
      <KvRow class={{ disabled: !enabled, ph: !h.key && !h.value }}>
        <KvCell class="c">
          <input
            type="checkbox"
            checked={enabled && !!h.key}
            disabled={!h.key}
            onchange={() => toggle(h.key)}
            aria-label={t('http.headers.send')}
          />
        </KvCell>
        <KvCell class="k">
          <input
            placeholder={t('http.col.key')}
            value={h.key}
            oninput={(e) => setHeaderRow(i, 'key', e.currentTarget.value)}
          />
        </KvCell>
        <KvCell class="v">
          <KvVarInput
            placeholder={t('http.col.value')}
            value={h.value}
            onChange={(v) => setHeaderRow(i, 'value', v)}
            docId={`${tab.id}:header:${i}`}
          />
        </KvCell>
        <KvCell class="d">
          <input
            placeholder={t('http.col.description')}
            value={tab.request.headerNotes?.[h.key] ?? ''}
            disabled={!h.key}
            oninput={(e) => setNote(h.key, e.currentTarget.value)}
          />
        </KvCell>
        <KvCell class="m"></KvCell>
      </KvRow>
    {/each}
    {#if showAuto}
      {#each auto as h (h.key)}
        <KvRow class="auto" title={t('http.headers.auto_added')}>
          <KvCell class="c">
            <input type="checkbox" checked disabled aria-label={t('http.headers.auto_added')} />
          </KvCell>
          <KvCell class="k">{h.key}</KvCell>
          <KvCell class="v">{h.value}</KvCell>
          <KvCell class="d">{h.source === 'Auth' ? t('http.headers.auto_auth') : 'auto'}</KvCell>
          <KvCell class="m"></KvCell>
        </KvRow>
      {/each}
    {/if}
  </KvTable>
</KvPanel>

<style>
  :global(:root .bs-hwrap .bs-qp.manual) {
    margin-top: 18px;
  }

  /* S12: headers table with automatic rows and the "show auto" switch. */
  :global(:root .bs .bs-qp.bs-headers-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 16px;
  }

  :global(:root .bs .bs-pr.auto) {
    opacity: 0.5;
  }

  :global(:root .bs .bs-pr.auto .bs-pc.d) {
    font-family: var(--font-ui);
    color: var(--color-text-muted);
  }
</style>
