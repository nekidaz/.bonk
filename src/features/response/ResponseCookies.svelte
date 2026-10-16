<script lang="ts">
  /**
   * Flow · Cookies, CJ1: the response's Set-Cookies, what each did to the jar, and the way into
   * the jar window.
   */
  import { t, tp } from '$shared/i18n';
  import type { CookieChange, HttpResponse, ResponseCookie } from '$shared/model';
  import { changeCounts, cookieJar, expiryLabel } from '$entities/cookies';
  import RespBody from './RespBody.svelte';

  const { response }: { response: HttpResponse } = $props();

  const now = Date.now();
  const cookies = $derived(response.cookies ?? []);
  const host = $derived.by(() => {
    try {
      return new URL(response.final_url).hostname;
    } catch {
      return '';
    }
  });

  const CHANGE_FORMS: Record<CookieChange, { ru: [string, string, string]; en: [string, string] }> = {
    new: { ru: ['новая', 'новых', 'новых'], en: ['new', 'new'] },
    updated: { ru: ['обновлена', 'обновлены', 'обновлено'], en: ['updated', 'updated'] },
    deleted: { ru: ['удалена', 'удалены', 'удалено'], en: ['deleted', 'deleted'] },
    rejected: { ru: ['отклонена', 'отклонены', 'отклонено'], en: ['rejected', 'rejected'] },
  };
  const cookiesWord = (n: number) => `${n} ${tp(n, ['cookie', 'cookies', 'cookies'], ['cookie', 'cookies'])}`;

  const summary = $derived.by(() => {
    const out: string[] = [];
    const counts = changeCounts(cookies);
    const parts = (Object.keys(counts) as CookieChange[])
      .filter((k) => counts[k] > 0)
      .map((k) => `${k === 'new' ? '+' : ''}${counts[k]} ${tp(counts[k], CHANGE_FORMS[k].ru, CHANGE_FORMS[k].en)}`);
    if (parts.length) out.push(t('cookies.summary.updated', { parts: parts.join(', ') }));
    else if (cookies.length && cookies.every((c) => c.change === null)) out.push(t('cookies.summary.not_saved'));
    if (response.jar_sends != null)
      out.push(
        response.jar_sends
          ? t('cookies.summary.sends', { cookies: cookiesWord(response.jar_sends) })
          : t('cookies.summary.sends_none'),
      );
    return out.join(' ');
  });

  const expiry = (c: ResponseCookie) => {
    const e = expiryLabel(c, now);
    return t(e.key, e.params);
  };
</script>

<RespBody class="rc">
  {#if cookies.length}
    <div class="ctable" role="table" aria-label={t('response.tab.cookies')}>
      <div class="tr th" role="row">
        <span class="c-name" role="columnheader">{t('cookies.col.name')}</span>
        <span class="c-val" role="columnheader">{t('cookies.col.value')}</span>
        <span class="c-dom" role="columnheader">{t('cookies.col.domain')}</span>
        <span class="c-exp" role="columnheader">{t('cookies.col.expires')}</span>
        <span class="c-jar" role="columnheader">{t('cookies.col.jar')}</span>
      </div>
      {#each cookies as c, i (i)}
        <div class="tr" class:dim={c.change === 'deleted' || c.change === 'rejected'} role="row" title={c.raw}>
          <span class="c-name name" role="cell">{c.name}</span>
          <span class="c-val val" role="cell">{c.value}</span>
          <span class="c-dom mono" role="cell">{c.hostOnly ? c.domain : `.${c.domain}`}</span>
          <span class="c-exp" role="cell">{expiry(c)}</span>
          <span class="c-jar" role="cell"
            >{#if c.change}<span class="pill {c.change}">{t(`cookies.change.${c.change}`)}</span>{:else}<span
                class="muted">{t('cookies.change.off')}</span
              >{/if}</span
          >
        </div>
      {/each}
    </div>
  {:else}
    <div class="none">{t('response.no_cookies')}</div>
  {/if}
  {#if summary}
    <div class="bar">
      <span class="material-symbols-outlined" aria-hidden="true">cookie</span>
      <span class="text">{summary}</span>
      <button type="button" onclick={() => cookieJar.open(host || undefined)}>{t('cookies.open_jar')}</button>
    </div>
  {/if}
</RespBody>

<style>
  .rc {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 6px 14px 14px;
    overflow: auto;
    font: var(--font-size-body) var(--font-ui);
  }
  /* Not `.table`: tailwind owns that class (display: table). */
  .ctable {
    min-width: 0;
  }
  .tr {
    display: flex;
    align-items: center;
    min-height: 34px;
    padding: 0 6px;
    border-top: 1px solid var(--color-border-subtle);
  }
  .tr.th {
    min-height: 30px;
    border-top: 0;
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .c-name {
    flex: none;
    width: 18%;
    padding-right: 12px;
  }
  .c-val {
    flex: 1;
    min-width: 0;
    padding-right: 12px;
  }
  .c-dom {
    flex: none;
    width: 18%;
    padding-right: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .c-exp {
    flex: none;
    width: 13%;
    color: var(--color-text-secondary);
  }
  .c-jar {
    flex: none;
    width: 110px;
  }
  .name,
  .val,
  .mono {
    font-family: var(--font-code);
  }
  .name,
  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    color: var(--color-var);
  }
  .c-dom {
    color: var(--color-text-secondary);
  }
  .tr.dim .name,
  .tr.dim .val,
  .tr.dim .c-dom,
  .tr.dim .c-exp {
    color: var(--color-text-muted);
  }
  .pill {
    height: 20px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
  }
  .pill.new {
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .pill.updated {
    background: var(--color-var-soft);
    color: var(--color-var);
  }
  .pill.rejected {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .muted,
  .none {
    color: var(--color-text-muted);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    color: var(--color-text-secondary);
  }
  .bar .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-muted);
  }
  .bar .text {
    flex: 1;
    min-width: 0;
  }
  .bar button {
    flex: none;
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .bar button:hover {
    background: var(--color-hover);
  }
</style>
