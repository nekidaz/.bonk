<script lang="ts">
  /**
   * Editor tools cluster (E1–E6 rule 3/8): Find ⌘F · Fold all · Beautify (optional) · extras · Expand (optional).
   * Acts on the CodeMirror view found inside `scope` (a CSS selector), so any pane can host it without
   * plumbing an editor handle through the component tree.
   */
  import type { Snippet } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { openSearchPanel } from '@codemirror/search';
  import { t } from '$shared/i18n';
  import { hotkeys, formatBinding } from '$shared/settings';
  import { toggleFoldAll } from './largeFold';

  let {
    scope,
    onBeautify,
    beautifyTitle = '',
    onExpand,
    expanded = false,
    editor = true,
    extra,
  }: {
    /** Selector of the element holding the editor (`.cm-editor` is looked up inside it). */
    scope: string;
    onBeautify?: () => void;
    /** Non-empty: Beautify is disabled with this as its tooltip. */
    beautifyTitle?: string;
    onExpand?: () => void;
    expanded?: boolean;
    /** false: the pane shows no CodeMirror view (legacy renderer) — no Find / Fold all. */
    editor?: boolean;
    /** Extra buttons before Expand (Copy, Save to file). */
    extra?: Snippet;
  } = $props();

  function view(): EditorView | null {
    const el = document.querySelector(`${scope} .cm-editor`);
    return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null;
  }
  function find(): void {
    const v = view();
    if (!v) return;
    v.focus();
    openSearchPanel(v);
  }
  function foldAll(): void {
    const v = view();
    if (v) toggleFoldAll(v);
  }
  const expandKeys = $derived(formatBinding(hotkeys.current.expand ?? '').join(''));
</script>

<div class="lb-tools" role="toolbar" aria-label={t('lb.tools')}>
  {#if editor}
    <button type="button" class="bs-ric lb-ed" aria-label={t('lb.find')} title="{t('lb.find')}  ⌘F" onclick={find}
      ><span class="material-symbols-outlined" aria-hidden="true">search</span></button
    >
    <button type="button" class="bs-ric lb-ed" aria-label={t('lb.foldAll')} title={t('lb.foldAll')} onclick={foldAll}
      ><span class="material-symbols-outlined" aria-hidden="true">unfold_less</span></button
    >
  {/if}
  {#if onBeautify}
    <button
      type="button"
      class="bs-ric"
      aria-label={t('http.body.beautify')}
      title={beautifyTitle || t('http.body.beautify')}
      disabled={!!beautifyTitle}
      onclick={onBeautify}><span class="material-symbols-outlined" aria-hidden="true">format_align_left</span></button
    >
  {/if}
  {@render extra?.()}
  {#if onExpand}
    <button
      type="button"
      class="bs-ric lb-expand"
      class:on={expanded}
      aria-pressed={expanded}
      aria-label={expanded ? t('lb.collapse') : t('lb.expand')}
      title="{expanded ? t('lb.collapse') : t('lb.expand')}  {expanded ? 'Esc' : expandKeys}"
      onclick={onExpand}
      ><span class="material-symbols-outlined" aria-hidden="true">{expanded ? 'close_fullscreen' : 'open_in_full'}</span
      ></button
    >
  {/if}
</div>
