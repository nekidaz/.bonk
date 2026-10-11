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

  let {
    tab,
    selectedMethod,
    chooseSchema,
    largeMessage,
    varHighlight,
    ensureConnected,
    onMessageChange,
    onChooseSource,
    onLoadExample,
  }: {
    tab: Tab;
    selectedMethod: GrpcMethod | undefined;
    /** No schema, method or message yet: show the source chooser instead of the editor. */
    chooseSchema: boolean;
    /** A large message loses its caption head (it moves into the tabs row). */
    largeMessage: boolean;
    varHighlight: Extension;
    ensureConnected: () => Promise<void>;
    onMessageChange: (value: string) => void;
    onChooseSource: (source: 'reflection' | 'proto') => void;
    onLoadExample: () => void;
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
  <div class="bs-http-body bs-grpc-schema">
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
  </div>
{:else}
  <div class="bs-http-body bs-grpc-message">
    {#if !largeMessage}
      <div class="bs-body-head">
        <span class="bs-body-caption"
          >{#if nextSent}{t('grpc.msg.next')}&nbsp;&nbsp;·&nbsp;&nbsp;{tab.grpcStream?.kind === 'bidi'
              ? '↑ '
              : ''}#{nextSent}{:else}{t(
              'grpc.tab.message',
            )}{/if}{#if selectedMethod?.inputType}&nbsp;&nbsp;·&nbsp;&nbsp;{selectedMethod.inputType
              .split('.')
              .pop()}{/if}</span
        >
        <button class="bs-body-beautify bs-grpc-example" type="button" onclick={onLoadExample}
          ><span class="material-symbols-outlined" aria-hidden="true">description</span>{t('grpc.msg.example')}</button
        >
      </div>
    {/if}
    <div class="bs-body-cm" class:invalid={violations.length > 0 || issues.length > 0}>
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
    </div>
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
  </div>
{/if}
