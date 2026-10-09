<!--
  Shared settings primitives (S32 mocks), exported as snippets so every section
  component renders the same rows. Styles live in src/styles/settings.css.
-->
<script module lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '$shared/i18n';
  export { row, sw, number, select, seg, chips };

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

{#snippet row(name: string, desc: string, control: Snippet, danger?: boolean)}
  <div class="st-row" class:st-danger={danger}>
    <div class="st-copy">
      <span class="st-name">{name}</span>{#if desc}<span class="st-desc">{desc}</span>{/if}
    </div>
    {@render control()}
  </div>
{/snippet}

{#snippet sw(label: string, on: boolean, set: (v: boolean) => void)}
  <button type="button" class="mono-switch" role="switch" aria-checked={on} aria-label={label} onclick={() => set(!on)}
  ></button>
{/snippet}

{#snippet number(label: string, value: number, unit: string, min: number, max: number, set: (e: Event) => void)}
  <label class="st-num">
    <input type="number" {min} {max} step="1" {value} aria-label={label} onchange={set} />
    <span aria-hidden="true">{unit}</span>
  </label>
{/snippet}

{#snippet select(label: string, value: string, options: Option<string>[], set: (v: string) => void)}
  <select class="st-select" aria-label={label} {value} onchange={(e) => set(e.currentTarget.value)}>
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
{/snippet}

{#snippet seg(label: string, value: string, options: Option<string>[], set: (v: string) => void)}
  <div class="bs-seg compact" role="radiogroup" aria-label={label}>
    {#each options as o (o.value)}
      <button
        type="button"
        role="radio"
        aria-checked={value === o.value}
        class:on={value === o.value}
        onclick={() => set(o.value)}>{o.label}</button
      >
    {/each}
  </div>
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
