<!--
  Shared settings primitives (S32 mocks), exported as snippets so every section
  component renders the same rows. Their styles, and the `.st-card`, `.st-copy`, … classes the
  sections use directly, live in the <style> below (sections import this file first).
  A snippet is a function that returns markup: `{@render row(name, desc, control)}` draws a row whose
  right side is the `control` snippet (in Go terms, a func() passed as an argument). See
-->
<script module lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '$shared/i18n';
  import { Switch, Segmented, Select } from '$shared/ui/components';
  import Row from './Row.svelte';
  export { row, sw, number, select, seg, chips, themePic };

  function clampInt(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  /** Numeric field change: clamp, write the clamped value back into the field, store `n * scale`. */
  export function commit(
    e: Event,
    min: number,
    max: number,
    fallback: number,
    scale: number,
    set: (n: number) => void,
  ): void {
    const input = e.currentTarget as HTMLInputElement;
    const n = clampInt(input.valueAsNumber, min, max, fallback);
    input.value = String(n);
    set(n * scale);
  }

  export type Option<T> = { label: string; value: T };
</script>

<!-- A theme's mini app (Flow · Themes TH1/TH3): `base` palette from tokens.css, a user theme's colours inline on top. -->
{#snippet themePic(base: string, style: string | undefined)}
  <span class="st-theme-pic" data-theme={base} {style} aria-hidden="true">
    <i class="side"><b></b><b></b><b></b><b></b></i>
    <i class="main"
      ><b class="title"></b><span class="url"><i><b></b><b></b></i><b></b></span><span class="code"><b></b><b></b></span
      ><span class="code"><b></b><b></b></span><span class="status"><b></b><b></b></span></i
    >
  </span>
{/snippet}

{#snippet row(name: string, desc: string, control: Snippet, danger?: boolean)}
  <Row class={{ 'st-danger': danger }}>
    <div class="st-copy">
      <span class="st-name">{name}</span>{#if desc}<span class="st-desc">{desc}</span>{/if}
    </div>
    {@render control()}
  </Row>
{/snippet}

{#snippet sw(label: string, on: boolean, set: (v: boolean) => void)}
  <Switch checked={on} aria-label={label} onclick={() => set(!on)} />
{/snippet}

{#snippet number(label: string, value: number, unit: string, min: number, max: number, set: (e: Event) => void)}
  <label class="st-num">
    <input type="number" {min} {max} step="1" {value} aria-label={label} onchange={set} />
    <span aria-hidden="true">{unit}</span>
  </label>
{/snippet}

{#snippet select(label: string, value: string, options: Option<string>[], set: (v: string) => void)}
  <Select aria-label={label} {value} onchange={(e) => set(e.currentTarget.value)}>
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </Select>
{/snippet}

{#snippet seg(label: string, value: string, options: Option<string>[], set: (v: string) => void)}
  <Segmented role="radiogroup" aria-label={label}>
    {#each options as o (o.value)}
      <button
        type="button"
        role="radio"
        aria-checked={value === o.value}
        class:on={value === o.value}
        onclick={() => set(o.value)}>{o.label}</button
      >
    {/each}
  </Segmented>
{/snippet}

{#snippet chips(label: string, items: string[], placeholder: string, set: (items: string[]) => void)}
  <div class="st-chips" role="group" aria-label={label}>
    {#each items as item (item)}
      <span class="st-chip"
        >{item}<button
          type="button"
          aria-label={t('settings.chips.remove', { item })}
          onclick={() => set(items.filter((x) => x !== item))}
          ><span class="material-symbols-outlined" style="font-size:12px" aria-hidden="true">close</span></button
        ></span
      >
    {/each}
    <input
      {placeholder}
      aria-label={label}
      onkeydown={(e) => {
        const v = e.currentTarget.value.trim();
        if ((e.key === 'Enter' || e.key === ',') && v) {
          e.preventDefault();
          if (!items.includes(v)) set([...items, v]);
          e.currentTarget.value = '';
        } else if (e.key === 'Backspace' && !e.currentTarget.value && items.length) set(items.slice(0, -1));
      }}
    />
  </div>
{/snippet}

<style>
  :global(.st-group) {
    margin: 0 0 -8px;
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--color-text-muted);
  }

  :global(.st-card) {
    flex: none;
    padding: 0 16px;
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    overflow: hidden;
  }

  :global(.st-pad) {
    padding: 16px;
  }

  :global(.st-copy) {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  :global(.st-name) {
    font: 500 var(--font-size-ui)/16px var(--font-ui);
  }

  :global(.st-desc) {
    font: var(--font-size-caption)/13px var(--font-ui);
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  :global(.st-err) {
    padding: 8px 0 11px;
    font: var(--font-size-caption)/13px var(--font-ui);
    color: var(--red);
  }

  :global(.st-note) {
    margin: 0;
    font: var(--font-size-caption)/15px var(--font-ui);
    color: var(--color-text-muted);
  }

  :global(.st-spacer) {
    flex: 1;
  }

  .st-theme-pic :global(.main) {
    flex: 1;
    min-width: 0;
    gap: 5px;
    padding: 7px;
    background: var(--color-panel);
  }

  .st-num {
    flex: 0 0 auto;
    width: 120px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    font: var(--font-size-body) var(--font-code);
  }

  .st-num:focus-within {
    border-color: var(--color-text-muted);
  }

  .st-num :global(input) {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    outline: 0;
    box-shadow: none;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .st-num :global(span) {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  .st-theme-pic {
    display: flex;
    gap: 5px;
    height: 86px;
    padding: 6px;
    box-sizing: border-box;
    overflow: hidden;
    border-radius: 14px;
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    background: var(--color-app);
  }

  .st-theme-pic > :global(i) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-radius: 6px;
  }

  .st-theme-pic :global(.side) {
    flex: 0 0 46px;
    padding: 7px 6px;
    box-sizing: border-box;
    background: var(--color-sidebar);
  }

  .st-theme-pic :global(b) {
    display: block;
    height: 3px;
    border-radius: 2px;
  }

  .st-theme-pic :global(span) {
    display: flex;
    gap: 3px;
  }

  .st-theme-pic :global(.side b:nth-child(1)) {
    width: 26px;
    background: var(--method-get);
  }

  .st-theme-pic :global(.side b:nth-child(2)) {
    width: 30px;
    background: var(--method-post);
  }

  .st-theme-pic :global(.side b:nth-child(3)) {
    width: 22px;
    background: var(--method-delete);
  }

  .st-theme-pic :global(.side b:nth-child(4)) {
    width: 28px;
    background: var(--color-text-muted);
  }

  .st-theme-pic :global(.title) {
    width: 56px;
    height: 5px;
    background: var(--color-text);
  }

  .st-theme-pic :global(.url) {
    gap: 4px;
    height: 11px;
    margin: 1px 0;
  }

  .st-theme-pic :global(.url i) {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--color-field);
  }

  .st-theme-pic :global(.url i b:first-child) {
    width: 16px;
    height: 4px;
    background: var(--color-var);
  }

  .st-theme-pic :global(.url i b:last-child) {
    width: 30px;
    background: var(--color-text-secondary);
  }

  .st-theme-pic :global(.url > b) {
    width: 18px;
    height: 11px;
    border-radius: 999px;
    background: var(--color-action);
  }

  .st-theme-pic :global(.code b:first-child) {
    width: 18px;
    background: var(--sk);
  }

  .st-theme-pic :global(.code b:last-child) {
    width: 26px;
    background: var(--ss);
  }

  .st-theme-pic :global(.code + .code b:last-child) {
    background: var(--sn);
  }

  .st-theme-pic :global(.status b) {
    height: 6px;
    border-radius: 3px;
  }

  .st-theme-pic :global(.status b:first-child) {
    width: 16px;
    background: var(--color-success);
  }

  .st-theme-pic :global(.status b:last-child) {
    width: 10px;
    background: var(--color-danger);
  }

  :global(:root .st-danger .st-name) {
    color: var(--red);
  }

  /* Editable token list (proxy exclusions, .proto import paths). */
  .st-chips {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 6px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    box-sizing: border-box;
  }

  .st-chips:focus-within {
    border-color: var(--color-text-muted);
  }

  .st-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 4px 0 8px;
    border-radius: var(--radius-sm);
    background: var(--color-hover);
    font: var(--font-size-caption) var(--font-code);
  }

  .st-chip :global(button) {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .st-chip :global(button:hover) {
    color: var(--color-text);
  }

  .st-chips :global(input) {
    flex: 1;
    min-width: 80px;
    height: 22px;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.thi-preview) .st-theme-pic {
    height: 200px;
  }
</style>
