<script lang="ts">
  /**
   * The field settings of an «ask on send» variable (Flow · Сценарий с вводом OT1 / IN1): a short form
   * for the common case (label + format) and every setting of the type behind «Все настройки».
   * Edits save at once; the typed value itself is never stored.
   */
  import { untrack } from 'svelte';
  import { t } from '$shared/i18n';
  import {
    INPUT_FORMATS,
    INPUT_ICON,
    INPUT_KINDS,
    codeLength,
    newInput,
    type InputDef,
    type InputKind,
  } from '$shared/model';
  import { askUi, inputs, lastValue, setAsked } from './store.svelte';
  import { Switch } from '$shared/ui/components';

  let { target }: { target: { name: string; left: number; right: number; top: number; bottom: number } } = $props();

  const name = $derived(target.name);
  const def = $derived<InputDef | undefined>(inputs.defs[name]);

  /** A kind the short form can't express (list, JSON, file, odd code length) opens the full form. */
  const quick = (d: InputDef) =>
    INPUT_FORMATS.some((f) => f.type === d.type && (f.type !== 'code' || f.length === codeLength(d)));
  let expanded = $state(untrack(() => (def ? !quick(def) : false)));
  let typeOpen = $state(false);
  let formatOpen = $state(false);

  const WIDTH = 300;
  let card = $state<HTMLDivElement>();
  let top = $state(0);
  const left = $derived(Math.max(8, Math.min(target.left, window.innerWidth - WIDTH - 8)));
  // Under the chip; above it when the form would run off the bottom of the window.
  $effect(() => {
    void expanded;
    if (!card) return;
    const h = card.offsetHeight;
    top = target.bottom + 6 + h <= window.innerHeight - 8 ? target.bottom + 6 : Math.max(8, target.top - 6 - h);
  });
  // The type list opens on the side that has room.
  const listRight = $derived(left + WIDTH + 8 + 260 <= window.innerWidth);

  function patch(p: Partial<InputDef>): void {
    if (def) setAsked(name, { ...def, ...p });
  }

  function setKind(type: InputKind): void {
    if (!def) return;
    const fresh = newInput(type);
    // Keep what the new type shares: the label, the hint, requiredness and prefill.
    setAsked(name, {
      ...fresh,
      label: def.label,
      hint: def.hint,
      required: def.required,
      remember: type === 'secret' ? false : def.remember,
      secret: type === 'secret' ? false : def.secret,
    });
    typeOpen = false;
  }

  function setFormat(id: string): void {
    const f = INPUT_FORMATS.find((x) => x.id === id);
    if (!f) return;
    setKind(f.type);
    if (f.length) patch({ length: f.length });
    formatOpen = false;
  }

  const formatLabel = (d: InputDef): string => {
    const f = INPUT_FORMATS.find((x) => x.type === d.type && (x.type !== 'code' || x.length === codeLength(d)));
    if (f) return t(`input.format.${f.id}`);
    return d.type === 'code' ? `${codeLength(d)}` : t(`input.kind.${d.type}`);
  };

  const num = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

  let optionDraft = $state('');
  function addOption(): void {
    const v = optionDraft.trim();
    if (!def || !v || def.options.includes(v)) return;
    patch({ options: [...def.options, v] });
    optionDraft = '';
  }
  function removeOption(o: string): void {
    if (!def) return;
    patch({ options: def.options.filter((x) => x !== o), default: def.default === o ? '' : def.default });
  }

  const remembered = $derived(def ? lastValue({ ...def, name }) : undefined);

  function stop(): void {
    setAsked(name, null);
    askUi.close();
  }
</script>

{#snippet toggle(label: string, desc: string, on: boolean, change: (v: boolean) => void)}
  <div class="row tog">
    <span class="txt"
      >{label}{#if desc}<small>{desc}</small>{/if}</span
    >
    <Switch checked={on} aria-label={label} onclick={() => change(!on)} />
  </div>
{/snippet}

<button class="bs-backdrop" type="button" aria-label={t('input.form.cancel')} onclick={() => askUi.close()}></button>
{#if def}
  <div class="ask" role="dialog" aria-label={t('input.set.title')} bind:this={card} style="left:{left}px; top:{top}px">
    <header>
      <span class="badge"><span class="material-symbols-outlined" aria-hidden="true">keyboard</span></span>
      {#if expanded}
        <span class="title"><code>{name}</code><small>· {t('input.set.titleVar')}</small></span>
      {:else}
        <span class="title"><b>{t('input.set.title')}</b></span>
      {/if}
      <button
        class="more"
        type="button"
        aria-label={t('input.set.more')}
        title={t('input.set.more')}
        aria-pressed={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
      </button>
    </header>

    {#if expanded}
      <div class="row">
        <span class="lbl">{t('input.set.type')}</span>
        <button
          class="field pick"
          class:open={typeOpen}
          type="button"
          aria-haspopup="listbox"
          onclick={() => (typeOpen = !typeOpen)}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{INPUT_ICON[def.type]}</span>
          <span class="val">{t(`input.kind.${def.type}`)}</span>
          <span class="material-symbols-outlined chev" aria-hidden="true">expand_more</span>
        </button>
      </div>
    {/if}

    <div class="row">
      <label class="lbl" for="ask-label">{t('input.set.label')}</label>
      <input
        id="ask-label"
        class="field"
        type="text"
        value={def.label}
        placeholder={t('input.set.labelPh')}
        spellcheck="false"
        oninput={(e) => patch({ label: e.currentTarget.value })}
      />
    </div>

    {#if !expanded}
      <div class="row">
        <span class="lbl">{t('input.set.format')}</span>
        <button
          class="field pick"
          class:open={formatOpen}
          type="button"
          aria-haspopup="listbox"
          onclick={() => (formatOpen = !formatOpen)}
        >
          <span class="val">{formatLabel(def)}</span>
          <span class="material-symbols-outlined chev" aria-hidden="true">expand_more</span>
        </button>
        {#if formatOpen}
          <div class="list" role="listbox">
            {#each INPUT_FORMATS as f (f.id)}
              <button
                class="opt"
                type="button"
                role="option"
                aria-selected={formatLabel(def) === t(`input.format.${f.id}`)}
                onclick={() => setFormat(f.id)}
              >
                {t(`input.format.${f.id}`)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="note">
        <span class="material-symbols-outlined" aria-hidden="true">visibility_off</span>{t('input.set.note')}
      </div>
    {:else}
      <div class="row">
        <label class="lbl" for="ask-hint">{t('input.set.hint')}</label>
        <input
          id="ask-hint"
          class="field"
          type="text"
          value={def.hint}
          spellcheck="false"
          oninput={(e) => patch({ hint: e.currentTarget.value })}
        />
      </div>

      {#if def.type === 'select'}
        <div class="row">
          <span class="lbl">{t('input.set.options')}</span>
          <div class="chips">
            {#each def.options as o (o)}
              <span class="chip" class:def={def.default === o}>
                <span>{o}</span>
                <button
                  type="button"
                  class="star"
                  title={t('input.set.optionDefault')}
                  aria-label={t('input.set.optionDefault')}
                  aria-pressed={def.default === o}
                  onclick={() => patch({ default: def.default === o ? '' : o })}
                  ><span class="material-symbols-outlined" aria-hidden="true"
                    >{def.default === o ? 'star' : 'star_border'}</span
                  ></button
                >
                <button type="button" class="x" aria-label={o} onclick={() => removeOption(o)}
                  ><span class="material-symbols-outlined" aria-hidden="true">close</span></button
                >
              </span>
            {/each}
            <input
              class="add"
              type="text"
              bind:value={optionDraft}
              placeholder="+"
              aria-label={t('input.set.optionAdd')}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOption();
                }
              }}
              onblur={addOption}
            />
          </div>
        </div>
      {:else if def.type === 'number'}
        <div class="row">
          <span class="lbl">{t('input.kind.number')}</span>
          <div class="trio">
            {#each [['min', 'min'], ['max', 'max'], ['step', 'step']] as [k, key] (k)}
              <label class="field mini"
                ><span>{t(`input.set.${k}`)}</span><input
                  type="text"
                  inputmode="decimal"
                  value={def[key as 'min' | 'max' | 'step'] ?? ''}
                  oninput={(e) => patch({ [key]: num(e.currentTarget.value) })}
                /></label
              >
            {/each}
          </div>
        </div>
      {:else if def.type === 'code'}
        <div class="row">
          <label class="lbl" for="ask-len">{t('input.set.length')}</label>
          <input
            id="ask-len"
            class="field"
            type="number"
            min="1"
            max="12"
            value={codeLength(def)}
            oninput={(e) =>
              patch({ length: Math.min(12, Math.max(1, Math.trunc(Number(e.currentTarget.value)) || 6)) })}
          />
        </div>
        <div class="row">
          <label class="lbl" for="ask-ttl">{t('input.set.ttl')}</label>
          <label class="field mini" title={t('input.set.ttlHint')}
            ><input
              id="ask-ttl"
              type="number"
              min="0"
              max="3600"
              value={def.ttl || ''}
              placeholder="—"
              oninput={(e) =>
                patch({ ttl: Math.min(3600, Math.max(0, Math.trunc(Number(e.currentTarget.value)) || 0)) })}
            /><span>{t('input.set.ttlUnit')}</span></label
          >
        </div>
      {:else if def.type === 'text'}
        <div class="row">
          <label class="lbl" for="ask-pattern">{t('input.set.pattern')}</label>
          <input
            id="ask-pattern"
            class="field code"
            type="text"
            value={def.pattern}
            placeholder={'^.+@.+\\..+$'}
            spellcheck="false"
            oninput={(e) => patch({ pattern: e.currentTarget.value })}
          />
        </div>
      {/if}

      {@render toggle(t('input.set.required'), '', def.required, (v) => patch({ required: v }))}
      {#if def.type !== 'secret' && def.type !== 'code'}
        {@render toggle(
          t('input.set.remember'),
          remembered ? t('input.set.remember.desc', { value: remembered }) : t('input.set.remember.none'),
          def.remember && !def.secret,
          (v) => patch({ remember: v }),
        )}
        {@render toggle(t('input.set.secret'), t('input.set.secret.desc'), def.secret, (v) =>
          patch({ secret: v, remember: v ? false : def.remember }),
        )}
      {/if}
      <div class="foot">
        <button class="stop" type="button" onclick={stop}>{t('input.set.remove')}</button>
      </div>
    {/if}
  </div>

  {#if expanded && typeOpen}
    <div
      class="types"
      role="listbox"
      aria-label={t('input.kind.heading')}
      style="top:{top}px; {listRight ? `left:${left + WIDTH + 8}px` : `left:${Math.max(8, left - 268)}px`}"
    >
      <div class="head">{t('input.kind.heading')}</div>
      {#each INPUT_KINDS as k (k)}
        <button
          class="type"
          class:on={def.type === k}
          type="button"
          role="option"
          aria-selected={def.type === k}
          onclick={() => setKind(k)}
        >
          <span class="tile"><span class="material-symbols-outlined" aria-hidden="true">{INPUT_ICON[k]}</span></span>
          <span class="txt">{t(`input.kind.${k}`)}<small>{t(`input.kind.${k}.desc`)}</small></span>
          {#if def.type === k}<span class="material-symbols-outlined tick" aria-hidden="true">check</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .ask,
  .types {
    position: fixed;
    z-index: 80;
    background: var(--color-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    box-shadow: 0 14px 36px var(--color-shadow);
    font-family: var(--font-ui);
    font-size: var(--font-size-body);
    color: var(--color-text-secondary);
  }
  .ask {
    width: 300px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--color-ask-soft);
    color: var(--color-ask);
  }
  .badge .material-symbols-outlined {
    font-size: 13px;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
  }
  .title b {
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }
  .title code {
    font-family: var(--font-code);
    font-size: var(--font-size-ui);
    font-weight: var(--weight-semibold);
    color: var(--color-ask);
  }
  .title small {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .more {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text-muted);
  }
  .more:hover,
  .more[aria-pressed='true'] {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .more .material-symbols-outlined,
  .note .material-symbols-outlined {
    font-size: 15px;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
  }
  .lbl {
    flex: 0 0 62px;
    font-size: var(--font-size-body);
    color: var(--color-text-muted);
  }
  .field {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-ui);
    outline: none;
  }
  .field:focus-visible,
  .field.open {
    border-color: var(--color-ask);
    box-shadow: 0 0 0 3px var(--color-ask-soft);
  }
  .field.code {
    font-family: var(--font-code);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    cursor: pointer;
  }
  .pick .material-symbols-outlined {
    font-size: 16px;
    color: var(--color-text-secondary);
  }
  .pick .val {
    flex: 1;
  }
  .pick .chev {
    color: var(--color-text-muted);
  }
  .list {
    position: absolute;
    left: 72px;
    right: 0;
    top: 38px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    padding: 4px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-raised);
    box-shadow: 0 10px 28px var(--color-shadow);
  }
  .opt {
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-ui);
    text-align: left;
  }
  .opt:hover,
  .opt[aria-selected='true'] {
    background: var(--color-hover);
  }
  .chips {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    padding: 0 4px 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text);
    font-size: var(--font-size-body);
    font-weight: var(--weight-medium);
  }
  .chip.def {
    background: var(--color-ask-soft);
    color: var(--color-ask);
  }
  .chip button {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.55;
  }
  .chip button:hover,
  .chip.def .star {
    opacity: 1;
  }
  .chip .x {
    display: none;
  }
  .chip:hover .x {
    display: grid;
  }
  .chip .material-symbols-outlined {
    font-size: 13px;
  }
  .ask .field.field:focus-visible,
  .ask .add.add:focus-visible,
  .ask .mini input:focus-visible {
    outline: none;
  }
  .add {
    width: 40px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-body);
    outline: none;
  }
  .add:focus {
    width: 96px;
    background: var(--color-field);
  }
  .trio {
    flex: 1;
    display: flex;
    gap: 6px;
  }
  .field.mini {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
  }
  .field.mini span {
    font-size: var(--font-size-micro);
    color: var(--color-text-muted);
  }
  .field.mini input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-ui);
  }
  .tog {
    justify-content: space-between;
    align-items: flex-start;
    padding: 2px 0;
  }
  .txt {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--color-text);
    font-size: var(--font-size-ui);
  }
  .txt small {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--color-border-subtle);
  }
  .stop {
    border: 0;
    background: transparent;
    color: var(--color-danger);
    font: inherit;
    font-size: var(--font-size-body);
  }
  .types {
    width: 260px;
    padding: 8px;
  }
  .types .head {
    padding: 4px 8px 8px;
    font-family: var(--font-code);
    font-size: var(--font-size-micro);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--color-text-muted);
  }
  .type {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    text-align: left;
  }
  .type:hover,
  .type.on {
    background: var(--color-hover);
  }
  .tile {
    display: grid;
    place-items: center;
    flex: 0 0 28px;
    height: 28px;
    border-radius: var(--radius-xs);
    color: var(--color-text-secondary);
  }
  .type.on .tile,
  .tick {
    color: var(--color-ask);
  }
  .tile .material-symbols-outlined {
    font-size: 17px;
  }
  .type .txt {
    flex: 1;
  }
  .tick {
    font-size: 16px;
  }
</style>
