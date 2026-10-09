<script lang="ts">
  import { t } from '../../i18n';
  import type { HttpEditorTab } from '../../domain/httpEditor';
  import type { Tab } from '../../domain/types';
  import { tablist } from '../../tablist';

  let { tab, uiTab = $bindable() }: { tab: Tab; uiTab: HttpEditorTab } = $props();

  const paramCount = $derived((tab.params ?? []).filter((p) => p.enabled && p.key.trim()).length);
  const headerCount = $derived(Object.keys(tab.request.headers ?? {}).length);
  const scriptCount = $derived(
    (tab.request.preRequestScript?.trim() ? 1 : 0) + (tab.request.testScript?.trim() ? 1 : 0),
  );
</script>

{#snippet rtab(id: HttpEditorTab, label: string, count?: number)}
  <button class="bs-rtab" class:on={uiTab === id} role="tab" id="bs-rtab-{id}" aria-selected={uiTab === id} aria-controls="bs-reqpanel" tabindex={uiTab === id ? 0 : -1} onclick={() => (uiTab = id)}>
    {label}{#if count !== undefined}<span class="bs-tab-count">{count}</span>{/if}
  </button>
{/snippet}

<div class="bs-rtabs">
  <div class="bs-rtabs-list" role="tablist" aria-label={$t('http.tabs.aria')} use:tablist>
    {@render rtab('params', $t('http.tabs.params'), paramCount || undefined)}
    {@render rtab('auth', $t('http.tabs.auth'))}
    {@render rtab('headers', $t('http.tabs.headers'), headerCount || undefined)}
    {@render rtab('body', $t('http.tabs.body'))}
    {@render rtab('scripts', $t('http.tabs.scripts'), scriptCount || undefined)}
  </div>
</div>
