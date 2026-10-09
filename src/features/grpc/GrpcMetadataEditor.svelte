<script lang="ts">
  import { untrack } from 'svelte';
  import { tabs } from '$entities/tab';
  import {
    duplicateGrpcMetadataKeys,
    grpcMetadataRecord,
    grpcMetadataRows,
    isGrpcMetadataKeyValid,
    parseGrpcMetadataRows,
    withTrailingGrpcMetadataRow,
    type GrpcMetadataRow,
  } from './grpcMetadata';
  import type { Tab } from '$shared/model';
  import { t } from '$shared/i18n';

  let { tab }: { tab: Tab } = $props();

  // This draft is intentionally separate from the persisted Record. A Record
  // cannot represent the half-written key/value row a person is currently
  // typing; round-tripping every keystroke through it used to erase that row.
  let rows = $state<GrpcMetadataRow[]>(untrack(() => grpcMetadataRows(tab.grpc?.metadata)));
  let table: HTMLDivElement | undefined = $state();
  const duplicateKeys = $derived(duplicateGrpcMetadataKeys(rows));

  function persist(next: GrpcMetadataRow[]): void {
    rows = withTrailingGrpcMetadataRow(next);
    const metadata = grpcMetadataRecord(rows);
    tabs.updateById(tab.id, (current) =>
      current.grpc ? { ...current, grpc: { ...current.grpc, metadata } } : current,
    );
  }

  function setRow(index: number, field: keyof GrpcMetadataRow, value: string): void {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row));
    persist(next);
  }

  function removeRow(index: number): void {
    persist(rows.filter((_row, rowIndex) => rowIndex !== index));
  }

  function focusCell(index: number, field: keyof GrpcMetadataRow): void {
    queueMicrotask(() => {
      table?.querySelector<HTMLInputElement>(`[data-row="${index}"][data-field="${field}"]`)?.focus();
    });
  }

  function rowKeydown(event: KeyboardEvent, index: number, field: keyof GrpcMetadataRow): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (field === 'key') focusCell(index, 'value');
    else focusCell(Math.min(index + 1, rows.length - 1), 'key');
  }

  function pasteRows(event: ClipboardEvent, index: number): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    const parsed = parseGrpcMetadataRows(pasted);
    if (parsed.length === 0) return;
    event.preventDefault();
    persist([...rows.slice(0, index), ...parsed, ...rows.slice(index + 1)]);
    focusCell(index + parsed.length - 1, 'value');
  }
</script>

<div class="bs-pwrap grpc-metadata-editor">
  <div class="bs-qp">
    <span class="t">{t('grpc.meta.title')}</span>
    <span class="be">{t('grpc.meta.active', { n: Object.keys(tab.grpc?.metadata ?? {}).length })}</span>
  </div>
  <div class="bs-pt grpc-metadata-table" bind:this={table}>
    <div class="bs-pr h">
      <div class="bs-pc k">{t('grpc.meta.key')}</div>
      <div class="bs-pc v">{t('grpc.meta.value')}</div>
      <div class="bs-pc grpc-metadata-action" aria-hidden="true"></div>
    </div>
    {#each rows as row, index (index)}
      {@const normalizedKey = row.key.trim().toLowerCase()}
      {@const duplicate = normalizedKey !== '' && duplicateKeys.has(normalizedKey)}
      {@const invalid = !isGrpcMetadataKeyValid(row.key)}
      <div class="bs-pr" class:invalid class:duplicate>
        <div class="bs-pc k">
          <input
            data-row={index}
            data-field="key"
            aria-label={t('grpc.meta.keyAria', { n: index + 1 })}
            aria-invalid={invalid || duplicate}
            placeholder={t('grpc.meta.key')}
            value={row.key}
            oninput={(event) => setRow(index, 'key', event.currentTarget.value)}
            onkeydown={(event) => rowKeydown(event, index, 'key')}
            onpaste={(event) => pasteRows(event, index)}
            spellcheck="false"
          />
        </div>
        <div class="bs-pc v">
          <input
            data-row={index}
            data-field="value"
            aria-label={t('grpc.meta.valueAria', { n: index + 1 })}
            placeholder={t('grpc.meta.value')}
            value={row.value}
            oninput={(event) => setRow(index, 'value', event.currentTarget.value)}
            onkeydown={(event) => rowKeydown(event, index, 'value')}
            spellcheck="false"
          />
        </div>
        <div class="bs-pc grpc-metadata-action">
          {#if row.key !== '' || row.value !== ''}
            <button
              type="button"
              aria-label={t('grpc.meta.removeAria', { n: index + 1 })}
              title={t('common.delete')}
              onclick={() => removeRow(index)}
            >
              <span class="material-symbols-outlined" style="font-size:16px">close</span>
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  <div class="grpc-metadata-help">
    <span>{t('grpc.meta.lowercase')}</span>
    <span>{t('grpc.meta.binPre')}<code>-bin</code>{t('grpc.meta.binPost')}</span>
    {#if duplicateKeys.size > 0}<span class="warn">{t('grpc.meta.duplicate')}</span>{/if}
  </div>
</div>

<style>
  .grpc-metadata-editor {
    display: flex;
    flex-direction: column;
  }
  .grpc-metadata-table {
    flex: 0 0 auto;
  }
  .grpc-metadata-action {
    width: 38px;
    flex: 0 0 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .grpc-metadata-action button {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--t3);
  }
  .grpc-metadata-action button:hover {
    background: var(--hover);
    color: var(--text);
  }
  .bs-pr.invalid .bs-pc.k,
  .bs-pr.duplicate .bs-pc.k {
    color: var(--red);
  }
  .grpc-metadata-help {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding: 9px 2px 0;
    color: var(--t3);
    font-size: 11.5px;
  }
  .grpc-metadata-help code {
    font-family: var(--mono);
  }
  .grpc-metadata-help .warn {
    color: var(--red);
  }
</style>
