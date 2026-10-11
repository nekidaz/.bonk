<script lang="ts">
  // DV3: under the Timeline, the request exactly as bonk sent it; {{$dynamic}} values are marked.
  import { t, tp } from '$shared/i18n';
  import type { Tab } from '$shared/model';
  import { markDynamic, sentCurl } from './sentRequest';

  const { tab, sent }: { tab: Tab; sent: NonNullable<Tab['sent']> } = $props();

  /** A huge body would only slow the tab down; the Body tab of history keeps all of it. */
  const BODY_MAX = 20_000;
  const body = $derived.by(() => {
    const text = sent.request.body ?? '';
    return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…` : text;
  });
  const count = $derived(sent.dynamic.length);
  let copied = $state(false);

  function copyCurl(): void {
    void navigator.clipboard?.writeText(sentCurl(tab, sent.request));
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

{#snippet marked(text: string)}{#each markDynamic(text, sent.dynamic) as piece, i (i)}{#if piece.dyn}<span class="dyn"
        >{piece.text}</span
      >{:else}{piece.text}{/if}{/each}{/snippet}

<div class="sent">
  <div class="head">
    <span class="ttl">{t('dyn.sent.title')}</span>
    {#if count}
      <span class="count"
        >{`${count} ${tp(count, ['динамическое значение', 'динамических значения', 'динамических значений'], ['dynamic value', 'dynamic values'])}`}</span
      >
    {/if}
    <span class="grow"></span>
    <button type="button" class="copy" onclick={copyCurl}
      ><span class="material-symbols-outlined" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>{t(
        'dyn.sent.copy_curl',
      )}</button
    >
  </div>
  <!-- prettier-ignore -->
  <div class="bs-code lines"><div><span class="method">{sent.request.method}</span> {@render marked(sent.request.url)}</div>{#each Object.entries(sent.request.headers ?? {}) as [key, value] (key)}<div><span class="key">{key}</span>: {@render marked(value)}</div>{/each}{#if body}<div class="body">{@render marked(body)}</div>{/if}</div>
  <div class="note">
    <span class="material-symbols-outlined" aria-hidden="true">info</span>{t('dyn.sent.note')}
  </div>
</div>

<style>
  .sent {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--color-border-subtle);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-ui);
  }
  .ttl {
    color: var(--color-text-muted);
    font-size: 9.5px;
    letter-spacing: 0.12em;
  }
  .count {
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--method-patch) 14%, transparent);
    color: var(--method-patch);
    font-size: 10.5px;
  }
  .grow {
    flex: 1;
  }
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
  }
  .copy:hover {
    background: var(--color-hover);
  }
  .copy .material-symbols-outlined,
  .note .material-symbols-outlined {
    font-size: 13px;
  }
  .lines {
    white-space: pre-wrap;
    word-break: break-all;
  }
  .method {
    color: var(--method-post);
    font-weight: 600;
  }
  .key {
    color: var(--color-text-muted);
  }
  .body {
    margin-top: 6px;
  }
  .dyn {
    padding: 0 3px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--method-patch) 14%, transparent);
    color: var(--color-text);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-muted);
    font-family: var(--font-ui);
    font-size: 11px;
  }
</style>
