<script lang="ts">
  /**
   * Flow · Cookies, CJ7: the «Истекает» field of the cookie editor and its picker — session,
   * a date and time (Expires) or «через N» (Max-Age), with the Set-Cookie attribute it yields.
   * Every change goes straight into the draft; the popover lives in <body> (see `portal`).
   */
  import { tick } from 'svelte';
  import { t, tp } from '$shared/i18n';
  import { portal } from '$shared/ui';
  import { monthGrid, spanParts, zoneLabel } from '$entities/cookies';

  let {
    expiresMs,
    maxAge,
    onchange,
    open = $bindable(false),
  }: {
    expiresMs: number | null;
    maxAge: number | null;
    onchange: (p: { expiresMs: number | null; maxAge: number | null }) => void;
    open?: boolean;
  } = $props();

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const PRESETS: [string, number][] = [
    ['+1 h', HOUR],
    ['+1 d', DAY],
    ['+7 d', 7 * DAY],
    ['+30 d', 30 * DAY],
    ['+1 yr', 365 * DAY],
  ];
  const UNITS = [
    ['min', 60],
    ['h', 3600],
    ['d', 86_400],
  ] as const;
  const W = 300;

  let trigger = $state<HTMLButtonElement | null>(null);
  /** Where the popover hangs: `top` (below the field) or `bottom` (above it, growing upward). */
  let pos = $state<{ left: number; top: number | null; bottom: number | null; maxH: number }>({
    left: 0,
    top: 0,
    bottom: null,
    maxH: 0,
  });
  let now = $state(Date.now());
  /** The month on screen: first day of it. */
  let view = $state(new Date());
  /** «Через…» unit, remembered while the popover is open. */
  let unit = $state<(typeof UNITS)[number][0]>('h');

  const mode = $derived(maxAge != null ? 'after' : expiresMs != null ? 'date' : 'session');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const monthTitle = $derived(
    `${cap(new Intl.DateTimeFormat('en', { month: 'long' }).format(view))} ${view.getFullYear()}`,
  );
  // 2026-10-12 is a Monday: format the week from it.
  const weekdays = $derived(
    Array.from({ length: 7 }, (_, i) =>
      cap(new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(2026, 9, 12 + i))),
    ),
  );
  const cells = $derived(monthGrid(view.getFullYear(), view.getMonth()));
  const chosen = $derived(expiresMs != null ? new Date(expiresMs) : null);
  const today = $derived(new Date(now));
  const amount = $derived(maxAge != null ? Math.max(1, Math.round(maxAge / unitSecs(unit))) : 1);

  function unitSecs(u: string): number {
    return UNITS.find(([k]) => k === u)?.[1] ?? 3600;
  }

  const sameDay = (d: Date | null, y: number, m: number, day: number) =>
    !!d && d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
  const beforeToday = (y: number, m: number, day: number) =>
    new Date(y, m, day).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  function span(ms: number): string {
    const { d, h, m } = spanParts(ms, now);
    const parts = [
      d && `${d} ${tp(d, ['d', 'd'])}`,
      h && `${h} ${t('cookies.picker.unit.h')}`,
      !d && m && `${m} ${t('cookies.picker.unit.min')}`,
    ].filter(Boolean);
    return parts.join(' ') || `0 ${t('cookies.picker.unit.min')}`;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const fieldText = $derived.by(() => {
    if (maxAge != null) return t('cookies.exp.max_age', { span: span(now + maxAge * 1000) });
    if (!chosen) return t('cookies.exp.until_close');
    return `${pad(chosen.getDate())}.${pad(chosen.getMonth() + 1)}.${chosen.getFullYear()}, ${pad(chosen.getHours())}:${pad(chosen.getMinutes())}`;
  });
  const attr = $derived(
    maxAge != null ? `Max-Age=${maxAge}` : expiresMs != null ? `Expires=${new Date(expiresMs).toUTCString()}` : '',
  );
  const sub = $derived.by(() => {
    const at = maxAge != null ? now + maxAge * 1000 : expiresMs;
    if (at == null) return '';
    if (at <= now) return t('cookies.picker.past');
    return t('cookies.picker.applies', { span: t('cookies.picker.in', { span: span(at) }) });
  });

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    now = Date.now();
    const base = chosen ?? new Date(now);
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    if (maxAge != null) unit = maxAge % 86_400 === 0 ? 'd' : maxAge % 3600 === 0 ? 'h' : 'min';
    await tick();
    place();
  }

  /** The tallest mode (Date with its month grid); the side is chosen for it, once per opening. */
  const MAX_H = 430;

  /**
   * Above the field like the mock, below it when the tallest mode would not fit above. The side
   * is fixed while the popover is open, so switching Session / Date / In… never makes it jump;
   * above, it is anchored by its bottom edge and grows upward away from the field.
   */
  function place(): void {
    const r = trigger?.getBoundingClientRect();
    if (!r) return;
    const roomAbove = r.top - 14;
    const roomBelow = window.innerHeight - r.bottom - 14;
    const above = roomAbove >= MAX_H || roomAbove > roomBelow;
    pos = {
      left: Math.max(8, Math.min(window.innerWidth - W - 8, r.left)),
      top: above ? null : r.bottom + 6,
      bottom: above ? window.innerHeight - r.top + 6 : null,
      maxH: Math.max(160, above ? roomAbove : roomBelow),
    };
  }

  function setMode(m: 'session' | 'date' | 'after'): void {
    if (m === mode) return;
    now = Date.now();
    if (m === 'session') onchange({ expiresMs: null, maxAge: null });
    else if (m === 'date') {
      // Tomorrow at the next full hour, unless a date was already there.
      const at = expiresMs ?? Math.ceil((now + DAY) / HOUR) * HOUR;
      onchange({ expiresMs: at, maxAge: null });
      const d = new Date(at);
      view = new Date(d.getFullYear(), d.getMonth(), 1);
    } else onchange({ expiresMs: null, maxAge: 3600 });
  }

  function preset(ms: number): void {
    now = Date.now();
    if (mode === 'after') {
      onchange({ expiresMs: null, maxAge: Math.round(ms / 1000) });
      return;
    }
    const at = Math.round((now + ms) / 60_000) * 60_000;
    onchange({ expiresMs: at, maxAge: null });
    const d = new Date(at);
    view = new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function pickDay(y: number, m: number, day: number): void {
    const base = chosen ?? new Date(Math.ceil(now / HOUR) * HOUR);
    onchange({ expiresMs: new Date(y, m, day, base.getHours(), base.getMinutes()).getTime(), maxAge: null });
    if (m !== view.getMonth()) view = new Date(y, m, 1);
  }

  /** «18:00», «9:5», «1800» → hours and minutes; anything else keeps the old time. */
  function setTime(value: string): void {
    const m0 = /^(\d{1,2})(?::?(\d{2}))?$/.exec(value.trim());
    const h = Number(m0?.[1]);
    const m = Number(m0?.[2] ?? 0);
    if (!chosen || !m0 || h > 23 || m > 59) return;
    const d = new Date(chosen);
    d.setHours(h, m, 0, 0);
    onchange({ expiresMs: d.getTime(), maxAge: null });
  }

  const shiftMonth = (n: number) => (view = new Date(view.getFullYear(), view.getMonth() + n, 1));
</script>

<svelte:window onresize={() => open && place()} />

<button
  bind:this={trigger}
  class="field"
  class:on={open}
  type="button"
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label={t('cookies.picker.aria')}
  onclick={toggle}
  ><span class="text">{fieldText}</span><span class="material-symbols-outlined" aria-hidden="true">calendar_today</span
  ></button
>

{#if open}
  <!-- In <body>: a transparent layer that closes the picker on any click outside it (no global
       listener: in the Tauri webview a window pointerdown misjudged clicks inside the portal). -->
  <div use:portal class="bs-expiry-layer">
    <div class="backdrop" role="presentation" onpointerdown={() => (open = false)}></div>
    <div
      class="bs-expiry"
      role="dialog"
      aria-label={t('cookies.picker.aria')}
      style:left="{pos.left}px"
      style:top={pos.top == null ? null : `${pos.top}px`}
      style:bottom={pos.bottom == null ? null : `${pos.bottom}px`}
      style:max-height="{pos.maxH}px"
    >
      <div class="tabs" role="radiogroup" aria-label={t('cookies.picker.aria')}>
        {#each [['session', 'cookies.picker.session'], ['date', 'cookies.picker.date'], ['after', 'cookies.picker.after']] as const as [m, label] (m)}
          <button type="button" role="radio" aria-checked={mode === m} class:on={mode === m} onclick={() => setMode(m)}
            >{t(label)}</button
          >
        {/each}
      </div>

      {#if mode === 'session'}
        <p class="note">{t('cookies.picker.session_note')}</p>
      {:else}
        <div class="chips">
          {#each PRESETS as [label, ms] (label)}
            <button type="button" class="chip" onclick={() => preset(ms)}>{label}</button>
          {/each}
        </div>
      {/if}

      {#if mode === 'date'}
        <div class="month">
          <button type="button" class="nav" aria-label={t('cookies.picker.prev')} onclick={() => shiftMonth(-1)}
            ><span class="material-symbols-outlined" aria-hidden="true">chevron_left</span></button
          >
          <span class="title">{monthTitle}</span>
          <button type="button" class="nav" aria-label={t('cookies.picker.next')} onclick={() => shiftMonth(1)}
            ><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button
          >
        </div>
        <div class="grid" role="grid">
          {#each weekdays as w (w)}<span class="wd">{w}</span>{/each}
          {#each cells as c (`${c.year}-${c.month}-${c.day}`)}
            {@const past = beforeToday(c.year, c.month, c.day)}
            <button
              type="button"
              class="day"
              class:out={!c.inMonth}
              class:past
              class:today={sameDay(today, c.year, c.month, c.day)}
              class:sel={sameDay(chosen, c.year, c.month, c.day)}
              disabled={past}
              aria-pressed={sameDay(chosen, c.year, c.month, c.day)}
              onclick={() => pickDay(c.year, c.month, c.day)}>{c.day}</button
            >
          {/each}
        </div>
        <div class="time">
          <span>{t('cookies.picker.time')}</span>
          <!-- Text, not type=time: that one follows the OS 12/24 h setting; the mock is always 24 h. -->
          <input
            class="hhmm"
            inputmode="numeric"
            maxlength="5"
            placeholder={t('cookies.picker.hhmm')}
            aria-label={t('cookies.picker.time')}
            value={chosen ? `${pad(chosen.getHours())}:${pad(chosen.getMinutes())}` : ''}
            onchange={(e) => setTime(e.currentTarget.value)}
            onkeydown={(e) => e.key === 'Enter' && setTime(e.currentTarget.value)}
          />
          <span class="zone">{zoneLabel(chosen ?? new Date(now))}</span>
        </div>
      {:else if mode === 'after'}
        <div class="time">
          <input
            class="amount"
            type="number"
            min="1"
            aria-label={t('cookies.picker.amount')}
            value={amount}
            onchange={(e) => {
              const n = Math.max(1, Math.round(e.currentTarget.valueAsNumber || 1));
              onchange({ expiresMs: null, maxAge: n * unitSecs(unit) });
            }}
          />
          <div class="units" role="radiogroup" aria-label={t('cookies.picker.amount')}>
            {#each UNITS as [u, secs] (u)}
              <button
                type="button"
                role="radio"
                aria-checked={unit === u}
                class:on={unit === u}
                onclick={() => {
                  unit = u;
                  onchange({ expiresMs: null, maxAge: amount * secs });
                }}>{t(`cookies.picker.unit.${u}`)}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      {#if attr}
        <div class="preview">
          <code>{attr}</code>
          <span>{sub}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .field {
    width: 100%;
    min-width: 0;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    text-align: left;
  }
  .field.on,
  .field:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 0;
  }
  .field .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field .material-symbols-outlined {
    flex: none;
    font-size: 15px;
    color: var(--color-text-muted);
  }

  .bs-expiry-layer {
    position: fixed;
    inset: 0;
    z-index: 102;
  }
  .backdrop {
    position: absolute;
    inset: 0;
  }
  /* Pencil «Date picker» (CJ7): 300 wide, over the jar sheet. */
  .bs-expiry {
    position: fixed;
    /* Scrolls only when the window is too short for it; no bar for the last few pixels. */
    overflow-y: auto;
    scrollbar-width: none;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }
  .tabs,
  .units {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
  }
  .tabs button,
  .units button {
    flex: 1;
    height: 26px;
    border-radius: calc(var(--radius-control) - 2px);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .tabs button.on,
  .units button.on {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 600;
  }
  .note {
    margin: 0;
    padding: 2px 4px;
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .chips {
    display: flex;
    gap: 4px;
  }
  .chip {
    flex: 1;
    height: 24px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
    white-space: nowrap;
  }
  .chip:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .month {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .month .title {
    font-weight: 600;
  }
  .nav {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--color-text-secondary);
  }
  .nav:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .nav .material-symbols-outlined {
    font-size: 18px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    row-gap: 2px;
    justify-items: center;
  }
  .wd {
    padding-bottom: 4px;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .day {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
  .day:hover:not(:disabled) {
    background: var(--color-hover);
  }
  .day.out,
  .day.past {
    color: var(--color-text-muted);
  }
  .day:disabled {
    cursor: default;
  }
  .day.today {
    box-shadow: inset 0 0 0 1px var(--color-border);
    font-weight: 600;
  }
  /* Also under the pointer: `.day:hover` above is more specific. */
  .day.sel,
  .day.sel:hover:not(:disabled) {
    background: var(--color-action);
    color: var(--color-on-action);
    font-weight: 600;
    box-shadow: none;
  }
  .time {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
  }
  .time input {
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
  .time input.amount {
    width: 72px;
  }
  .time input.hhmm {
    width: 64px;
    text-align: center;
  }
  .time .units {
    flex: 1;
  }
  .zone {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
  }
  .preview code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
  }
  .preview span {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
</style>
