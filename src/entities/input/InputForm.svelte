<script lang="ts">
  /**
   * The input card (Flow · Сценарий с вводом IN2 / IN3): one field per «ask on send» variable the step
   * uses, each drawn for its type. `popover` is the small window by Send, `card` the one in the Runner
   * log. Values are checked before they leave; the backend checks again.
   */
  import { tick, untrack } from 'svelte';
  import { t, tp } from '$shared/i18n';
  import { filePick } from '$shared/ipc';
  import {
    INPUT_ICON,
    checkInput,
    codeLength,
    inputLabel,
    countdown,
    normalizeInput,
    type InputField,
    type InputRequest,
  } from '$shared/model';
  import { initialValue, lastValue } from './store.svelte';

  let {
    request,
    variant = 'card',
    onsubmit,
    oncancel,
    onskip,
    submitLabel,
    onresend,
    since,
  }: {
    request: InputRequest;
    variant?: 'popover' | 'card';
    onsubmit: (values: Record<string, string>) => void;
    /** The popover's «Отмена». */
    oncancel?: () => void;
    /** The card's «Пропустить шаг». */
    onskip?: () => void;
    /** A sign-in popover's primary button (default «Войти и повторить»: the send goes out again). */
    submitLabel?: string;
    /** The card's «Отправить заново»: run the step before again (offered when the request has `resend`). */
    onresend?: () => void;
    /** When the code was sent, ms; the countdown runs from it (default: when the form opened). */
    since?: number;
  } = $props();

  // A session's sign-in (Flow · Сессия SE5): the popover gets a header with the scenario and its steps.
  const session = $derived(variant === 'popover' ? request.session : undefined);

  let values = $state<Record<string, string>>({});
  let touched = $state<Record<string, boolean>>({});
  let submitted = $state(false);
  let shown = $state<Record<string, boolean>>({});
  let root = $state<HTMLElement>();
  // The code's lifetime counts down from the moment the form opens (the step that sent it just ended).
  let openedAt = $state(Date.now());
  let now = $state(Date.now());

  // A new form (the next step, or the same one after a rejected try) starts from its defaults.
  $effect(() => {
    const fields = request.fields;
    void request.id;
    untrack(() => {
      values = Object.fromEntries(fields.map((f) => [f.name, initialValue(f)]));
      touched = {};
      submitted = false;
      shown = {};
      now = Date.now();
      openedAt = since ?? now;
    });
    void tick().then(() => root?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, button.seg')?.focus());
  });

  const ttl = $derived(
    variant === 'card' ? Math.max(0, ...request.fields.filter((f) => f.type === 'code').map((f) => f.ttl)) : 0,
  );
  const left = $derived(ttl * 1000 - (now - openedAt));
  const expired = $derived(ttl > 0 && left <= 0);
  $effect(() => {
    if (ttl === 0) return;
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });

  const single = $derived(request.fields.length === 1 ? request.fields[0] : undefined);
  const val = (f: InputField) => values[f.name] ?? '';
  const set = (f: InputField, v: string) => {
    values[f.name] = v;
    touched[f.name] = true;
  };
  const problem = (f: InputField): string | null => checkInput(f, normalizeInput(f, val(f)));
  const visibleProblem = (f: InputField): string | null =>
    submitted || (touched[f.name] && f.type !== 'code') ? problem(f) : null;
  const valid = $derived(request.fields.every((f) => checkInput(f, normalizeInput(f, values[f.name] ?? '')) === null));

  function submit(): void {
    submitted = true;
    if (!valid) {
      void tick().then(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onsubmit(Object.fromEntries(request.fields.map((f) => [f.name, normalizeInput(f, val(f))])));
  }

  function onkeydown(e: KeyboardEvent): void {
    const area = (e.target as HTMLElement).tagName === 'TEXTAREA';
    if (
      e.key === 'Enter' &&
      (!area || e.metaKey || e.ctrlKey) &&
      !(e.target as HTMLElement).closest('button.seg, .pickbtn')
    ) {
      e.preventDefault();
      e.stopPropagation();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      oncancel?.();
    }
  }

  // ---- Code cells ----
  const cellEl = (f: InputField, i: number) =>
    root?.querySelectorAll<HTMLInputElement>(`.cell[data-field="${CSS.escape(f.name)}"]`)[i];
  const chars = (f: InputField): string[] => {
    const n = codeLength(f);
    const have = [...val(f)];
    return Array.from({ length: n }, (_, i) => have[i] ?? '');
  };
  function fillCode(f: InputField, text: string, from = 0): void {
    const n = codeLength(f);
    const next = chars(f);
    const incoming = [...text.replace(/\s+/g, '')];
    for (let i = 0; i < incoming.length && from + i < n; i++) next[from + i] = incoming[i];
    set(f, next.join('').trimEnd());
    const at = Math.min(from + incoming.length, n - 1);
    cellEl(f, at)?.focus();
    if (from + incoming.length >= n && checkInput(f, next.join('')) === null) queueMicrotask(submit);
  }
  function cellInput(f: InputField, i: number, e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    const text = el.value;
    el.value = chars(f)[i];
    if (text) fillCode(f, text.slice(-codeLength(f)), i);
  }
  function cellKey(f: InputField, i: number, e: KeyboardEvent): void {
    const to = (j: number) => cellEl(f, j)?.focus();
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = chars(f);
      if (next[i]) next[i] = '';
      else if (i > 0) {
        next[i - 1] = '';
        to(i - 1);
      }
      set(f, next.join('').trimEnd());
    } else if (e.key === 'ArrowLeft' && i > 0) to(i - 1);
    else if (e.key === 'ArrowRight' && i < codeLength(f) - 1) to(i + 1);
  }
  function cellPaste(f: InputField, e: ClipboardEvent): void {
    e.preventDefault();
    fillCode(f, e.clipboardData?.getData('text') ?? '');
  }

  // The clipboard hint: a code copied from the SMS is one ⌘V away.
  let clip = $state('');
  $effect(() => {
    void request.id;
    clip = '';
    const code = request.fields.find((f) => f.type === 'code');
    if (!code || !navigator.clipboard?.readText) return;
    let live = true;
    navigator.clipboard
      .readText()
      .then((text) => {
        const plain = text.trim().replace(/\s+/g, '');
        if (live && checkInput(code, plain) === null) clip = plain;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });
  const clipStale = $derived.by(() => {
    const code = request.fields.find((f) => f.type === 'code');
    return (
      !!code &&
      !!clip &&
      request.last?.inputs[code.name] !== undefined &&
      request.last.inputs[code.name] === maskLike(clip)
    );
  });
  // Same mask the backend shows: `••••` + the last two characters.
  const maskLike = (v: string) => (v.length <= 4 ? '••••' : `••••${v.slice(-2)}`);
  const clipText = $derived(clip.length === 6 ? `${clip.slice(0, 3)} ${clip.slice(3)}` : clip);

  // ---- Number ----
  function step(f: InputField, dir: 1 | -1): void {
    const n = Number(normalizeInput(f, val(f))) || 0;
    const by = f.step ?? 1;
    let next = n + dir * by;
    if (f.min !== null) next = Math.max(f.min, next);
    if (f.max !== null) next = Math.min(f.max, next);
    set(f, String(Math.round(next * 1e9) / 1e9));
  }

  // ---- Select with a search (more than four options) ----
  let comboOpen = $state<string | null>(null);
  let comboQuery = $state('');
  let comboActive = $state(0);
  const comboList = (f: InputField): string[] => {
    const q = comboQuery.trim().toLowerCase();
    return q ? f.options.filter((o) => o.toLowerCase().includes(q)) : f.options;
  };
  function openCombo(f: InputField): void {
    comboOpen = f.name;
    comboQuery = '';
    comboActive = Math.max(0, f.options.indexOf(val(f)));
  }
  function pickOption(f: InputField, o: string): void {
    set(f, o);
    comboOpen = null;
  }
  function comboKey(f: InputField, e: KeyboardEvent): void {
    const list = comboList(f);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (comboOpen !== f.name) return openCombo(f);
      if (list.length) comboActive = (comboActive + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    } else if (e.key === 'Enter' && comboOpen === f.name) {
      // Picks the highlighted option; the form's own ⏎ (send) must not fire.
      e.preventDefault();
      e.stopPropagation();
      if (list[comboActive] !== undefined) pickOption(f, list[comboActive]);
    } else if (e.key === 'Escape' && comboOpen === f.name) {
      e.preventDefault();
      e.stopPropagation();
      comboOpen = null;
    }
  }

  async function pickFile(f: InputField): Promise<void> {
    const path = await filePick().catch(() => null);
    if (path) set(f, path);
  }

  const heading = $derived.by(() => {
    if (request.attempt > 1) {
      const lead =
        single?.type === 'code'
          ? t('input.form.wrong')
          : t('input.form.rejected', { status: request.last?.status ?? '' });
      return `${lead} · ${t('input.form.attempt', { n: request.attempt, max: request.maxAttempts })}`;
    }
    return single && variant === 'popover' ? inputLabel(single.name, single) : t('input.form.waiting');
  });
  const retry = $derived(request.attempt > 1);
  const subline = $derived(
    retry && request.error ? `${request.error} — ${t('input.form.tryAgain')}` : single?.hint || '',
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="form {variant}" class:retry bind:this={root} {onkeydown} onsubmit={(e) => (e.preventDefault(), submit())}>
  <header>
    <span class="badge"><span class="material-symbols-outlined" aria-hidden="true">keyboard</span></span>
    {#if session}
      <b class="ttl">{t('sessionrun.prompt.title')}</b>
      <code class="scn">{session.scenario}</code>
    {:else if variant === 'popover'}
      <b class="ttl">{heading}</b>
      {#if single}<code class="var">{`{{${single.name}}}`}</code>{/if}
    {:else}
      <span class="state"><i class="dot"></i>{heading}</span>
      {#if request.fields.length > 1}<span class="n"
          >{request.fields.length} {tp(request.fields.length, ['поле', 'поля', 'полей'], ['field', 'fields'])}</span
        ><span class="where">{request.method} {request.requestName}</span>{/if}
      {#if request.resend}<button
          class="hbtn"
          type="button"
          title={t('input.form.skip')}
          aria-label={t('input.form.skip')}
          onclick={() => onskip?.()}><span class="material-symbols-outlined" aria-hidden="true">skip_next</span></button
        >{/if}
      {#if ttl > 0}<span class="timer" class:expired
          ><span class="material-symbols-outlined" aria-hidden="true">timer</span>{expired
            ? t('input.form.expired')
            : countdown(left)}</span
        >{/if}
    {/if}
  </header>

  {#if session}
    <div class="steps">
      {#each session.steps as step (step.name)}
        <span class="step {step.state}"
          ><span class="material-symbols-outlined" aria-hidden="true"
            >{step.state === 'done'
              ? 'check_circle'
              : step.state === 'now'
                ? 'keyboard'
                : 'radio_button_unchecked'}</span
          >{step.name}</span
        >
      {/each}
    </div>
    {#if retry}<p class="msg bad" role="alert">{heading}{request.error ? ` · ${request.error}` : ''}</p>{/if}
  {/if}

  {#if variant === 'card' && single}
    <div class="sub">
      <code>{request.method} {request.requestName}<span class="mid">·</span>{`{{${single.name}}}`}</code>
      <small
        >{inputLabel(single.name, single)}{#if subline}<span class="mid">·</span>{subline}{/if}</small
      >
    </div>
  {/if}

  {#each request.fields as f (f.name)}
    {@const err = visibleProblem(f)}
    <div class="fld" class:err={!!err}>
      {#if !(single && f.type === 'code' && variant === 'card') && !(variant === 'popover' && single && single.type === 'code')}
        <div class="lab">
          <b>{inputLabel(f.name, f)}</b>
          {#if f.hint && f.type !== 'code'}<small>{f.hint}</small>{:else if !f.required}<small
              >{t('input.form.optional')}</small
            >{/if}
          {#if lastValue(f) && f.type === 'select'}<small>{t('input.form.last', { value: lastValue(f) ?? '' })}</small
            >{/if}
          {#if request.fields.length > 1 && f.type === 'code'}<code class="vn">{`{{${f.name}}}`}</code>{/if}
        </div>
      {/if}

      {#if f.type === 'code'}
        <div class="cells" role="group" aria-label={inputLabel(f.name, f)}>
          {#each chars(f) as ch, i (i)}
            <input
              class="cell"
              class:err={!!err}
              data-field={f.name}
              value={ch}
              inputmode="numeric"
              autocomplete="one-time-code"
              aria-label={`${inputLabel(f.name, f)} ${i + 1}`}
              aria-invalid={err ? 'true' : undefined}
              oninput={(e) => cellInput(f, i, e)}
              onkeydown={(e) => cellKey(f, i, e)}
              onpaste={(e) => cellPaste(f, e)}
              onfocus={(e) => e.currentTarget.select()}
            />
          {/each}
        </div>
        {#if session && f.hint}
          <div class="clip">
            <span class="material-symbols-outlined" aria-hidden="true">content_paste</span>
            <span class="t">{`${f.hint} · ⌘V`}</span>
          </div>
        {/if}
        {#if clip}
          <div class="clip" class:stale={clipStale}>
            <span class="material-symbols-outlined" aria-hidden="true">content_paste</span>
            <span class="t"
              >{clipStale ? t('input.form.clipboardStale') : t('input.form.clipboard', { code: clipText })}</span
            >
            {#if !clipStale}<button type="button" class="kbd" onclick={() => fillCode(f, clip)}
                >{t('input.form.paste')}</button
              >{/if}
          </div>
        {/if}
      {:else if f.type === 'secret' || (f.secret && (f.type === 'text' || f.type === 'number'))}
        <div class="box" class:bad={!!err}>
          <input
            class="in"
            type={shown[f.name] ? 'text' : 'password'}
            value={val(f)}
            autocomplete="off"
            spellcheck="false"
            aria-invalid={err ? 'true' : undefined}
            aria-label={inputLabel(f.name, f)}
            oninput={(e) => set(f, e.currentTarget.value)}
          />
          <button
            type="button"
            class="ico"
            aria-label={shown[f.name] ? t('input.form.hide') : t('input.form.show')}
            onclick={() => (shown[f.name] = !shown[f.name])}
            ><span class="material-symbols-outlined" aria-hidden="true"
              >{shown[f.name] ? 'visibility_off' : 'visibility'}</span
            ></button
          >
        </div>
      {:else if f.type === 'number'}
        <div class="box" class:bad={!!err}>
          <input
            class="in code"
            type="text"
            inputmode="decimal"
            value={val(f)}
            autocomplete="off"
            aria-invalid={err ? 'true' : undefined}
            aria-label={inputLabel(f.name, f)}
            oninput={(e) => set(f, e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                step(f, e.key === 'ArrowUp' ? 1 : -1);
              }
            }}
          />
          <button type="button" class="ico" aria-label={t('input.form.stepper.down')} onclick={() => step(f, -1)}
            ><span class="material-symbols-outlined" aria-hidden="true">remove</span></button
          >
          <button type="button" class="ico" aria-label={t('input.form.stepper.up')} onclick={() => step(f, 1)}
            ><span class="material-symbols-outlined" aria-hidden="true">add</span></button
          >
        </div>
      {:else if f.type === 'select'}
        {#if f.options.length <= 4}
          <div class="segs" role="radiogroup" aria-label={inputLabel(f.name, f)}>
            {#each f.options as o (o)}
              <button
                class="seg"
                class:on={val(f) === o}
                type="button"
                role="radio"
                aria-checked={val(f) === o}
                onclick={() => set(f, o)}>{o}</button
              >
            {/each}
          </div>
        {:else}
          <!-- More than four options: a combobox that filters as you type (↑↓ move, ⏎ picks, Esc closes). -->
          <div class="combo">
            <div class="box" class:bad={!!err}>
              <input
                class="in"
                type="text"
                role="combobox"
                aria-expanded={comboOpen === f.name}
                aria-controls="combo-{f.name}"
                aria-autocomplete="list"
                aria-invalid={err ? 'true' : undefined}
                aria-label={inputLabel(f.name, f)}
                autocomplete="off"
                spellcheck="false"
                placeholder={t('input.form.search')}
                value={comboOpen === f.name ? comboQuery : val(f)}
                onfocus={() => openCombo(f)}
                onclick={() => comboOpen !== f.name && openCombo(f)}
                oninput={(e) => {
                  comboQuery = e.currentTarget.value;
                  comboActive = 0;
                }}
                onkeydown={(e) => comboKey(f, e)}
                onblur={() => (comboOpen = null)}
              />
              <button
                type="button"
                class="ico"
                tabindex="-1"
                aria-label={inputLabel(f.name, f)}
                onpointerdown={(e) => e.preventDefault()}
                onclick={(e) => {
                  const input = e.currentTarget.parentElement?.querySelector('input');
                  if (comboOpen === f.name) comboOpen = null;
                  else input?.focus();
                }}><span class="material-symbols-outlined" aria-hidden="true">expand_more</span></button
              >
            </div>
            {#if comboOpen === f.name}
              <ul class="opts" id="combo-{f.name}" role="listbox">
                {#each comboList(f) as o, i (o)}
                  <li
                    role="option"
                    aria-selected={val(f) === o}
                    class:active={i === comboActive}
                    onpointerdown={(e) => {
                      e.preventDefault();
                      pickOption(f, o);
                    }}
                    onpointerenter={() => (comboActive = i)}
                  >
                    {o}{#if val(f) === o}<span class="material-symbols-outlined tick" aria-hidden="true">check</span
                      >{/if}
                  </li>
                {:else}
                  <li class="none" role="presentation">{t('input.form.noMatch')}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      {:else if f.type === 'bool'}
        <div class="segs two" role="radiogroup" aria-label={inputLabel(f.name, f)}>
          <button
            class="seg"
            class:on={val(f) === 'false'}
            type="button"
            role="radio"
            aria-checked={val(f) === 'false'}
            onclick={() => set(f, 'false')}>{t('input.form.no')}</button
          >
          <button
            class="seg yes"
            class:on={val(f) === 'true'}
            type="button"
            role="radio"
            aria-checked={val(f) === 'true'}
            onclick={() => set(f, 'true')}>{t('input.form.yes')}</button
          >
        </div>
      {:else if f.type === 'json'}
        <textarea
          class="area"
          class:bad={!!err}
          rows="4"
          spellcheck="false"
          value={val(f)}
          aria-invalid={err ? 'true' : undefined}
          aria-label={inputLabel(f.name, f)}
          oninput={(e) => set(f, e.currentTarget.value)}></textarea>
      {:else if f.type === 'file'}
        <div class="box" class:bad={!!err}>
          <span class="material-symbols-outlined fi" aria-hidden="true">description</span>
          <input
            class="in"
            type="text"
            value={val(f)}
            spellcheck="false"
            placeholder={t('input.form.dropFile')}
            aria-invalid={err ? 'true' : undefined}
            aria-label={inputLabel(f.name, f)}
            oninput={(e) => set(f, e.currentTarget.value)}
          />
          <button
            type="button"
            class="ico pickbtn"
            aria-label={t('input.form.pickFile')}
            onclick={() => void pickFile(f)}
            ><span class="material-symbols-outlined" aria-hidden="true">folder_open</span></button
          >
        </div>
      {:else}
        <div class="box" class:bad={!!err}>
          <input
            class="in"
            type="text"
            value={val(f)}
            autocomplete="off"
            spellcheck="false"
            aria-invalid={err ? 'true' : undefined}
            aria-label={inputLabel(f.name, f)}
            oninput={(e) => set(f, e.currentTarget.value)}
          />
        </div>
      {/if}

      {#if err}
        <p class="msg bad" role="alert">{err}</p>
      {:else if f.type === 'json' && val(f).trim()}
        <p class="msg ok">
          <span class="material-symbols-outlined" aria-hidden="true">check</span>{t('input.form.validJson')}
        </p>
      {:else if f.type === 'bool'}
        <p class="msg">{t('input.form.noStops')}</p>
      {:else if f.type === 'file'}
        <p class="msg">{t('input.form.fileMode')}</p>
      {/if}
    </div>
  {/each}

  <footer>
    {#if variant === 'popover'}
      <span class="sp"></span>
      <button class="btn quiet" type="button" onclick={() => oncancel?.()}
        >{session ? t('sessionrun.prompt.later') : t('input.form.cancel')}</button
      >
      <button class="btn primary" type="submit"
        >{session ? (submitLabel ?? t('sessionrun.prompt.retry')) : t('input.form.send')}<kbd>⏎</kbd></button
      >
    {:else if request.resend}
      <button
        class="btn quiet resend"
        class:hot={expired}
        type="button"
        title={t('input.form.resendTitle', { name: request.resend })}
        onclick={() => onresend?.()}
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>{request.attempt > 1
          ? t('input.form.newCode')
          : t('input.form.resend')}
      </button>
      <span class="sp"></span>
      <button class="btn primary" type="submit">{t('input.form.continue')}<kbd>⏎</kbd></button>
    {:else}
      <button class="btn quiet" type="button" onclick={() => onskip?.()}>
        <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>{t('input.form.skip')}
      </button>
      <span class="sp"></span>
      <button class="btn primary" type="submit">{t('input.form.continue')}<kbd>⏎</kbd></button>
    {/if}
  </footer>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-family: var(--font-ui);
    font-size: var(--font-size-body);
    color: var(--color-text-secondary);
  }
  .form.popover {
    width: 300px;
    padding: 14px;
    background: var(--color-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    box-shadow: 0 14px 36px var(--color-shadow);
  }
  .form.card {
    padding: 14px;
    border: 1px solid var(--color-ask);
    border-radius: var(--radius-card);
    background: var(--color-panel);
  }
  .form.card.retry {
    border-color: var(--color-danger);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
  }
  .badge {
    display: grid;
    place-items: center;
    flex: 0 0 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--color-ask-soft);
    color: var(--color-ask);
  }
  .card .badge {
    display: none;
  }
  .badge .material-symbols-outlined {
    font-size: 13px;
  }
  .ttl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }
  .var,
  .vn {
    font-family: var(--font-code);
    font-size: var(--font-size-caption);
    color: var(--color-ask);
  }
  .scn {
    flex: none;
    font-family: var(--font-code);
    font-size: var(--font-size-caption);
    color: var(--color-ask);
  }
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: var(--font-size-caption);
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-muted);
  }
  .step .material-symbols-outlined {
    font-size: 14px;
  }
  .step.done {
    color: var(--color-text-secondary);
  }
  .step.done .material-symbols-outlined {
    color: var(--color-success);
  }
  .step.now {
    color: var(--color-ask);
    font-weight: var(--weight-semibold);
  }
  .state {
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
    color: var(--color-ask);
  }
  .retry .state {
    color: var(--color-danger);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .n {
    flex: none;
    white-space: nowrap;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
    color: var(--color-ask);
  }
  .where {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-family: var(--font-code);
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
  }
  .sub {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sub code {
    font-family: var(--font-code);
    font-size: var(--font-size-ui);
    color: var(--color-text);
  }
  .sub small {
    font-size: var(--font-size-body);
    color: var(--color-text-secondary);
  }
  .mid {
    margin: 0 8px;
    color: var(--color-text-muted);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lab {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .lab b {
    font-size: var(--font-size-body);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }
  .lab small,
  .msg {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
  }
  .lab .vn {
    margin-left: auto;
  }
  .cells {
    display: flex;
    gap: 6px;
  }
  .cell {
    flex: 1;
    min-width: 0;
    height: 44px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 8px;
    background: var(--color-field);
    color: var(--color-text);
    font-family: var(--font-code);
    font-size: 20px;
    font-weight: var(--weight-medium);
    text-align: center;
    outline: none;
    caret-color: var(--color-ask);
  }
  .form .cell.cell:focus,
  .form .cell.cell:focus-visible {
    border-color: var(--color-ask);
    box-shadow: none;
    outline: none;
  }
  .form .cell.cell.err,
  .form .cell.cell.err:focus {
    border-color: var(--color-danger);
  }
  .clip {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 6px 6px 6px 12px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .clip .material-symbols-outlined {
    font-size: 15px;
    color: var(--color-text-muted);
  }
  .clip .t {
    flex: 1;
  }
  .kbd {
    padding: 2px 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-raised);
    color: var(--color-text);
    font: inherit;
    font-weight: var(--weight-medium);
  }
  .box {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 0 8px 0 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--color-field);
  }
  .box:focus-within {
    border-color: var(--color-ask);
    box-shadow: 0 0 0 3px var(--color-ask-soft);
  }
  .box.bad {
    border-color: var(--color-danger);
  }
  .in {
    flex: 1;
    min-width: 0;
    height: 38px;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-ui);
  }
  .in.code {
    font-family: var(--font-code);
  }
  /* The box around it shows the focus; a ring on the bare input would draw a second edge inside it. */
  .form .in.in:focus,
  .form .in.in:focus-visible,
  .form .area.area:focus-visible {
    box-shadow: none;
    outline: none;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-muted);
  }
  .ico:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .ico .material-symbols-outlined,
  .fi {
    font-size: 16px;
  }
  .combo {
    position: relative;
  }
  .opts {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    max-height: 200px;
    margin: 0;
    padding: 4px;
    overflow: auto;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-raised);
    box-shadow: 0 10px 28px var(--color-shadow);
  }
  .opts li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--font-size-ui);
    cursor: pointer;
  }
  .opts li.active {
    background: var(--color-hover);
  }
  .opts li.none {
    color: var(--color-text-muted);
    cursor: default;
  }
  .opts .tick {
    font-size: 15px;
    color: var(--color-ask);
  }
  .segs {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--color-field);
  }
  .seg {
    flex: 1;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-medium);
  }
  .seg.on {
    background: var(--color-raised);
    color: var(--color-text);
  }
  .segs.two {
    padding: 0;
    background: transparent;
  }
  .segs.two .seg {
    height: 38px;
    border-radius: var(--radius-sm);
    background: var(--color-field);
  }
  .segs.two .seg.yes.on {
    border-color: var(--color-ask);
    background: var(--color-ask-soft);
    color: var(--color-ask);
  }
  .area {
    min-height: 72px;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    font-family: var(--font-code);
    font-size: var(--font-size-body);
    resize: vertical;
    outline: 0;
  }
  .area:focus {
    border-color: var(--color-ask);
  }
  .area.bad {
    border-color: var(--color-danger);
  }
  .msg {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .msg.bad {
    color: var(--color-danger);
  }
  .msg.ok {
    color: var(--color-success);
  }
  .msg .material-symbols-outlined {
    font-size: 13px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sp {
    flex: 1;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    gap: 6px;
    height: 28px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-control);
    font: inherit;
    font-size: var(--font-size-ui);
    font-weight: var(--weight-medium);
  }
  .btn.quiet {
    min-width: 0;
    padding: 0 8px;
    background: transparent;
    color: var(--color-text-secondary);
  }
  .btn.primary {
    flex: none;
  }

  .btn.quiet.resend {
    flex: none;
  }
  /* The card is narrow: «Отправить заново» and «Продолжить» must fit side by side. */
  .card footer .btn {
    gap: 4px;
    font-size: var(--font-size-body);
  }
  .card footer .btn.primary {
    padding: 0 12px;
  }
  .btn.quiet.resend.hot {
    background: var(--color-ask-soft);
    color: var(--color-ask);
  }
  .hbtn {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-muted);
  }
  .hbtn:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .hbtn .material-symbols-outlined {
    font-size: 15px;
  }
  .hbtn + .timer {
    margin-left: 0;
  }
  .timer {
    margin-left: auto;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-muted);
    font: 11px var(--font-code);
  }
  .timer.expired {
    color: var(--color-danger);
  }
  .timer .material-symbols-outlined {
    font-size: 13px;
  }
  .btn.quiet:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .btn.primary {
    background: var(--color-action);
    color: var(--color-on-action);
  }
  .btn kbd {
    font: inherit;
    opacity: 0.7;
  }
  .btn .material-symbols-outlined {
    font-size: 16px;
  }
</style>
