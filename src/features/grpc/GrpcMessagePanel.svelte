<script lang="ts">
  /**
   * The gRPC "Message" tab: the schema-source chooser while nothing is loaded
   * yet (G1), otherwise the JSON message editor with schema-driven field
   * completions (G4) and the validation line under it (S24).
   */
  import { tick } from 'svelte';
  import type { Extension } from '@codemirror/state';
  import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
  import { t, tp } from '$shared/i18n';
  import { errorFieldLines } from '$shared/editor';
  import { checkGrpcMessage, atTopLevelKey, requestRuntime, type GrpcMessageIssue } from '$entities/request';
  import { fieldCompletionOptions } from './grpcEditor';
  import type { Tab, GrpcMethod } from '$shared/model';
  import { CodeEditor } from '$shared/editor/components';
  import { BodyPanel, BodyCode, BodyHead } from '$entities/request/components';

  let {
    tab,
    selectedMethod,
    chooseSchema,
    varHighlight,
    ensureConnected,
    onMessageChange,
    onChooseSource,
  }: {
    tab: Tab;
    selectedMethod: GrpcMethod | undefined;
    /** No schema, method or message yet: show the source chooser instead of the editor. */
    chooseSchema: boolean;
    varHighlight: Extension;
    ensureConnected: () => Promise<void>;
    onMessageChange: (value: string) => void;
    onChooseSource: (source: 'reflection' | 'proto') => void;
  } = $props();

  const messageValid = $derived.by(() => {
    try {
      JSON.parse(tab.grpc?.message || '{}');
      return true;
    } catch {
      return false;
    }
  });
  // S24: field violations from the last INVALID_ARGUMENT reply mark the message editor.
  const violations = $derived(tab.grpcResult?.details?.flatMap((d) => d.fieldViolations) ?? []);
  // G4: the request schema drives field completions and pre-send checks.
  const schemaFields = $derived(selectedMethod?.inputSchema ?? []);
  const inputShort = $derived(selectedMethod?.inputType?.split('.').pop() ?? '');
  // Flow · gRPC Stream: while a client/bidi stream is open the editor holds the next message to send.
  const nextSent = $derived(
    requestRuntime.busy[tab.id]?.writable ? (tab.grpcStream?.messages.filter((m) => m.sent).length ?? 0) + 1 : 0,
  );
  const issues = $derived(checkGrpcMessage(tab.grpc?.message ?? '', schemaFields));
  const issueText = (i: GrpcMessageIssue): string =>
    i.kind === 'unknown'
      ? t('grpc.msg.unknownField', { field: i.field, type: inputShort })
      : t('grpc.msg.wrongType', { field: i.field, expected: i.expected });

  /** G4: ⌃Space (or typing) at a top-level key lists the request fields with their types. */
  async function fieldCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
    const word = ctx.matchBefore(/"?[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (!atTopLevelKey(ctx.state.sliceDoc(0, ctx.pos))) return null;
    // A reopened saved request has no schema yet: fetch it on first ask.
    if (!tab.grpc?.tree && tab.grpc?.method) {
      await ensureConnected();
      await tick();
    }
    const fields = schemaFields;
    if (!fields.length || ctx.aborted) return null;
    const present = new Set([...ctx.state.doc.toString().matchAll(/"([\w$]+)"\s*:/g)].map((m) => m[1]));
    return {
      from: word.text.startsWith('"') ? word.from + 1 : word.from,
      validFor: /^[\w$]*$/,
      options: fieldCompletionOptions(fields, present, inputShort, t),
    };
  }
</script>

{#if chooseSchema}
  {@const source = tab.grpc?.source ?? 'reflection'}
  {#snippet choice(
    id: 'reflection' | 'proto',
    icon: string,
    title: string,
    text: string,
    pro: string,
    con: string,
    recommended = false,
  )}
    <button
      class="sc-card"
      class:on={source === id}
      type="button"
      role="radio"
      aria-checked={source === id}
      onclick={() => onChooseSource(id)}
    >
      <span class="sc-top">
        <span class="sc-icon" aria-hidden="true"><span class="material-symbols-outlined">{icon}</span></span>
        <b>{title}</b>
        {#if recommended}<span class="sc-tag">{t('grpc.schema.recommended')}</span>{/if}
        <span class="sc-radio" aria-hidden="true"></span>
      </span>
      <span class="sc-text">{text}</span>
      <span class="sc-point"><span class="material-symbols-outlined ok" aria-hidden="true">check</span>{pro}</span>
      <span class="sc-point"><span class="material-symbols-outlined" aria-hidden="true">info</span>{con}</span>
    </button>
  {/snippet}
  <BodyPanel class="bs-grpc-schema">
    <div class="sc-head">
      <span class="sc-kicker">{t('grpc.schema.title')}</span>
      <p>{t('grpc.schema.sub')}</p>
    </div>
    <div class="sc-choices" role="radiogroup" aria-label={t('grpc.schema.title')}>
      {@render choice(
        'reflection',
        'manage_search',
        'Server reflection',
        t('grpc.schema.reflectionText'),
        t('grpc.schema.reflectionPro'),
        t('grpc.schema.reflectionCon'),
        true,
      )}
      {@render choice(
        'proto',
        'description',
        t('grpc.schema.protoTitle'),
        t('grpc.schema.protoText'),
        t('grpc.schema.protoPro'),
        t('grpc.schema.protoCon'),
      )}
    </div>
    <p class="sc-tip">
      <span class="material-symbols-outlined" aria-hidden="true">lightbulb</span>{t('grpc.schema.grpcurlTip')}
    </p>
  </BodyPanel>
{:else}
  <BodyPanel class="bs-grpc-message">
    <!-- The type and «Example» live in the tabs row; a head shows only the open stream's next message number. -->
    {#if nextSent}
      <BodyHead>
        <span class="bs-body-caption"
          >{`${t('grpc.msg.next')}  ·  ${tab.grpcStream?.kind === 'bidi' ? '↑ ' : ''}#${nextSent}`}</span
        >
      </BodyHead>
    {/if}
    <BodyCode class={{ invalid: violations.length > 0 || issues.length > 0 }}>
      <CodeEditor
        value={tab.grpc?.message ?? ''}
        onChange={onMessageChange}
        lang="json"
        minHeight="140px"
        placeholder={tab.grpc?.tree && !tab.grpc.method ? t('grpc.msg.pickMethodFirst') : t('grpc.msg.placeholder')}
        completionSource={fieldCompletions}
        completionFooter={t('grpc.msg.acFoot')}
        varHighlight={[
          varHighlight,
          errorFieldLines([...violations.map((v) => v.field), ...issues.map((i) => i.field)]),
        ]}
        docId={tab.id}
        ariaLabel={t('grpc.msg.aria')}
      />
    </BodyCode>
    {#if violations.length}
      <div class="bs-grpc-valid warn" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        {t('grpc.msg.errors', {
          n: violations.length,
          unit: tp(violations.length, ['ошибка', 'ошибки', 'ошибок'], ['error', 'errors']),
          list: violations.map((v) => `${v.field} — ${v.description}`).join('; '),
        })}
      </div>
    {:else if issues.length}
      <div class="bs-grpc-valid warn" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        {t('grpc.msg.errors', {
          n: issues.length,
          unit: tp(issues.length, ['ошибка', 'ошибки', 'ошибок'], ['error', 'errors']),
          list: issues.map(issueText).join('; '),
        })}
      </div>
    {:else if selectedMethod?.inputType && !messageValid}
      <div class="bs-grpc-valid bad">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        {t('grpc.msg.invalidJson')}
      </div>
    {/if}
  </BodyPanel>
{/if}

<style>
  :global(:root .bs .bs-grpc-message .bs-body-head) {
    gap: 8px;
  }

  :global(:root .bs-http-body.bs-grpc-message .bs-body-cm) {
    flex: 1 1 auto;
  }

  :global(:root .bs-http-body.bs-grpc-message .bs-body-cm .cm-editor) {
    min-height: 100%;
  }

  :global(.bs) .bs-body-caption {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }

  :global(.bs) .bs-grpc-valid {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 6px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(.bs) .bs-grpc-valid :global(.material-symbols-outlined) {
    font-size: 13px;
  }

  :global(.bs) .bs-grpc-valid.bad {
    color: var(--color-danger);
  }

  :global(.bs) .bs-grpc-valid.warn {
    color: var(--color-warning);
  }

  :global(:root .bs .bs-grpc-schema) {
    gap: 12px;
  }

  :global(:root .bs .bs-grpc-schema .sc-head) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  :global(:root .bs .bs-grpc-schema .sc-kicker) {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(:root .bs .bs-grpc-schema .sc-head p) {
    margin: 0;
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(:root .bs .bs-grpc-schema .sc-choices) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  :global(:root .bs .bs-grpc-schema .sc-card) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid var(--color-border-subtle);
    border-radius: 14px;
    background: var(--color-panel);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }

  :global(:root .bs .bs-grpc-schema .sc-card:hover) {
    background: var(--color-raised);
  }

  :global(:root .bs .bs-grpc-schema .sc-card.on) {
    border-color: var(--color-border);
    background: var(--color-raised);
    box-shadow: 0 0 0 1px var(--color-border-subtle);
  }

  :global(:root .bs .bs-grpc-schema .sc-card:focus-visible) {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  :global(:root .bs .bs-grpc-schema .sc-top) {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  :global(:root .bs .bs-grpc-schema .sc-top b) {
    font: 600 var(--font-size-body) var(--font-ui);
  }

  :global(:root .bs .bs-grpc-schema .sc-icon) {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--color-selected);
    color: var(--color-text-secondary);
  }

  :global(:root .bs .bs-grpc-schema .sc-icon .material-symbols-outlined) {
    font-size: 17px;
  }

  :global(:root .bs .bs-grpc-schema .sc-tag) {
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 600 9.5px var(--font-ui);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  :global(:root .bs .bs-grpc-schema .sc-radio) {
    margin-left: auto;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--color-text-muted);
  }

  :global(:root .bs .bs-grpc-schema .sc-card.on .sc-radio) {
    border: 0;
    background: var(--color-text);
    box-shadow:
      inset 0 0 0 4px var(--color-raised),
      0 0 0 1.5px var(--color-text);
  }

  :global(:root .bs .bs-grpc-schema .sc-text) {
    color: var(--color-text-secondary);
    font: var(--font-size-caption)/1.5 var(--font-ui);
  }

  :global(:root .bs .bs-grpc-schema .sc-point) {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(:root .bs .bs-grpc-schema .sc-point .material-symbols-outlined) {
    font-size: 13px;
  }

  :global(:root .bs .bs-grpc-schema .sc-point .ok) {
    color: var(--color-success);
  }

  :global(:root .bs .bs-grpc-schema .sc-tip) {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(:root .bs .bs-grpc-schema .sc-tip .material-symbols-outlined) {
    font-size: 14px;
  }

  /* The gRPC message editor takes the free height of the request pane (min 140px) — most of the main panel by default. */
  :global(:root .bs-grpc-message) {
    flex: 1 1 auto;
  }
</style>
