<script lang="ts">
  import { t } from '../i18n';
  import ResponseView from './ResponseView.svelte';
  import { busyMap } from '../requestRuntime';
  import { activeEnvironmentId, environments } from '../stores';
  import { responseHint } from '../domain/responseHint';
  import type { Tab } from '../domain/types';

  let {
    tab,
    onResize,
    onResetSize,
    onSettings,
  }: {
    tab: Tab;
    onResize: (e: PointerEvent) => void;
    onResetSize: () => void;
    onSettings: () => void;
  } = $props();

  const sending = $derived(!!$busyMap[tab.id] && $busyMap[tab.id]?.kind !== 'connect');
  // A stream shows its own live feed; the indeterminate bar is for request/response calls.
  const progress = $derived(sending && !tab.grpcStream);
  const envName = $derived($environments.find((e) => e.id === $activeEnvironmentId)?.name);
  const hint = $derived(!sending && tab.protocol === 'http' && tab.response ? responseHint(tab, tab.response, envName, $t) : null);

  function act(kind: 'auth' | 'retry'): void {
    if (kind === 'auth') document.getElementById('bs-rtab-auth')?.click();
    else document.querySelector<HTMLButtonElement>('.bs-send')?.click();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bs-resizer-row" role="separator" aria-orientation="horizontal" aria-label={$t('response.resize')} onpointerdown={onResize} ondblclick={onResetSize}></div>
{#if hint}
  <div class="bs-resp-hint {hint.tone}" role="status">
    <span class="material-symbols-outlined" aria-hidden="true">{hint.icon}</span>
    <span class="text">{hint.text}</span>
    <button type="button" onclick={() => act(hint.action.kind)}>{hint.action.label}</button>
  </div>
{/if}
{#if progress}<div class="bs-resp-progress" aria-hidden="true"><span></span></div>{/if}
<div class="bs-resp" class:sending>
  <ResponseView {tab} {onSettings} />
</div>
