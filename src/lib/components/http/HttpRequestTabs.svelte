<script lang="ts">
  import { t } from '../../i18n';
  import type { HttpEditorTab } from '../../domain/httpEditor';
  import type { Tab } from '../../domain/types';
  import { tablist } from '../../tablist';
  import { formatBytes } from '../../domain/http';
  import { currentBodyMode, currentRawFormat } from '../../domain/httpBody';
  import { applyBodyKind, beautify, bodyKindOf, BEAUTIFY_MAX_CHARS, isLargeBody, OTHER_KINDS, RAW_KINDS, textStats, type BodyKind } from '../../domain/largeBody';
  import { jsonProblem } from '../../domain/jsonLint';
  import { countLabel } from '../../editor/largeFold';
  import { updateTabById, uiLanguage } from '../../stores';
  import { focusMode } from '../../stores/ui';
  import { toggleFocus } from '../../domain/focusMode';
  import EditorTools from '../EditorTools.svelte';

  let { tab, uiTab = $bindable() }: { tab: Tab; uiTab: HttpEditorTab } = $props();

  const paramCount = $derived((tab.params ?? []).filter((p) => p.enabled && p.key.trim()).length);
  const headerCount = $derived(Object.keys(tab.request.headers ?? {}).length);
  const scriptCount = $derived(
    (tab.request.preRequestScript?.trim() ? 1 : 0) + (tab.request.testScript?.trim() ? 1 : 0),
  );

  // E1 rule 2: a large raw body has no head above the editor; format, size, lines and tools sit here instead.
  const body = $derived(tab.request.body ?? '');
  const textBody = $derived(currentBodyMode(tab) === 'raw' || currentBodyMode(tab) === 'binary');
  const large = $derived(uiTab === 'body' && textBody && isLargeBody(body));
  const stats = $derived(large ? textStats(body) : undefined);
  const kind = $derived(bodyKindOf(tab));
  const isJson = $derived(currentBodyMode(tab) === 'raw' && currentRawFormat(tab) === 'JSON');
  // Debounced: a parse per keystroke on a multi-MB body would lag typing.
  let invalid = $state(false);
  $effect(() => {
    const text = large && isJson ? body : '';
    const id = setTimeout(() => (invalid = !!text && !!jsonProblem(text)), 400);
    return () => clearTimeout(id);
  });
  const canBeautify = $derived(currentBodyMode(tab) === 'raw' && ['JSON', 'HTML', 'XML'].includes(currentRawFormat(tab)));
  const KIND_LABEL: Record<BodyKind, string> = {
    json: 'JSON', text: 'http.body.text', javascript: 'JavaScript', html: 'HTML', xml: 'XML', graphql: 'GraphQL',
    none: 'http.body.none', urlencoded: 'Form · urlencoded', multipart: 'Form · multipart', binary: 'http.body.binary',
  };

  function setKind(k: BodyKind): void {
    updateTabById(tab.id, (x) => ({ ...x, request: applyBodyKind(x.request, k) }));
  }
  function doBeautify(): void {
    try {
      const next = beautify(body, currentRawFormat(tab));
      updateTabById(tab.id, (x) => ({ ...x, request: { ...x.request, body: next } }));
    } catch {
      // The live JSON check already underlines the problem and flags it next to the size.
    }
  }
</script>

{#snippet rtab(id: HttpEditorTab, label: string, count?: number)}
  <button class="bs-rtab" class:on={uiTab === id} role="tab" id="bs-rtab-{id}" aria-selected={uiTab === id} aria-controls="bs-reqpanel" tabindex={uiTab === id ? 0 : -1} onclick={() => (uiTab = id)}>
    {label}{#if count !== undefined}<span class="bs-tab-count">{count}</span>{/if}
  </button>
{/snippet}

<div class="lb-tabrow">
  <div class="bs-rtabs">
    <div class="bs-rtabs-list" role="tablist" aria-label={$t('http.tabs.aria')} use:tablist>
      {@render rtab('params', $t('http.tabs.params'), paramCount || undefined)}
      {@render rtab('auth', $t('http.tabs.auth'))}
      {@render rtab('headers', $t('http.tabs.headers'), headerCount || undefined)}
      {@render rtab('body', $t('http.tabs.body'))}
      {@render rtab('scripts', $t('http.tabs.scripts'), scriptCount || undefined)}
    </div>
  </div>
  {#if large && stats}
    <div class="lb-tabrow-tools">
      <span class="lb-fmt">
        <select aria-label={$t('lb.format')} value={kind} onchange={(e) => setKind(e.currentTarget.value as BodyKind)}>
          <optgroup label={$t('lb.fmt.text')}>
            {#each RAW_KINDS as k (k)}<option value={k}>{KIND_LABEL[k].startsWith('http.') ? $t(KIND_LABEL[k]) : KIND_LABEL[k]}</option>{/each}
          </optgroup>
          <optgroup label={$t('lb.fmt.other')}>
            {#each OTHER_KINDS as k (k)}<option value={k}>{KIND_LABEL[k].startsWith('http.') ? $t(KIND_LABEL[k]) : KIND_LABEL[k]}</option>{/each}
          </optgroup>
        </select>
        <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
      </span>
      <span class="lb-stats">{stats.approx ? '~' : ''}{formatBytes(stats.bytes)}  ·  {countLabel(stats.lines, 'lines', $uiLanguage)}{#if invalid}<b class="bad">{'  ·  '}{$t('lb.json.invalid')}</b>{/if}</span>
      <EditorTools
        scope="#bs-reqpanel"
        onBeautify={canBeautify ? doBeautify : undefined}
        beautifyTitle={body.length > BEAUTIFY_MAX_CHARS ? $t('lb.beautifyTooLarge') : ''}
        onExpand={() => focusMode.update((m) => toggleFocus(m, 'request'))}
        expanded={$focusMode === 'request'}
      />
    </div>
  {/if}
</div>
