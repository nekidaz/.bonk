<script lang="ts">
  /**
   * “Outline” of the expanded script editor (SC8): sections from `// ── Section` comments with their
   * functions, `pm.test` blocks (with the last run's result) and variables; click to jump.
   * Folded (SC8b) it is a 36 px rail map: a group per section, ƒ for functions, ✓/✕ dots for tests,
   * teal ticks for variables, the section at the caret in a capsule, the failure count at the bottom.
   * Drag the edge (SC8c): released past 140 px it opens at 252 px (or its last width), short of that it
   * goes back to the rail. ⌥⌘O toggles, ⇧⌘O focuses “Go to…” (wired by ScriptsEditor).
   */
  import { t } from '$shared/i18n';
  import type { ScriptTestResult } from '$shared/model';
  import { scriptOutline, type OutlineItem } from './scriptOutline';
  import { scriptOutlineWidth } from './scriptPrefs.svelte';
  import { testAt } from './scriptRun';

  let {
    code,
    tests,
    lastRunAt,
    currentLine = 0,
    onGoto,
  }: {
    code: string;
    tests: ScriptTestResult[];
    lastRunAt?: number;
    currentLine?: number;
    onGoto: (line: number) => void;
  } = $props();

  const OPEN_AT = 140;
  const DEFAULT_WIDTH = 252;
  const MAX_WIDTH = 420;

  let query = $state('');
  let search = $state<HTMLInputElement>();
  /** Live width while the edge is dragged (null otherwise). */
  let dragWidth = $state<number | null>(null);
  /** Width to come back to when reopening from the rail. */
  let lastWidth = DEFAULT_WIDTH;
  let tip = $state<{ text: string; line: number; state?: 'ok' | 'fail'; y: number } | null>(null);

  const width = $derived(dragWidth ?? scriptOutlineWidth.current);
  const rail = $derived(width < OPEN_AT);
  const sections = $derived(scriptOutline(code));
  const result = (item: OutlineItem) => (item.kind === 'test' ? testAt(tests, item.line, item.name) : undefined);
  const failedCount = $derived(tests.filter((x) => !x.passed).length);
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({ ...s, items: s.items.filter((i) => i.name.toLowerCase().includes(q)) }))
      .filter((s) => s.items.length || s.title.toLowerCase().includes(q));
  });
  const currentSection = $derived.by(() => {
    let at = -1;
    sections.forEach((s, i) => {
      if (s.line <= currentLine) at = i;
    });
    return at;
  });
  const clock = (ts: number) => new Date(ts).toTimeString().slice(0, 5);

  export function toggle(): void {
    if (rail) scriptOutlineWidth.current = lastWidth;
    else {
      lastWidth = scriptOutlineWidth.current;
      scriptOutlineWidth.current = 0;
    }
  }
  export function focusSearch(): void {
    if (rail) scriptOutlineWidth.current = lastWidth;
    queueMicrotask(() => search?.focus());
  }

  function goFirstMatch(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return;
    const first = filtered.flatMap((s) => (s.items.length ? s.items : s.line ? [{ line: s.line }] : []))[0];
    if (first) onGoto(first.line);
  }

  function startDrag(e: PointerEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const start = rail ? 36 : scriptOutlineWidth.current;
    if (!rail) lastWidth = scriptOutlineWidth.current;
    const move = (ev: PointerEvent) => (dragWidth = Math.min(MAX_WIDTH, Math.max(36, start + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      stopDrag = undefined;
      const w = dragWidth ?? start;
      dragWidth = null;
      // From the rail a pull past the threshold opens at the remembered width; a resize keeps what it got.
      scriptOutlineWidth.current = w < OPEN_AT ? 0 : start === 36 ? Math.max(w, lastWidth) : Math.round(w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    stopDrag = up;
  }
  /** Finishes a drag still in progress when the panel unmounts (Esc out of expanded mode). */
  let stopDrag: (() => void) | undefined;
  $effect(() => () => stopDrag?.());

  function showTip(e: MouseEvent, item: OutlineItem): void {
    const r = result(item);
    const host = (e.currentTarget as HTMLElement).closest('.bs-outline') as HTMLElement;
    const y = (e.currentTarget as HTMLElement).getBoundingClientRect().top - host.getBoundingClientRect().top;
    tip = { text: item.name, line: item.line, state: r ? (r.passed ? 'ok' : 'fail') : undefined, y };
  }
</script>

{#snippet icon(item: OutlineItem)}
  {@const r = result(item)}
  {#if item.kind === 'fn'}<span class="fn-icon" aria-hidden="true">ƒ</span>
  {:else if item.kind === 'var'}<span class="material-symbols-outlined var" aria-hidden="true">database</span>
  {:else}<span
      class="material-symbols-outlined test"
      class:ok={r?.passed}
      class:fail={r && !r.passed}
      aria-hidden="true">{r ? (r.passed ? 'check_circle' : 'cancel') : 'radio_button_unchecked'}</span
    >{/if}
{/snippet}

<aside class="bs-outline" class:rail class:dragging={dragWidth !== null} style:width="{rail ? 36 : width}px">
  {#if rail}
    <button type="button" class="rail-toggle" title={`${t('script.outline.show')} ⌥⌘O`} onclick={toggle}>
      <span class="material-symbols-outlined" aria-hidden="true">segment</span>
    </button>
    <div class="map">
      {#each sections as s, i (i)}
        <div class="group" class:here={i === currentSection}>
          {#if s.title}<button type="button" class="dash" aria-label={s.title} onclick={() => onGoto(s.line)}
            ></button>{/if}
          {#each s.items as item (item.line + item.kind + item.name)}
            {@const r = result(item)}
            <button
              type="button"
              class="mark {item.kind}"
              class:ok={r?.passed}
              class:fail={r && !r.passed}
              aria-label={item.name}
              onmouseenter={(e) => showTip(e, item)}
              onmouseleave={() => (tip = null)}
              onclick={() => onGoto(item.line)}>{item.kind === 'fn' ? 'ƒ' : ''}</button
            >
          {/each}
        </div>
      {/each}
    </div>
    {#if failedCount}<span class="fails" title={t('script.outline.failed', { n: failedCount })}>×{failedCount}</span
      >{/if}
    {#if tip}
      <div class="tip" style:top="{tip.y - 6}px">
        {#if tip.state}<span class="material-symbols-outlined {tip.state}" aria-hidden="true"
            >{tip.state === 'ok' ? 'check' : 'close'}</span
          >{/if}{tip.text}<span class="ln">{t('script.line', { n: tip.line })}</span>
      </div>
    {/if}
  {:else}
    <header>{t('script.outline')}</header>
    <label class="search">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <input
        bind:this={search}
        bind:value={query}
        placeholder={t('script.outline.goto')}
        aria-label={t('script.outline.goto')}
        onkeydown={goFirstMatch}
      />
      {#if width > 200}<kbd>⇧⌘O</kbd>{/if}
    </label>
    <div class="list">
      {#each filtered as s, i (i)}
        {#if s.title}
          <button type="button" class="section" onclick={() => onGoto(s.line)}
            ><span>{s.title}</span><span class="n">{s.line}</span></button
          >
        {/if}
        {#each s.items as item (item.line + item.kind + item.name)}
          {@const r = result(item)}
          <button type="button" class="item {item.kind}" class:fail={r && !r.passed} onclick={() => onGoto(item.line)}>
            {@render icon(item)}<span class="name">{item.name}</span><span class="n">{item.line}</span>
          </button>
        {/each}
      {:else}
        <p class="empty">{t('script.outline.empty')}</p>
      {/each}
    </div>
    {#if lastRunAt && tests.length}
      <footer>
        {t('script.outline.lastRun', {
          time: clock(lastRunAt),
          passed: tests.filter((x) => x.passed).length,
          total: tests.length,
        })}
      </footer>
    {/if}
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="edge" onpointerdown={startDrag} ondblclick={toggle}>
    <span class="grip" aria-hidden="true"></span>
  </div>
</aside>

<style>
  .bs-outline {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .bs-outline:not(.dragging) {
    transition: width var(--duration-panel) var(--ease-soft);
  }
  header {
    display: flex;
    align-items: center;
    padding: 14px 14px 8px;
    color: var(--t3);
    font: 600 var(--font-size-micro) var(--mono);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .rail-toggle {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    border-radius: var(--radius-sm);
  }
  .rail-toggle:hover {
    color: var(--text);
    background: var(--hover);
  }
  .rail-toggle .material-symbols-outlined {
    font-size: 15px;
  }
  .search {
    height: 30px;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 10px 8px;
    padding: 0 10px;
    color: var(--t3);
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
  }
  .search:focus-within {
    border-color: color-mix(in srgb, var(--accent) 56%, var(--sep));
  }
  .search .material-symbols-outlined {
    font-size: 15px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: 0;
    font-size: var(--font-size-caption);
  }
  .search kbd {
    color: var(--t3);
    font: var(--font-size-micro) var(--font-ui);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 6px 8px;
  }
  .list > button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .list > button:hover {
    background: var(--hover);
  }
  .section {
    margin-top: 8px;
    color: var(--t3);
    font: 600 var(--font-size-micro) var(--mono);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  .section > span:first-child,
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item {
    color: var(--text);
    font-size: var(--font-size-caption);
  }
  .item.fn,
  .item.var {
    font-family: var(--mono);
  }
  .item.var {
    color: var(--var, var(--accent));
  }
  .item.fail {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }
  .n {
    flex: none;
    color: var(--t3);
    font: var(--font-size-micro) var(--mono);
  }
  .fn-icon {
    flex: none;
    width: 16px;
    color: var(--t2);
    font: italic 600 13px var(--mono);
    text-align: center;
  }
  .material-symbols-outlined.var,
  .material-symbols-outlined.test {
    font-size: 15px;
  }
  .test {
    color: var(--t3);
  }
  .test.ok {
    color: var(--color-success);
  }
  .test.fail {
    color: var(--color-danger);
  }
  .empty {
    margin: 8px;
    color: var(--t3);
    font-size: var(--font-size-caption);
    line-height: 1.45;
  }
  footer {
    padding: 10px 12px;
    color: var(--t3);
    font-size: var(--font-size-micro);
  }
  /* SC8b: the rail. */
  .rail {
    align-items: center;
    padding: 8px 0;
  }
  .map {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding-top: 10px;
  }
  .group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 3px;
    border-radius: 999px;
  }
  .group.here {
    background: var(--hover2);
    box-shadow: inset 0 0 0 1px var(--sepsoft);
  }
  .dash {
    width: 10px;
    height: 2px;
    margin-bottom: 2px;
    background: var(--t3);
    border-radius: 1px;
  }
  .mark {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--t2);
    font: italic 600 10px var(--mono);
  }
  .mark.test::before,
  .mark.var::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--t3);
  }
  .mark.test.ok::before {
    background: var(--color-success);
  }
  .mark.test.fail::before {
    width: 8px;
    height: 8px;
    background: transparent;
    box-shadow: 0 0 0 1.5px var(--color-danger);
  }
  .mark.var::before {
    border-radius: 1px;
    background: var(--var, var(--accent));
  }
  .fails {
    padding: 1px 5px;
    color: var(--color-danger);
    background: var(--color-danger-soft);
    border-radius: 999px;
    font: 600 var(--font-size-micro) var(--mono);
  }
  .tip {
    position: absolute;
    left: 40px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    color: var(--color-on-inverse);
    background: var(--color-inverse);
    border-radius: 999px;
    font-size: var(--font-size-caption);
    white-space: nowrap;
    pointer-events: none;
  }
  .tip .material-symbols-outlined {
    font-size: 13px;
  }
  .tip .ln {
    opacity: 0.6;
    font-family: var(--mono);
  }
  /* SC8c: the draggable edge. */
  .edge {
    position: absolute;
    top: 0;
    /* Fills the 10 px gap to the editor card, so the grip sits in the middle of it like the sidebar's. */
    right: -11px;
    bottom: 0;
    z-index: 4;
    width: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
  }
  /* The same grip as the sidebar's resize handle (S33): a short capsule that shows on hover and while dragging. */
  .grip {
    width: 4px;
    height: 48px;
    border-radius: var(--radius-control);
    background: var(--color-text-secondary);
    opacity: 0;
    transition: opacity var(--duration-hover);
  }
  .edge:hover .grip,
  .dragging .grip {
    opacity: 1;
  }
</style>
