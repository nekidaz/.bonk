<script lang="ts">
  /** Request-side problem strip above the gRPC request tabs (schema, script, validation, unknown). */
  import { t } from '$shared/i18n';
  import type { EditorErrorPresentation } from './grpcEditor';

  let {
    error,
    endpoint,
    onImportProto,
    onDismiss,
  }: {
    error: EditorErrorPresentation;
    endpoint: string;
    onImportProto: () => void;
    onDismiss: () => void;
  } = $props();
</script>

<div class="bs-grpc-connect-alert" class:guidance={error.kind === 'schema'}>
  <div class="bs-grpc-connect-icon" aria-hidden="true">
    <span class="material-symbols-outlined">{error.icon}</span>
  </div>
  <div class="bs-grpc-connect-copy">
    <div class="bs-grpc-connect-title">
      <b>{error.title}</b>
      {#if endpoint}<span>{endpoint}</span>{/if}
    </div>
    <p>{error.message}</p>
    {#if error.raw !== error.message}
      <details><summary>{$t('grpc.err.details')}</summary><code>{error.raw}</code></details>
    {/if}
  </div>
  <div class="bs-grpc-connect-actions">
    {#if error.kind === 'schema'}
      <button type="button" onclick={onImportProto}>{$t('grpc.picker.importProto')}</button>
    {/if}
  </div>
  <button class="bs-grpc-connect-dismiss" type="button" aria-label={$t('grpc.err.dismiss')} onclick={onDismiss}>
    <span class="material-symbols-outlined">close</span>
  </button>
</div>

<style>
  /* Request-side problems (schema, script, validation): a quiet Soft card, colour only on the icon. */
  .bs-grpc-connect-alert {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto 28px;
    align-items: center;
    gap: 12px;
    margin: 0 20px 10px;
    padding: 10px 10px 10px 12px;
    color: var(--color-text);
    background: var(--color-field);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
  }
  .bs-grpc-connect-icon {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--color-danger);
    background: var(--color-danger-soft);
    border-radius: 50%;
  }
  .guidance .bs-grpc-connect-icon {
    color: var(--color-text-secondary);
    background: var(--color-raised);
  }
  .bs-grpc-connect-icon .material-symbols-outlined {
    font-size: 17px;
  }
  .bs-grpc-connect-copy {
    min-width: 0;
  }
  .bs-grpc-connect-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .bs-grpc-connect-title b {
    font: 600 var(--font-size-ui) var(--font-ui);
  }
  .bs-grpc-connect-title span {
    max-width: 280px;
    padding: 1px 8px;
    overflow: hidden;
    color: var(--color-text-muted);
    background: var(--color-raised);
    border-radius: var(--radius-control);
    font: var(--font-size-micro) var(--font-code);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-grpc-connect-copy p {
    margin: 2px 0 0;
    color: var(--color-text-secondary);
    font: var(--font-size-body)/1.45 var(--font-ui);
  }
  .bs-grpc-connect-copy details {
    margin-top: 6px;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
  }
  .bs-grpc-connect-copy summary {
    width: max-content;
    cursor: pointer;
  }
  .bs-grpc-connect-copy code {
    display: block;
    margin-top: 6px;
    padding: 8px 10px;
    color: var(--color-text-secondary);
    background: var(--color-panel);
    border-radius: var(--radius-md);
    font: var(--font-size-caption)/1.5 var(--font-code);
    white-space: pre-wrap;
  }
  .bs-grpc-connect-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bs-grpc-connect-actions button {
    height: 32px;
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    color: var(--color-text);
    background: var(--color-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  .bs-grpc-connect-actions button:hover {
    background: var(--color-hover);
  }
  .bs-grpc-connect-dismiss {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    border-radius: 50%;
  }
  .bs-grpc-connect-dismiss:hover {
    color: var(--color-text);
    background: var(--color-hover);
  }
  .bs-grpc-connect-dismiss .material-symbols-outlined {
    font-size: 15px;
  }
  @media (max-width: 760px) {
    .bs-grpc-connect-alert {
      grid-template-columns: 32px minmax(0, 1fr) 28px;
    }
    .bs-grpc-connect-actions {
      grid-column: 2 / -1;
      justify-self: start;
    }
  }
</style>
