<script lang="ts">
  import { t } from '$shared/i18n';
  import { autoHeaderRows, headerRows } from './httpHeaders';
  import { withInheritedAuth, workspace } from '$entities/workspace';
  import { tabs } from '$entities/tab';
  import type { HttpRequest, Tab } from '$shared/model';

  let { tab }: { tab: Tab } = $props();

  // S12: one table — manual headers (toggle + description), then the headers bonk adds itself.
  let showAuto = $state(true);
  const auto = $derived(autoHeaderRows((void workspace.tree, withInheritedAuth(tab, tab.savedPath))));
  const manualCount = $derived(Object.keys(tab.request.headers ?? {}).length);
  const isVar = (v: string) => /^\{\{[^{}]+\}\}$/.test(v.trim());

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

<div class="bs-pwrap bs-hwrap">
  <div class="bs-qp bs-headers-head">
    <span class="t"
      >{t(
        'http.headers.title',
      )}&nbsp;&nbsp;·&nbsp;&nbsp;{manualCount}{#if auto.length}&nbsp;&nbsp;+&nbsp;&nbsp;{auto.length} auto{/if}</span
    >
    <label class="bs-switch">
      <input type="checkbox" role="switch" bind:checked={showAuto} />
      <span class="track" aria-hidden="true"></span>
      {t('http.headers.show_auto')}
    </label>
  </div>
  <div class="bs-pt bs-headers">
    <div class="bs-pr h">
      <div class="bs-pc c"></div>
      <div class="bs-pc k">{t('http.col.key')}</div>
      <div class="bs-pc v">{t('http.col.value')}</div>
      <div class="bs-pc d">{t('http.col.description')}</div>
      <div class="bs-pc m"></div>
    </div>
    {#each headerRows(tab) as h, i (i)}
      {@const enabled = !(tab.request.disabledHeaders ?? []).includes(h.key)}
      <div class="bs-pr" class:disabled={!enabled} class:ph={!h.key && !h.value}>
        <div class="bs-pc c">
          <input
            type="checkbox"
            checked={enabled && !!h.key}
            disabled={!h.key}
            onchange={() => toggle(h.key)}
            aria-label={t('http.headers.send')}
          />
        </div>
        <div class="bs-pc k">
          <input
            placeholder={t('http.col.key')}
            value={h.key}
            oninput={(e) => setHeaderRow(i, 'key', e.currentTarget.value)}
          />
        </div>
        <div class="bs-pc v">
          <input
            class:var={isVar(h.value)}
            placeholder={t('http.col.value')}
            value={h.value}
            oninput={(e) => setHeaderRow(i, 'value', e.currentTarget.value)}
          />
        </div>
        <div class="bs-pc d">
          <input
            placeholder={t('http.col.description')}
            value={tab.request.headerNotes?.[h.key] ?? ''}
            disabled={!h.key}
            oninput={(e) => setNote(h.key, e.currentTarget.value)}
          />
        </div>
        <div class="bs-pc m"></div>
      </div>
    {/each}
    {#if showAuto}
      {#each auto as h (h.key)}
        <div class="bs-pr auto" title={t('http.headers.auto_added')}>
          <div class="bs-pc c">
            <input type="checkbox" checked disabled aria-label={t('http.headers.auto_added')} />
          </div>
          <div class="bs-pc k">{h.key}</div>
          <div class="bs-pc v">{h.value}</div>
          <div class="bs-pc d">{h.source === 'Auth' ? t('http.headers.auto_auth') : 'auto'}</div>
          <div class="bs-pc m"></div>
        </div>
      {/each}
    {/if}
  </div>
</div>
