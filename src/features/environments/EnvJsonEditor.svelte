<script lang="ts">
  /**
   * The JSON view of one environment (Flow · Окружения из JSON): the editor and the bar under it with the
   * verdict (valid + what changes / the syntax error), «Формат» (⇧⌥F), «Копировать» and the quick fix
   * for a missing comma. In `create` mode the bar names the detected format and offers a format picker.
   * The text and its parse result live in the parent, which applies a valid result to the draft.
   */
  import { keymap } from '@codemirror/view';
  import { t, tp } from '$shared/i18n';
  import { CodeEditor } from '$shared/editor/components';
  import { parseJsonForBeautify } from '$shared/editor';
  import {
    diffEnvRows,
    lineCol,
    mergeEnvRows,
    type EnvJsonFormat,
    type EnvJsonError,
    type ParsedEnv,
    type VarRow,
  } from '$shared/model';
  import { envJsonDecor } from './envJsonDecor';

  type Result = { ok: true; env: ParsedEnv } | { ok: false; error: EnvJsonError };
  type Fmt = EnvJsonFormat | undefined;

  const {
    text,
    onChange,
    result,
    base,
    docId,
    create = false,
    format,
    onFormat,
  }: {
    text: string;
    onChange: (text: string) => void;
    result: Result;
    /** The variables the JSON is compared with (what is already in the environment). */
    base: VarRow[];
    docId: string;
    create?: boolean;
    format?: Fmt;
    onFormat?: (format: Fmt) => void;
  } = $props();

  let copied = $state(false);

  function reformat(): void {
    try {
      const next = JSON.stringify(parseJsonForBeautify(text), null, 2);
      if (next !== text) onChange(next);
    } catch {
      /* invalid JSON: the bar already says why */
    }
  }

  function addComma(): void {
    if (!result.ok && result.error.fixAt !== undefined)
      onChange(`${text.slice(0, result.error.fixAt)},${text.slice(result.error.fixAt)}`);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  function errorText(e: EnvJsonError): string {
    if (e.code === 'shape' || e.code === 'empty') return t(`env.json.err.${e.code}`);
    const { line, col } = lineCol(text, e.pos);
    const msg =
      e.code === 'comma'
        ? t('env.json.err.comma', { value: e.detail })
        : e.code === 'unexpected'
          ? t('env.json.err.unexpected', { ch: e.detail })
          : t(`env.json.err.${e.code}`);
    return t('env.json.err.at', { line, col, msg });
  }

  const vars = (n: number) => `${n} ${tp(n, ['переменная', 'переменные', 'переменных'], ['variable', 'variables'])}`;

  /** «5 переменных · 1 секрет · 1 выключена» */
  function stats(rows: VarRow[]): string {
    const secrets = rows.filter((r) => r.secret).length;
    const off = rows.filter((r) => !r.enabled).length;
    return [
      vars(rows.length),
      secrets && `${secrets} ${tp(secrets, ['секрет', 'секрета', 'секретов'], ['secret', 'secrets'])}`,
      off && `${off} ${tp(off, ['выключена', 'выключены', 'выключено'], ['disabled', 'disabled'])}`,
    ]
      .filter(Boolean)
      .join('  ·  ');
  }

  /** «JSON валиден · 5 переменных · +1 новая: timeoutMs · изменено: 2» */
  function verdict(env: ParsedEnv): string {
    const next = mergeEnvRows(base, env.rows, 'replace');
    const d = diffEnvRows(base, next);
    const names = d.added.length > 2 ? `${d.added.slice(0, 2).join(', ')}…` : d.added.join(', ');
    return [
      t('env.json.valid'),
      vars(next.length),
      d.added.length &&
        t('env.json.added', {
          n: d.added.length,
          word: tp(d.added.length, ['новая', 'новые', 'новых'], ['new', 'new']),
          names,
        }),
      d.changed.length && t('env.json.changed', { n: d.changed.length }),
      d.removed.length && t('env.json.removed', { n: d.removed.length }),
    ]
      .filter(Boolean)
      .join('  ·  ');
  }

  const FORMATS: Fmt[] = [undefined, 'flat', 'postman', 'insomnia'];
  const formatLabel = (f: Fmt): string => (f === 'flat' ? t('env.fmt.object') : t(`env.fmt.${f ?? 'auto'}`));

  const extensions = $derived([
    envJsonDecor({ chip: t('env.json.secret_chip'), hint: (code) => t(`env.json.hint.${code}`) }),
    keymap.of([
      {
        key: 'Shift-Alt-f',
        run: () => {
          reformat();
          return true;
        },
      },
    ]),
  ]);
</script>

<div class="envjson">
  <div class="ed">
    <CodeEditor
      value={text}
      {onChange}
      lang="json"
      {docId}
      fill
      bare
      folding={false}
      ariaLabel={t('env.json.aria')}
      {extensions}
    />
  </div>
  <div class="bar">
    {#if result.ok}
      <span class="material-symbols-outlined state ok" aria-hidden="true">check_circle</span>
      {#if create}
        <span class="msg"><b>{t(`env.fmt.${result.env.format}`)}</b>&nbsp;&nbsp;{stats(result.env.rows)}</span>
      {:else}
        <span class="msg">{verdict(result.env)}</span>
      {/if}
    {:else if result.error.code === 'empty'}
      <span class="msg muted">{errorText(result.error)}</span>
    {:else}
      <span class="material-symbols-outlined state err" aria-hidden="true">error</span>
      <span class="msg err" role="alert">{errorText(result.error)}</span>
    {/if}

    {#if create}
      <select
        class="fmt"
        aria-label={t('env.create.format_aria')}
        value={format ?? ''}
        onchange={(e) => onFormat?.((e.currentTarget.value || undefined) as Fmt)}
      >
        {#each FORMATS as f (f ?? 'auto')}
          <option value={f ?? ''}>{t('env.create.format', { name: formatLabel(f) })}</option>
        {/each}
      </select>
    {:else}
      {#if !result.ok && result.error.code === 'comma'}
        <button class="act" type="button" onclick={addComma}
          ><span class="material-symbols-outlined" aria-hidden="true">help</span>{t('env.json.add_comma')}</button
        >
      {/if}
      <button class="act" type="button" disabled={!result.ok} aria-label={t('env.json.format_aria')} onclick={reformat}
        ><span class="material-symbols-outlined" aria-hidden="true">format_align_left</span>{t('env.json.format')}
        <kbd>⇧⌥F</kbd></button
      >
      {#if result.ok}
        <button class="act" type="button" onclick={copy}
          ><span class="material-symbols-outlined" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>{t(
            'common.copy',
          )}</button
        >
      {/if}
    {/if}
  </div>
</div>

<style>
  .envjson {
    flex: 1;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
  }
  .ed {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 0 0;
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 14px;
    border-top: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
  }
  .state {
    flex: none;
    font-size: 16px;
  }
  .state.ok {
    color: var(--color-success);
  }
  .state.err,
  .msg.err {
    color: var(--color-danger);
  }
  .msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .msg b {
    color: var(--color-text);
    font-weight: 600;
  }
  .msg.muted {
    color: var(--color-text-muted);
  }
  .act {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }
  .act:hover:not(:disabled) {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .act:disabled {
    color: var(--color-text-muted);
    opacity: 0.6;
  }
  .act .material-symbols-outlined {
    font-size: 16px;
  }
  .act kbd {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-ui);
  }
  .fmt {
    flex: none;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-raised);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }

  .ed :global(.cm-line.env-err-line) {
    background: var(--color-danger-soft);
  }
  .ed :global(.env-hint),
  .ed :global(.env-chip) {
    margin-left: 12px;
    font: var(--font-size-caption) var(--font-ui);
  }
  .ed :global(.env-hint) {
    color: var(--color-danger);
  }
  .ed :global(.env-chip) {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-hover);
    color: var(--color-text-muted);
  }
</style>
