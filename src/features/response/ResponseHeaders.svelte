<script lang="ts">
  /** Response headers (and gRPC metadata / trailers) as a name · value table, styled like the Cookies tab. */
  import { t } from '$shared/i18n';
  import RespBody from './RespBody.svelte';

  const { entries }: { entries: [string, string][] } = $props();
</script>

<RespBody>
  {#if entries.length}
    <div class="htable" role="table" aria-label={t('response.tab.headers')}>
      {#each entries as [k, v], i (i)}
        <div class="tr" role="row">
          <span class="name" role="cell">{k}</span>
          <span class="val" role="cell">{v}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="none">{t('response.no_headers')}</div>
  {/if}
</RespBody>

<style>
  .htable {
    font: var(--font-size-body) / 20px var(--font-code);
  }
  .tr {
    display: flex;
    gap: 16px;
    padding: 7px 6px;
    border-top: 1px solid var(--color-border-subtle);
  }
  .tr:first-child {
    border-top: 0;
  }
  .tr:hover {
    background: var(--color-hover);
  }
  .name {
    flex: none;
    width: 30%;
    max-width: 260px;
    color: var(--color-var);
    overflow-wrap: anywhere;
  }
  .val {
    flex: 1;
    min-width: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
  }
  .none {
    color: var(--color-text-muted);
    font-family: var(--font-ui);
  }
</style>
