<script lang="ts">
  // IM4/IM5/IM9: what the import will create, with the options that shape it. Nothing is written
  // until “Import”.
  import { untrack } from 'svelte';
  import { readOpenApi, type SpecWarning } from '$entities/workspace';
  import { environments } from '$entities/environment';
  import { cookieJar } from '$entities/cookies';
  import { t, tp } from '$shared/i18n';
  import type { AuthConfig, ImportSource } from '$shared/model';
  import PlanTree from './PlanTree.svelte';
  import { importPlan, type ImportResult } from './apply';
  import { HAR_DEFAULTS, harPlan, type HarOptions } from './har';
  import {
    collectionPlan,
    countPlan,
    defaultTargets,
    openApiPlan,
    pruneExcluded,
    requestsIn,
    type EnvTarget,
    type Grouping,
  } from './plan';
  import type { Loaded } from './source';
  import { Segmented, Select, LabelSwitch } from '$shared/ui/components';

  let {
    loaded,
    onBack,
    onDone,
  }: {
    loaded: Loaded;
    onBack: () => void;
    onDone: (r: ImportResult) => void;
  } = $props();

  let name = $state(untrack(() => loaded.title));
  let group = $state<Grouping>('tags');
  let bodies = $state(true);
  let pathVars = $state(true);
  let collectionAuth = $state(true);
  let har = $state<HarOptions>({ ...HAR_DEFAULTS });
  let excluded = $state<Set<string>>(new Set());
  let overrides = $state<Record<string, EnvTarget>>({});
  let busy = $state(false);
  let error = $state('');
  let copied = $state(false);
  let cookiesAdded = $state(false);

  const spec = $derived(
    loaded.format === 'openapi'
      ? readOpenApi(loaded.doc, loaded.origin.name, { bodies, pathVars, collectionAuth })
      : null,
  );
  const harView = $derived(loaded.format === 'har' ? harPlan(loaded.har, har) : null);
  const plan = $derived(
    spec
      ? openApiPlan(spec, group)
      : harView
        ? harView
        : loaded.format !== 'openapi' && loaded.format !== 'har'
          ? collectionPlan(loaded.collection)
          : { title: '', items: [], envRows: [] },
  );
  const all = $derived(requestsIn(plan.items));
  const kept = $derived(pruneExcluded(plan.items, excluded));
  const counts = $derived(countPlan(kept));

  const defaults = $derived(defaultTargets(plan.envRows, environments.list, environments.activeId));
  const targets = $derived(plan.envRows.map((r, i) => overrides[r.key] ?? defaults[i]));
  const newName = (i: number): string => {
    const d = defaults[i];
    return d?.kind === 'new' ? d.name : plan.envRows[i].suggest;
  };
  const targetValue = (x: EnvTarget): string => (x.kind === 'env' ? `env:${x.id}` : x.kind);
  function setTarget(i: number, v: string): void {
    const key = plan.envRows[i].key;
    const x: EnvTarget =
      v === 'skip'
        ? { kind: 'skip' }
        : v === 'new'
          ? { kind: 'new', name: newName(i) }
          : { kind: 'env', id: v.slice(4) };
    overrides = { ...overrides, [key]: x };
  }

  const authText = (a: AuthConfig): string =>
    a.type === 'basic'
      ? 'Basic {{username}}'
      : a.type === 'apiKey'
        ? `${a.apiKeyName}: {{apiKey}}`
        : 'Bearer {{token}}';

  const opName = (key: string): string => all.find((r) => r.key === key)?.node.name ?? key;
  const ops = (keys: string[]): string => keys.slice(0, 2).map(opName).join(', ') + (keys.length > 2 ? '…' : '');
  function warnRow(w: SpecWarning): { tag: string; msg: string; effect: string } {
    if (w.kind === 'ref')
      return {
        tag: '$ref',
        msg: t('import.warn.ref', { ref: w.ref }),
        effect: t('import.warn.ref.e', { ops: ops(w.ops) }),
      };
    if (w.kind === 'variants')
      return {
        tag: 'oneOf',
        msg: t('import.warn.variants', { schema: w.schema, n: w.count }),
        effect: t('import.warn.variants.e', { ops: ops(w.ops) }),
      };
    return {
      tag: 'server',
      msg: t('import.warn.server', { v: `{${w.variable}}`, server: w.server }),
      effect: w.value ? t('import.warn.server.e', { value: w.value }) : t('import.warn.server.none'),
    };
  }
  const warnings = $derived((spec?.warnings ?? []).map(warnRow));

  async function copyReport(): Promise<void> {
    await navigator.clipboard.writeText(warnings.map((w) => `[${w.tag}] ${w.msg} — ${w.effect}`).join('\n'));
    copied = true;
  }

  const cookieDomains = $derived(
    loaded.format === 'har' ? new Set(loaded.har.cookies.map((c) => new URL(c.url).hostname)).size : 0,
  );
  async function addCookies(): Promise<void> {
    if (loaded.format !== 'har') return;
    for (const c of loaded.har.cookies) await cookieJar.paste(c.setCookie, new URL(c.url).hostname);
    cookiesAdded = true;
  }

  const summary = $derived.by(() => {
    if (harView) {
      const total = loaded.format === 'har' ? loaded.har.entries.length : 0;
      return t('import.har.sum', {
        total: `${total} ${tp(total, ['entry', 'entries'])}`,
        requests: `${counts.requests} ${tp(counts.requests, ['request', 'requests'])}`,
        folders: `${counts.folders} ${tp(counts.folders, ['folder', 'folders'])}`,
        skipped: harView.skipped,
      });
    }
    const parts = [
      `${counts.folders} ${tp(counts.folders, ['folder', 'folders'])}`,
      `${counts.requests} ${tp(counts.requests, ['request', 'requests'])}`,
    ];
    const created = targets.flatMap((x) => (x?.kind === 'new' ? [x.name] : []));
    const updated = plan.envRows.flatMap((row, i) => {
      const x = targets[i];
      const env = x?.kind === 'env' ? environments.list.find((e) => e.id === x.id) : undefined;
      return env ? [{ name: env.name, keys: row.vars.map((v) => v.key) }] : [];
    });
    if (created.length) parts.push(t('import.sum.env.new', { names: created.join(', ') }));
    if (updated.length)
      parts.push(
        t('import.sum.env.upd', {
          names: [...new Set(updated.map((u) => u.name))].join(', '),
          keys: [...new Set(updated.flatMap((u) => u.keys))].slice(0, 3).join(', '),
        }),
      );
    return parts.join(' · ');
  });

  async function doImport(): Promise<void> {
    busy = true;
    error = '';
    const o = loaded.origin;
    const source: ImportSource | undefined =
      o.kind === 'paste'
        ? undefined
        : {
            kind: o.kind,
            location: o.location,
            format: loaded.label,
            ...(loaded.version ? { version: loaded.version } : {}),
            options: spec ? { group, bodies, pathVars, collectionAuth } : harView ? { ...har } : {},
          };
    try {
      const res = await importPlan({
        name: name.trim() || plan.title,
        items: kept,
        collectionAuth: spec && collectionAuth ? plan.collectionAuth : undefined,
        envRows: plan.envRows,
        targets,
        source,
      });
      if (res) onDone(res);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet toggle(label: string, sub: string, value: boolean, set: (v: boolean) => void)}
  <label class="imp-row">
    <span class="imp-lbl"><span class="a">{label}</span><span class="b">{sub}</span></span>
    <LabelSwitch>
      <input type="checkbox" role="switch" checked={value} onchange={(e) => set(e.currentTarget.checked)} />
      <span class="track" aria-hidden="true"></span>
    </LabelSwitch>
  </label>
{/snippet}

{#snippet seg(label: string, value: string, options: [string, string][], set: (v: string) => void)}
  <Segmented role="radiogroup" aria-label={label}>
    {#each options as [v, l] (v)}
      <button type="button" role="radio" aria-checked={value === v} class:on={value === v} onclick={() => set(v)}
        >{l}</button
      >
    {/each}
  </Segmented>
{/snippet}

<div class="imp-body split">
  <div class="tree">
    <div class="tree-h">
      <span class="imp-eyebrow">{t('import.willCreate', { n: counts.requests, total: all.length })}</span>
      {#if excluded.size === 0}
        <button type="button" class="imp-link" onclick={() => (excluded = new Set(all.map((r) => r.key)))}
          >{t('import.uncheckAll')}</button
        >
      {:else}
        <button type="button" class="imp-link" onclick={() => (excluded = new Set())}>{t('import.checkAll')}</button>
      {/if}
    </div>
    <div class="tree-scroll"><PlanTree items={plan.items} bind:excluded /></div>
  </div>

  <div class="settings">
    {#if warnings.length}
      <div class="warn">
        <div class="warn-h">
          <span class="material-symbols-outlined">warning</span>
          <span class="a"
            >{t('import.warn.title', {
              n: `${warnings.length} ${tp(warnings.length, ['warning', 'warnings'])}`,
            })}</span
          >
          <button type="button" class="imp-link" onclick={copyReport}
            >{copied ? t('import.warn.copied') : t('import.warn.copy')}</button
          >
        </div>
        {#each warnings as w, i (i)}
          <div class="warn-r">
            <span class="tag">{w.tag}</span>
            <span class="wm"><span class="msg">{w.msg}</span><span class="eff">{w.effect}</span></span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="imp-eyebrow">{t('import.sec.collection')}</div>
    <div class="imp-card">
      <label class="imp-row">
        <span class="imp-lbl"><span class="a">{t('import.name')}</span></span>
        <input class="imp-input" bind:value={name} spellcheck="false" />
      </label>
      {#if spec}
        <div class="imp-row">
          <span class="imp-lbl"
            ><span class="a">{t('import.group')}</span><span class="b">{t('import.group.sub')}</span></span
          >
          {@render seg(
            t('import.group'),
            group,
            [
              ['tags', t('import.group.tags')],
              ['paths', t('import.group.paths')],
              ['flat', t('import.group.flat')],
            ],
            (v) => (group = v as Grouping),
          )}
        </div>
      {/if}
    </div>

    {#if harView}
      <div class="imp-eyebrow">{t('import.har.what')}</div>
      <div class="imp-card">
        <div class="imp-row">
          <span class="imp-lbl"><span class="a">{t('import.har.types')}</span></span>
          {@render seg(
            t('import.har.types'),
            har.types,
            [
              ['api', t('import.har.api')],
              ['doc', t('import.har.doc')],
              ['all', t('import.har.all')],
            ],
            (v) => (har = { ...har, types: v as HarOptions['types'] }),
          )}
        </div>
        {@render toggle(
          t('import.har.statics'),
          t('import.har.statics.sub'),
          har.statics,
          (v) => (har = { ...har, statics: v }),
        )}
        {@render toggle(
          t('import.har.okOnly'),
          t('import.har.okOnly.sub'),
          har.okOnly,
          (v) => (har = { ...har, okOnly: v }),
        )}
      </div>
      <div class="imp-eyebrow">{t('import.har.how')}</div>
      <div class="imp-card">
        {@render toggle(
          t('import.har.merge'),
          t('import.har.merge.sub'),
          har.merge,
          (v) => (har = { ...har, merge: v }),
        )}
        {@render toggle(
          t('import.har.byDomain'),
          t('import.har.byDomain.sub', {
            host: plan.items[0]?.kind === 'folder' ? plan.items[0].name : 'api.example.com',
          }),
          har.byDomain,
          (v) => (har = { ...har, byDomain: v }),
        )}
        {@render toggle(
          t('import.har.baseUrl'),
          t('import.har.baseUrl.sub', { origin: plan.envRows[0]?.label ?? '' }),
          har.baseUrl,
          (v) => (har = { ...har, baseUrl: v }),
        )}
        {@render toggle(
          t('import.har.strip'),
          t('import.har.strip.sub'),
          har.strip,
          (v) => (har = { ...har, strip: v }),
        )}
      </div>
    {/if}

    {#if plan.envRows.length}
      <div class="imp-eyebrow">{spec ? t('import.sec.servers') : t('import.sec.vars')}</div>
      <div class="imp-card">
        {#each plan.envRows as row, i (row.key)}
          <div class="imp-row">
            <span class="srv">{row.label}</span>
            <span class="material-symbols-outlined arr">arrow_forward</span>
            <Select
              class={{ new: targets[i]?.kind === 'new' }}
              aria-label={row.label}
              value={targetValue(targets[i])}
              onchange={(e) => setTarget(i, e.currentTarget.value)}
            >
              {#each environments.list as env (env.id)}<option value="env:{env.id}">{env.name}</option>{/each}
              <option value="new">{t('import.env.new', { name: newName(i) })}</option>
              <option value="skip">{t('import.env.skip')}</option>
            </Select>
          </div>
        {/each}
      </div>
      {#if spec || harView}
        <div class="baseurl">
          {t('import.baseUrl.a')} <span class="var">{'{{baseUrl}}'}</span>
          {spec && plan.envRows.length > 1 ? t('import.baseUrl.b') : ''}
        </div>
      {/if}
    {/if}

    {#if spec}
      <div class="imp-eyebrow">{t('import.sec.requests')}</div>
      <div class="imp-card">
        {#if spec.collectionAuth}
          {@render toggle(
            t('import.opt.auth', { scheme: spec.collectionAuth.scheme }),
            t('import.opt.auth.sub', { auth: authText(spec.collectionAuth.auth) }),
            collectionAuth,
            (v) => (collectionAuth = v),
          )}
        {/if}
        {@render toggle(t('import.opt.bodies'), t('import.opt.bodies.sub'), bodies, (v) => (bodies = v))}
        {@render toggle(t('import.opt.pathVars'), t('import.opt.pathVars.sub'), pathVars, (v) => (pathVars = v))}
      </div>
    {/if}

    {#if loaded.format === 'har' && loaded.har.cookies.length}
      <div class="cookies">
        <span class="material-symbols-outlined">cookie</span>
        <span class="ct"
          >{t('import.har.cookies', {
            n: `${loaded.har.cookies.length} ${tp(loaded.har.cookies.length, ['cookie', 'cookies'])}`,
            d: `${cookieDomains} ${tp(cookieDomains, ['domain', 'domains'])}`,
          })}</span
        >
        {#if cookiesAdded}
          <span class="done">{t('import.har.cookies.added')}</span>
        {:else}
          <button type="button" class="imp-link strong" onclick={addCookies}>{t('import.har.cookies.add')}</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<div class="imp-foot">
  <span class="note" class:bad={!!error}>{error || summary}</span>
  <button type="button" class="imp-btn" onclick={onBack}>{t('import.back')}</button>
  <button type="button" class="imp-btn primary" disabled={busy || counts.requests === 0} onclick={doImport}>
    {busy ? t('import.importing') : t('import.do', { n: counts.requests })}
  </button>
</div>

<style>
  .tree {
    flex: 0 0 41%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 18px 16px 12px 16px;
    background: var(--color-panel);
  }
  .tree-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px 10px;
  }
  .tree-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .settings {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 28px 18px 28px;
    overflow: auto;
  }
  .settings > :global(*) {
    flex: none;
  }
  .settings .imp-eyebrow {
    margin-top: 6px;
  }
  .srv {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font: var(--font-size-ui) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arr {
    flex: none;
    font-size: 15px;
    color: var(--color-text-muted);
  }
  :global(:root .st-select) {
    width: 210px;
    min-width: 0;
  }
  :global(:root .st-select.new) {
    color: var(--color-success);
  }
  .baseurl {
    color: var(--color-text-muted);
    font: var(--font-size-body) / 22px var(--font-ui);
  }
  .var {
    padding: 2px 8px;
    border-radius: var(--radius-control);
    background: var(--color-var-soft);
    color: var(--color-var);
    font-family: var(--font-code);
  }
  .warn {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 18px;
    border-radius: var(--radius-card);
    background: var(--color-warning-soft);
  }
  .warn-h {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .warn-h .material-symbols-outlined {
    font-size: 17px;
    color: var(--color-warning);
  }
  .warn-h .a {
    flex: 1;
    font: var(--weight-medium) var(--font-size-ui) var(--font-ui);
  }
  .warn-r {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding-left: 25px;
  }
  .tag {
    flex: none;
    min-width: 56px;
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font: var(--font-size-body) / 20px var(--font-code);
    text-align: center;
  }
  .wm {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .msg {
    font: var(--font-size-body) / 20px var(--font-code);
    overflow-wrap: anywhere;
  }
  .eff {
    color: var(--color-text-secondary);
    font: var(--font-size-body) / 18px var(--font-ui);
  }
  .cookies {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--radius-card);
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font: var(--font-size-body) / 18px var(--font-ui);
  }
  .cookies .material-symbols-outlined {
    font-size: 17px;
  }
  .ct {
    flex: 1;
  }
  .done {
    color: var(--color-success);
  }
</style>
