<script lang="ts">
  /**
   * «Запомнить вход?» (Flow · Сессия SE1): under «Сценарий пройден» in the Runner log. The run caught
   * the tokens of a sign-in a collection folder's session uses; «Сохранить сессию» keeps them for the
   * selected environment, so the scenario need not run again.
   */
  import { t } from '$shared/i18n';
  import { nodeName } from '$shared/model';
  import { sessionSpan } from '$entities/request';
  import { saveOffer, sessionOffer, type SessionOffer } from './sessionOffer.svelte';

  let { offer }: { offer: SessionOffer } = $props();

  const target = $derived(offer.targets[offer.pick]);
  const env = $derived(offer.environment || t('runner.noEnv'));
  const cfg = $derived(target.auth.session ?? {});
  const now = Math.floor(Date.now() / 1000);
  const life = (exp: number | null): string =>
    exp === null ? t('session.noExpiry') : t('session.left', { n: sessionSpan(exp - now) });
  const field = (path: string | undefined): string => (path ?? '').replace(/^body\./, '');
  // access always; refresh only when the sign-in gave one
  const tokens = $derived([
    { name: field(cfg.access?.path), from: nodeName(cfg.access?.request), left: life(target.info.accessExp) },
    ...(target.info.hasRefresh && cfg.refresh?.request
      ? [{ name: field(cfg.refresh.path), from: nodeName(cfg.refresh.request), left: life(target.info.refreshExp) }]
      : []),
  ]);
</script>

<div class="offer" class:saved={!!offer.saved}>
  <div class="head">
    <span class="ic"><span class="material-symbols-outlined" aria-hidden="true">key</span></span>
    <div class="ttl">
      <b>{t('sessionrun.runner.title')}</b>
      <small>{t('sessionrun.runner.sub')}</small>
    </div>
  </div>

  <div class="toks">
    {#each tokens as tok (tok.name)}
      <div class="tok">
        <div class="nm">
          <code>{tok.name}</code>
          <small>{t('sessionrun.runner.from', { name: tok.from })}</small>
        </div>
        <span class="life">{tok.left}</span>
      </div>
    {/each}
  </div>

  {#if offer.saved}
    <p class="done" role="status">
      <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>{t('sessionrun.runner.saved', {
        folder: offer.saved,
        env,
      })}
    </p>
  {:else}
    <label class="for">
      <span>{t('sessionrun.runner.for')}</span>
      <select value={offer.pick} onchange={(e) => sessionOffer.update({ pick: Number(e.currentTarget.value) })}>
        {#each offer.targets as o, i (i)}
          <option value={i}>{o.folder} · {env}</option>
        {/each}
      </select>
    </label>
    {#if offer.error}<p class="err" role="alert">{offer.error}</p>{/if}
    <div class="acts">
      <button class="btn quiet" type="button" onclick={() => (sessionOffer.current = null)}
        >{t('sessionrun.runner.later')}</button
      >
      <button class="btn primary" type="button" onclick={() => void saveOffer()}>{t('sessionrun.runner.save')}</button>
    </div>
  {/if}
</div>

<style>
  .offer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border: 1.5px solid var(--color-success);
    border-radius: var(--radius-card);
    background: var(--color-panel);
    font-family: var(--font-ui);
    color: var(--color-text-secondary);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .ic .material-symbols-outlined {
    font-size: 18px;
  }
  .ttl {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .ttl b {
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }
  .ttl small,
  .nm small {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
  }
  .toks {
    display: flex;
    flex-direction: column;
    padding: 4px 12px;
    border-radius: var(--radius-sm);
    background: var(--color-field);
  }
  .tok {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
  }
  .tok + .tok {
    border-top: 1px solid var(--color-border-subtle);
  }
  .nm {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .nm code {
    font-family: var(--font-code);
    font-size: var(--font-size-body);
    color: var(--color-success);
  }
  .life {
    flex: none;
    padding: 2px 8px;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font-size: var(--font-size-caption);
    font-weight: var(--weight-medium);
  }
  .for {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--font-size-body);
    color: var(--color-text-muted);
  }
  .for select {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font: inherit;
  }
  .acts {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .btn {
    height: 32px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-control);
    font: inherit;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
  .btn.quiet {
    background: transparent;
    color: var(--color-text-secondary);
  }
  .btn.quiet:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .btn.primary {
    background: var(--color-action);
    color: var(--color-on-action);
  }
  .done,
  .err {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: var(--font-size-body);
    color: var(--color-success);
  }
  .err {
    color: var(--color-danger);
  }
  .done .material-symbols-outlined {
    font-size: 16px;
  }
</style>
