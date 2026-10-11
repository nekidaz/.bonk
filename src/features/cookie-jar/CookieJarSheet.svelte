<script lang="ts">
  /**
   * Flow · Cookies, CJ2–CJ5: the workspace's cookie jar. Domains on the left, their cookies on
   * the right; a row opens an inline editor (CJ3). Changes go straight to the jar (no draft),
   * «Очистить всё» asks once (CJ4). Layout follows the Environments sheet (S31).
   */
  import { tick, untrack } from 'svelte';
  import { t, tp } from '$shared/i18n';
  import ExpiryPicker from './ExpiryPicker.svelte';
  import type { CookieInfo } from '$shared/model';
  import {
    cookieJar,
    cookieJarKey,
    type CookieDraft,
    domainGroups,
    draftOf,
    emptyDraft,
    expiryLabel,
    pastedDomain,
    sameCookie,
    type SameSite,
    setCookieOf,
  } from '$entities/cookies';

  const { onCleared }: { onCleared: (text: string) => void } = $props();

  const SAME_SITE: SameSite[] = ['Strict', 'Lax', 'None'];

  let query = $state('');
  /** Selected domain; '' = a new domain being typed into the editor. */
  let selected = $state<string | null>(null);
  /** The open editor: `original` null = a new cookie. */
  let editing = $state<{ original: CookieInfo | null; draft: CookieDraft } | null>(null);
  let error = $state('');
  let confirmOpen = $state(false);
  let keepLocal = $state(false);
  let pasteOpen = $state(false);
  let pasteText = $state('');
  /** The expiry picker (CJ7) is open: Escape closes it first. */
  let expiryOpen = $state(false);
  let opener: HTMLElement | null = null;
  let searchInput = $state<HTMLInputElement | null>(null);
  let nameInput = $state<HTMLInputElement | null>(null);
  let pasteInput = $state<HTMLTextAreaElement | null>(null);
  let now = $state(Date.now());

  const cookies = $derived(cookieJar.list);
  const groups = $derived(domainGroups(cookies, query));
  const allDomains = $derived(new Set(cookies.map((c) => c.domain)));
  const rows = $derived(selected ? cookies.filter((c) => c.domain === selected) : []);
  const wsName = $derived(cookieJarKey().split(/[/\\]/).filter(Boolean).at(-1) ?? '');
  const cookiesWord = (n: number) => `${n} ${tp(n, ['cookie', 'cookies', 'cookies'], ['cookie', 'cookies'])}`;
  const kicker = $derived(
    [wsName, t(wsName ? 'cookies.kicker.workspace' : 'cookies.kicker.app'), cookiesWord(cookies.length)]
      .filter(Boolean)
      .join('  ·  '),
  );
  const pasteDomain = $derived(pastedDomain(pasteText, selected ?? ''));

  // Seed on open: the asked-for domain, else the first one.
  $effect(() => {
    if (!cookieJar.sheetOpen) return;
    untrack(() => {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      query = '';
      editing = null;
      error = '';
      confirmOpen = false;
      pasteOpen = false;
      now = Date.now();
      selected = cookieJar.focusDomain;
    });
    void tick().then(() => searchInput?.focus());
  });

  // Keep a real domain selected as the jar changes (a deleted domain falls back to the first).
  $effect(() => {
    const domains = allDomains;
    untrack(() => {
      if (selected === '' || (selected && domains.has(selected))) return;
      selected = cookies[0]?.domain ?? null;
    });
  });

  function close(): void {
    cookieJar.sheetOpen = false;
    void tick().then(() => opener?.focus());
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!cookieJar.sheetOpen || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (expiryOpen) expiryOpen = false;
    else if (confirmOpen) confirmOpen = false;
    else if (pasteOpen) pasteOpen = false;
    else if (editing) cancelEdit();
    else close();
  }

  function select(domain: string): void {
    selected = domain;
    editing = null;
    error = '';
    pasteOpen = false;
  }

  async function startEdit(original: CookieInfo | null, draft: CookieDraft): Promise<void> {
    editing = { original, draft };
    error = '';
    pasteOpen = false;
    await tick();
    nameInput?.focus();
  }

  const toggleRow = (c: CookieInfo) =>
    editing?.original && sameCookie(editing.original, c) ? cancelEdit() : void startEdit(c, draftOf(c));

  function cancelEdit(): void {
    if (selected === '') selected = cookies[0]?.domain ?? null;
    editing = null;
    error = '';
  }

  function addDomain(): void {
    query = '';
    selected = '';
    void startEdit(null, emptyDraft(''));
  }

  function patch(p: Partial<CookieDraft>): void {
    if (editing) editing = { ...editing, draft: { ...editing.draft, ...p } };
  }

  async function save(): Promise<void> {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim()) return void (error = t('cookies.error.name'));
    if (!d.domain.trim()) return void (error = t('cookies.error.domain'));
    try {
      await cookieJar.save(d, editing.original ?? undefined);
      selected = d.domain.trim();
      editing = null;
      error = '';
    } catch (err) {
      error = String(err);
    }
  }

  async function remove(c: CookieInfo): Promise<void> {
    try {
      await cookieJar.remove(c);
      if (editing?.original && sameCookie(editing.original, c)) editing = null;
    } catch (err) {
      error = String(err);
    }
  }

  async function removeDomain(): Promise<void> {
    if (!selected) return;
    try {
      await cookieJar.removeDomain(selected);
      editing = null;
    } catch (err) {
      error = String(err);
    }
  }

  async function openPaste(): Promise<void> {
    editing = null;
    error = '';
    pasteText = '';
    pasteOpen = true;
    await tick();
    pasteInput?.focus();
  }

  async function savePaste(): Promise<void> {
    if (!pasteDomain) return void (error = t('cookies.paste.need_domain'));
    try {
      await cookieJar.paste(pasteText, pasteDomain);
      selected = pasteDomain;
      pasteOpen = false;
      error = '';
    } catch (err) {
      error = String(err);
    }
  }

  async function clearAll(): Promise<void> {
    try {
      const n = await cookieJar.clear(keepLocal);
      confirmOpen = false;
      editing = null;
      onCleared(t('cookies.cleared', { cookies: cookiesWord(n) }));
    } catch (err) {
      confirmOpen = false;
      error = String(err);
    }
  }

  const expiry = (c: Pick<CookieInfo, 'expiresMs' | 'expired'>) => {
    const e = expiryLabel(c, now);
    return t(e.key, e.params);
  };

  const flags = (c: CookieInfo): string[] =>
    [c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite].filter((f): f is string => !!f);

  const clearBody = $derived(
    t('cookies.clear.body', {
      cookies: cookiesWord(cookies.length),
      domains: `${allDomains.size} ${tp(allDomains.size, ['домене', 'доменах', 'доменах'], ['domain', 'domains'])}`,
      scope: wsName ? t('cookies.clear.scope_ws', { name: wsName }) : t('cookies.clear.scope_app'),
    }),
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if cookieJar.sheetOpen}
  <div
    class="bs-overlay bs-jar-overlay"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div class="bs-modal bs-jar" role="dialog" aria-modal="true" aria-labelledby="bs-jar-title">
      <header class="head">
        <div>
          <div class="kicker">{kicker}</div>
          <h2 id="bs-jar-title">{t('cookies.title')}</h2>
        </div>
        <button class="icon" type="button" aria-label={t('common.close')} onclick={close}
          ><span class="material-symbols-outlined" aria-hidden="true">close</span></button
        >
      </header>

      <div class="body">
        <aside class="list">
          <label class="search">
            <span class="material-symbols-outlined" aria-hidden="true">search</span>
            <input
              bind:this={searchInput}
              bind:value={query}
              placeholder={t('cookies.search')}
              aria-label={t('cookies.search')}
            />
          </label>
          <div class="items">
            {#each groups as g (g.domain)}
              <button class="item" class:on={selected === g.domain} type="button" onclick={() => select(g.domain)}>
                <span class="material-symbols-outlined lead" aria-hidden="true"
                  >{g.local ? 'computer' : 'language'}</span
                >
                <span class="label">{g.domain}</span>
                <span class="count">{g.count}</span>
              </button>
            {:else}
              <div class="none">{t(cookies.length ? 'cookies.no_match' : 'cookies.no_domains')}</div>
            {/each}
            {#if selected === ''}
              <div class="item on">
                <span class="material-symbols-outlined lead" aria-hidden="true">language</span>
                <span class="label">{editing?.draft.domain || t('cookies.new_domain')}</span>
              </div>
            {/if}
          </div>
          <button class="add" type="button" onclick={addDomain}
            ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('cookies.add_domain')}</button
          >
        </aside>

        <section class="detail">
          {#if pasteOpen}
            <div class="paste">
              <div class="eyebrow">{t('cookies.paste.label')}</div>
              <textarea
                bind:this={pasteInput}
                bind:value={pasteText}
                rows="3"
                spellcheck="false"
                placeholder={t('cookies.paste.placeholder')}
                aria-label={t('cookies.paste.label')}></textarea>
              <div class="actions">
                <span class="hint"
                  >{pasteDomain
                    ? t('cookies.paste.hint', { domain: pasteDomain })
                    : t('cookies.paste.need_domain')}</span
                >
                <button class="bs-btn ghost" type="button" onclick={() => (pasteOpen = false)}
                  >{t('common.cancel')}</button
                >
                <button class="bs-btn primary" type="button" disabled={!pasteText.trim()} onclick={savePaste}
                  >{t('cookies.save')}</button
                >
              </div>
              {#if error}<div class="error" role="alert">{error}</div>{/if}
            </div>
          {:else if selected === null}
            <div class="empty">
              <span class="badge-icon"><span class="material-symbols-outlined" aria-hidden="true">cookie</span></span>
              <h3>{t('cookies.empty.title')}</h3>
              <p>{t('cookies.empty.body')}</p>
              <div class="empty-actions">
                <button class="solid" type="button" onclick={addDomain}
                  ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('cookies.empty.add')}</button
                >
                <button class="quiet" type="button" onclick={openPaste}
                  ><span class="material-symbols-outlined" aria-hidden="true">content_paste</span>{t(
                    'cookies.paste',
                  )}</button
                >
              </div>
            </div>
          {:else}
            <div class="titlebar">
              <h3 class="domain">{selected || t('cookies.new_domain')}</h3>
              {#if selected}<span class="tag">{cookiesWord(rows.length)}</span>{/if}
              <div class="grow"></div>
              {#if selected}
                <button class="quiet" type="button" onclick={() => void startEdit(null, emptyDraft(selected ?? ''))}
                  ><span class="material-symbols-outlined" aria-hidden="true">add</span>{t('cookies.add')}</button
                >
                <button
                  class="icon"
                  type="button"
                  title={t('cookies.paste')}
                  aria-label={t('cookies.paste')}
                  onclick={openPaste}
                  ><span class="material-symbols-outlined" aria-hidden="true">content_paste</span></button
                >
                <button class="quiet" type="button" onclick={removeDomain}
                  ><span class="material-symbols-outlined" aria-hidden="true">delete</span>{t(
                    'cookies.delete_domain',
                  )}</button
                >
              {/if}
            </div>
            {#if selected}
              <p class="sub">
                {t(rows.every((c) => c.hostOnly) ? 'cookies.sends.exact' : 'cookies.sends.subdomains', {
                  domain: selected,
                })}
              </p>
            {/if}

            <div class="ctable" role="table" aria-label={t('cookies.title')}>
              <div class="tr th" role="row">
                <span class="c-name" role="columnheader">{t('cookies.col.name')}</span>
                <span class="c-val" role="columnheader">{t('cookies.col.value')}</span>
                <span class="c-path" role="columnheader">{t('cookies.col.path')}</span>
                <span class="c-exp" role="columnheader">{t('cookies.col.expires')}</span>
                <span class="c-flags" role="columnheader">{t('cookies.col.flags')}</span>
                <span class="c-act" role="columnheader"></span>
              </div>
              <div class="rows">
                {#if editing && !editing.original}{@render editor()}{/if}
                {#each rows as c (`${c.path}\u0000${c.name}`)}
                  {@const open = !!editing?.original && sameCookie(editing.original, c)}
                  <div class="tr" class:dim={c.expired} class:open role="row">
                    <button
                      class="rowbtn"
                      type="button"
                      aria-expanded={open}
                      aria-label={t('cookies.edit_aria', { name: c.name })}
                      onclick={() => toggleRow(c)}
                    ></button>
                    <span class="c-name name" role="cell">{c.name}</span>
                    <span class="c-val val" role="cell">{c.value}</span>
                    <span class="c-path mono" role="cell">{c.path}</span>
                    <span class="c-exp" role="cell"
                      >{#if c.expired}<span class="pill warn">{expiry(c)}</span>{:else}{expiry(c)}{/if}</span
                    >
                    <span class="c-flags" role="cell">
                      {#if c.expired}<span class="muted">{t('cookies.not_sent')}</span
                        >{:else}{#each flags(c) as f (f)}<span class="pill">{f}</span>{:else}<span class="muted">—</span
                          >{/each}{/if}
                    </span>
                    <span class="c-act" role="cell">
                      {#if open}<span class="material-symbols-outlined chev" aria-hidden="true">expand_less</span
                        >{:else}<button
                          class="icon sm"
                          type="button"
                          aria-label={t('cookies.delete_aria', { name: c.name })}
                          onclick={() => void remove(c)}
                          ><span class="material-symbols-outlined" aria-hidden="true">delete</span></button
                        >{/if}
                    </span>
                  </div>
                  {#if open}{@render editor()}{/if}
                {/each}
              </div>
            </div>
            {#if error && !editing}<div class="error" role="alert">{error}</div>{/if}
          {/if}
        </section>
      </div>

      <footer class="foot">
        <span class="note">{cookieJar.path ? t('cookies.storage', { path: cookieJar.path }) : ''}</span>
        <button
          class="bs-btn danger-soft"
          type="button"
          disabled={!cookies.length}
          onclick={() => {
            keepLocal = false;
            confirmOpen = true;
          }}
          ><span class="material-symbols-outlined" aria-hidden="true">delete_sweep</span>{t(
            'cookies.clear_all',
          )}</button
        >
        <button class="bs-btn primary" type="button" onclick={close}>{t('cookies.done')}</button>
      </footer>

      {#if confirmOpen}
        <div class="confirm-scrim" role="presentation">
          <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="bs-jar-clear-title">
            <span class="badge-icon danger"
              ><span class="material-symbols-outlined" aria-hidden="true">delete_sweep</span></span
            >
            <h3 id="bs-jar-clear-title">{t('cookies.clear.title')}</h3>
            <p>{clearBody}</p>
            <label class="keep">
              <input class="round" type="checkbox" bind:checked={keepLocal} />{t('cookies.clear.keep_local')}
            </label>
            <div class="actions">
              <button class="bs-btn ghost" type="button" onclick={() => (confirmOpen = false)}
                >{t('common.cancel')}</button
              >
              <button class="bs-btn danger" type="button" onclick={clearAll}>{t('cookies.clear_all')}</button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#snippet editor()}
  {#if editing}
    {@const d = editing.draft}
    <form
      class="editor"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="grid top">
        <label class="f"
          ><span class="eyebrow">{t('cookies.col.name')}</span><input
            bind:this={nameInput}
            class="mono"
            value={d.name}
            spellcheck="false"
            oninput={(e) => patch({ name: e.currentTarget.value })}
          /></label
        >
        <label class="f"
          ><span class="eyebrow">{t('cookies.col.value')}</span><input
            class="mono"
            value={d.value}
            spellcheck="false"
            oninput={(e) => patch({ value: e.currentTarget.value })}
          /></label
        >
      </div>
      <div class="grid mid">
        <label class="f"
          ><span class="eyebrow">{t('cookies.col.domain')}</span><input
            class="mono"
            value={d.domain}
            spellcheck="false"
            oninput={(e) => patch({ domain: e.currentTarget.value })}
          /></label
        >
        <label class="f"
          ><span class="eyebrow">{t('cookies.col.path')}</span><input
            class="mono"
            value={d.path}
            spellcheck="false"
            oninput={(e) => patch({ path: e.currentTarget.value })}
          /></label
        >
        <div class="f">
          <span class="eyebrow">{t('cookies.col.expires')}</span>
          <ExpiryPicker
            expiresMs={d.expiresMs}
            maxAge={d.maxAge ?? null}
            bind:open={expiryOpen}
            onchange={(p) => patch(p)}
          />
        </div>
        <div class="f">
          <span class="eyebrow">SameSite</span>
          <div class="seg" role="radiogroup" aria-label="SameSite">
            {#each SAME_SITE as s (s)}
              <button
                type="button"
                role="radio"
                aria-checked={d.sameSite === s}
                class:on={d.sameSite === s}
                onclick={() => patch({ sameSite: d.sameSite === s ? null : s })}>{s}</button
              >
            {/each}
          </div>
        </div>
      </div>
      <div class="flagsrow">
        <label class="keep mono"
          ><input
            class="round"
            type="checkbox"
            checked={d.httpOnly}
            onchange={(e) => patch({ httpOnly: e.currentTarget.checked })}
          />HttpOnly</label
        >
        <label class="keep mono"
          ><input
            class="round"
            type="checkbox"
            checked={d.secure}
            onchange={(e) => patch({ secure: e.currentTarget.checked })}
          />Secure</label
        >
        <div class="grow"></div>
        <span class="eyebrow">Set-Cookie</span>
      </div>
      <code class="raw">{setCookieOf(d)}</code>
      {#if error}<div class="error" role="alert">{error}</div>{/if}
      <div class="actions">
        {#if editing.original}
          {@const original = editing.original}
          <button class="danger-link" type="button" onclick={() => void remove(original)}
            ><span class="material-symbols-outlined" aria-hidden="true">delete</span>{t('cookies.delete')}</button
          >
        {/if}
        <div class="grow"></div>
        <button class="bs-btn ghost" type="button" onclick={cancelEdit}>{t('common.cancel')}</button>
        <button class="bs-btn primary" type="submit">{t('cookies.save')}</button>
      </div>
    </form>
  {/if}
{/snippet}

<style>
  /* Sizes follow the CJ2 mock (Pencil node «Cookie jar»), the same frame as the S31 sheet. */
  /* Above Settings: «Открыть банку» there opens it on top. */
  .bs-jar-overlay.bs-jar-overlay {
    z-index: 101;
    background: var(--color-scrim);
  }
  .bs-jar.bs-jar {
    position: relative;
    width: 1040px;
    max-width: 100%;
    height: 660px;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform: translateY(10px);
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .head {
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    height: 73px;
    padding: 18px 16px 16px 24px;
  }
  .kicker,
  .eyebrow {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  h2 {
    margin: 4px 0 0;
    font: 600 18px/22px var(--font-ui);
  }
  .icon {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }
  .head .icon {
    margin-top: 4px;
  }
  .icon:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .icon .material-symbols-outlined {
    font-size: 17px;
  }
  .icon.sm {
    width: 24px;
    height: 24px;
  }
  .icon.sm .material-symbols-outlined {
    font-size: 15px;
    color: var(--color-text-muted);
  }
  .mono {
    font-family: var(--font-code);
  }
  .grow {
    flex: 1;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .list {
    flex: none;
    width: 260px;
    display: flex;
    flex-direction: column;
    padding: 10px;
    background: var(--color-panel);
  }
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    margin-bottom: 10px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }
  .search .material-symbols-outlined {
    font-size: 15px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .search input::placeholder {
    color: var(--color-text-muted);
  }
  .items {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: var(--font-size-ui) var(--font-code);
    text-align: left;
  }
  .item:hover {
    background: var(--color-hover);
  }
  .item.on {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 600;
  }
  .item .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item .lead {
    font-size: 14px;
    color: var(--color-text-muted);
  }
  .item .count {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
  }
  .none {
    padding: 4px 6px;
    color: var(--color-text-muted);
    font: var(--font-size-ui) var(--font-ui);
  }
  .add {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    margin-top: 2px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .add:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .add .material-symbols-outlined {
    font-size: 15px;
  }

  .detail {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 24px;
    overflow: auto;
  }
  .titlebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
  }
  .domain {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 20px/27px var(--font-code);
  }
  .tag {
    flex: none;
    height: 22px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
  }
  .quiet,
  .solid {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .quiet:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .solid {
    background: var(--color-field);
    color: var(--color-text);
  }
  .solid:hover {
    background: var(--color-hover-strong);
  }
  .quiet .material-symbols-outlined,
  .solid .material-symbols-outlined {
    font-size: 16px;
  }
  .sub {
    flex: none;
    margin: -4px 0 0;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
  }

  /* Not `.table`: tailwind owns that class (display: table). */
  .ctable {
    flex: none;
    min-width: 0;
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .tr {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 38px;
    padding: 0 10px 0 14px;
    border-top: 1px solid var(--color-border-subtle);
  }
  .tr:not(.th):hover,
  .tr.open {
    background: var(--color-hover);
  }
  .tr.th {
    min-height: 32px;
    border-top: 0;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  /* The whole row opens the editor; the delete button sits above it. */
  .rowbtn {
    position: absolute;
    inset: 0;
    border-radius: 0;
  }
  .rowbtn:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: -2px;
  }
  .tr > [role='cell'] {
    pointer-events: none;
  }
  .tr .c-act {
    pointer-events: auto;
    position: relative;
  }
  .c-name {
    flex: none;
    width: 22%;
    padding-right: 12px;
  }
  .c-val {
    flex: 1;
    min-width: 0;
    padding-right: 12px;
  }
  .c-path {
    flex: none;
    width: 64px;
  }
  .c-exp {
    flex: none;
    width: 112px;
  }
  .c-flags {
    flex: none;
    width: 190px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .c-act {
    flex: none;
    width: 28px;
    display: flex;
    justify-content: flex-end;
  }
  .name,
  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-code);
  }
  .name {
    color: var(--color-var);
  }
  .tr.dim .name,
  .tr.dim .val,
  .tr.dim .c-path {
    color: var(--color-text-muted);
  }
  .pill {
    height: 18px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-xs);
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font: var(--font-size-micro) var(--font-code);
  }
  .pill.warn {
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font-family: var(--font-ui);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .tr .icon.sm {
    opacity: 0;
  }
  .tr:hover .icon.sm,
  .tr:focus-within .icon.sm {
    opacity: 1;
  }
  .chev {
    font-size: 16px;
    color: var(--color-text-muted);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-raised);
  }
  .grid {
    display: grid;
    gap: 12px;
  }
  /* minmax(0, …): inputs have an intrinsic width that would otherwise widen the sheet. */
  .grid.top {
    grid-template-columns: minmax(0, 2fr) minmax(0, 5fr);
  }
  .grid.mid {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 2.4fr) auto;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .f input {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
  .f input:focus-visible,
  .paste textarea:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 0;
  }
  .seg {
    display: flex;
    gap: 2px;
    height: 32px;
    padding: 3px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
  }
  .seg button {
    padding: 0 10px;
    border-radius: calc(var(--radius-control) - 2px);
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-code);
  }
  .seg button.on {
    background: var(--color-selected);
    color: var(--color-text);
  }
  .flagsrow {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .keep {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text);
    font-size: var(--font-size-ui);
    cursor: pointer;
  }
  .round {
    appearance: none;
    flex: none;
    width: 18px;
    height: 18px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: transparent;
  }
  .round:checked {
    border-color: var(--color-text);
    background: var(--color-text);
  }
  .round:checked::after {
    content: '';
    width: 8px;
    height: 4px;
    margin-top: -2px;
    border: solid var(--color-raised);
    border-width: 0 0 2px 2px;
    transform: rotate(-45deg);
  }
  .round:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
  }
  .raw {
    display: block;
    padding: 10px 14px;
    overflow-x: auto;
    white-space: pre;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-code);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .danger-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--color-danger);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .danger-link:hover {
    background: var(--color-danger-soft);
  }
  .danger-link .material-symbols-outlined {
    font-size: 16px;
  }
  .error {
    color: var(--color-danger);
    font: var(--font-size-body) var(--font-ui);
  }

  .paste {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .paste textarea {
    resize: vertical;
    padding: 10px 14px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
  .hint {
    flex: 1;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }
  .badge-icon {
    width: 48px;
    height: 48px;
    display: inline-grid;
    place-content: center;
    border-radius: 50%;
    background: var(--color-panel);
    color: var(--color-text-secondary);
  }
  .badge-icon .material-symbols-outlined {
    font-size: 20px;
  }
  .empty h3,
  .confirm h3 {
    margin: 8px 0 0;
    font: 600 var(--font-size-title) var(--font-ui);
  }
  .empty p {
    max-width: 420px;
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .empty-actions {
    display: flex;
    gap: 12px;
    margin-top: 12px;
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 58px;
    padding: 12px 16px 12px 24px;
  }
  .note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }
  .bs-jar :global(.bs-btn) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .bs-jar :global(.bs-btn .material-symbols-outlined) {
    font-size: 16px;
  }
  .bs-jar :global(.bs-btn.ghost) {
    background: var(--color-panel);
    color: var(--color-text);
  }
  .bs-jar :global(.bs-btn.primary) {
    background: var(--color-action);
    color: var(--color-on-action);
    font-weight: 600;
  }
  .bs-jar :global(.bs-btn.danger-soft) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .bs-jar :global(.bs-btn.danger) {
    background: var(--color-danger);
    color: var(--color-on-action);
    font-weight: 600;
  }
  .bs-jar :global(.bs-btn:disabled) {
    opacity: 0.45;
  }

  /* CJ4: one confirmation over the sheet. */
  .confirm-scrim {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    background: var(--color-scrim);
  }
  .confirm {
    width: 400px;
    max-width: calc(100% - 32px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 24px;
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: var(--shadow-panel);
  }
  .badge-icon.danger {
    width: 40px;
    height: 40px;
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .confirm h3 {
    margin: 6px 0 0;
  }
  .confirm p {
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .confirm .keep {
    height: 40px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
  }
  .confirm .actions {
    justify-content: flex-end;
    margin-top: 6px;
  }
</style>
