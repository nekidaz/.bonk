<script lang="ts">
  // DV5: Settings → Variables. How {{$dynamic}} values are generated; applies to the next send.
  import { t } from '$shared/i18n';
  import { dynKeepSent, dynLocale, dynPerRequest, dynSeed, dynSeedOn } from '$shared/settings';
  import { dynamicVars, refreshDynamicSamples } from '$entities/environment';
  import { row, sw, number, select, commit } from './ui.svelte';
  import Row from './Row.svelte';

  const LOCALES = $derived([
    { label: t('dyn.locale.ru'), value: 'ru' },
    { label: t('dyn.locale.en'), value: 'en' },
  ]);
  const PREVIEW = ['$randomFullName', '$randomPhoneNumber', '$randomCity'];

  // The preview follows the settings that change the values.
  $effect(() => {
    void [dynLocale.current, dynSeedOn.current, dynSeed.current];
    void refreshDynamicSamples();
  });
</script>

<div class="st-group">{t('settings.vars.group')}</div>
<div class="st-card">
  {#snippet s1()}{@render select(
      t('settings.vars.locale'),
      dynLocale.current,
      LOCALES,
      (v) => (dynLocale.current = v === 'en' ? 'en' : 'ru'),
    )}{/snippet}
  {@render row(t('settings.vars.locale'), t('settings.vars.locale.desc'), s1)}
  {#snippet s2()}{@render sw(
      t('settings.vars.per_request'),
      dynPerRequest.current,
      (v) => (dynPerRequest.current = v),
    )}{/snippet}
  {@render row(t('settings.vars.per_request'), t('settings.vars.per_request.desc'), s2)}
  {#snippet s3()}{@render sw(t('settings.vars.keep'), dynKeepSent.current, (v) => (dynKeepSent.current = v))}{/snippet}
  {@render row(t('settings.vars.keep'), t('settings.vars.keep.desc'), s3)}
  {#snippet s4()}
    <span class="st-seed">
      {#if dynSeedOn.current}{@render number(t('settings.vars.seed'), dynSeed.current, '', 0, 999_999_999, (e) =>
          commit(e, 0, 999_999_999, 42, 1, (n) => (dynSeed.current = n)),
        )}{/if}
      {@render sw(t('settings.vars.seed'), dynSeedOn.current, (v) => (dynSeedOn.current = v))}
    </span>
  {/snippet}
  {@render row(t('settings.vars.seed'), t('settings.vars.seed.desc'), s4)}
</div>

<div class="st-group">{t('settings.vars.preview')}</div>
<div class="st-card st-dyn-preview">
  {#each PREVIEW as name (name)}
    <Row>
      <span class="chip">{`{{${name}}}`}</span>
      <span class="arrow" aria-hidden="true">→</span>
      <span class="value">{dynamicVars.samples[name] ?? ''}</span>
    </Row>
  {/each}
</div>

<style>
  .st-seed {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  :global(:root .st-dyn-preview .st-row) {
    justify-content: flex-start;
    gap: 12px;
  }
  .chip {
    min-width: 190px;
    padding: 1px 5px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--method-patch) 14%, transparent);
    color: var(--method-patch);
    font-family: var(--font-code);
    font-size: 11.5px;
    justify-self: start;
  }
  .arrow {
    color: var(--color-text-muted);
  }
  .value {
    color: var(--color-text);
    font-family: var(--font-code);
    font-size: 12px;
  }
</style>
