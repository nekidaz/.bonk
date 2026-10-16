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
  import { KvPanel, KvHead, KvTable, KvRow, KvCell, KvVarInput } from '$entities/request/components';

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
      const cell = table?.querySelector<HTMLElement>(`[data-row="${index}"][data-field="${field}"]`);
      // The value field is a CodeMirror editor: focus its editable content.
      (cell?.querySelector<HTMLElement>('.cm-content') ?? cell)?.focus();
    });
  }

  function keyKeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    focusCell(index, 'value');
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

<KvPanel class="grpc-metadata-editor">
  <KvHead>
    <span class="t">{t('grpc.meta.title')}</span>
    <span class="be">{t('grpc.meta.active', { n: Object.keys(tab.grpc?.metadata ?? {}).length })}</span>
  </KvHead>
  <KvTable class="grpc-metadata-table" bind:ref={table}>
    <KvRow class="h">
      <KvCell class="k">{t('grpc.meta.key')}</KvCell>
      <KvCell class="v">{t('grpc.meta.value')}</KvCell>
      <KvCell class="grpc-metadata-action" aria-hidden="true"></KvCell>
    </KvRow>
    {#each rows as row, index (index)}
      {@const normalizedKey = row.key.trim().toLowerCase()}
      {@const duplicate = normalizedKey !== '' && duplicateKeys.has(normalizedKey)}
      {@const invalid = !isGrpcMetadataKeyValid(row.key)}
      <KvRow class={{ invalid, duplicate }}>
        <KvCell class="k">
          <input
            data-row={index}
            data-field="key"
            aria-label={t('grpc.meta.keyAria', { n: index + 1 })}
            aria-invalid={invalid || duplicate}
            placeholder={t('grpc.meta.key')}
            value={row.key}
            oninput={(event) => setRow(index, 'key', event.currentTarget.value)}
            onkeydown={(event) => keyKeydown(event, index)}
            onpaste={(event) => pasteRows(event, index)}
            spellcheck="false"
          />
        </KvCell>
        <KvCell class="v">
          <KvVarInput
            data-row={index}
            data-field="value"
            ariaLabel={t('grpc.meta.valueAria', { n: index + 1 })}
            placeholder={t('grpc.meta.value')}
            value={row.value}
            onChange={(value) => setRow(index, 'value', value)}
            onEnter={() => focusCell(Math.min(index + 1, rows.length - 1), 'key')}
            docId={`${tab.id}:meta:${index}`}
          />
        </KvCell>
        <KvCell class="grpc-metadata-action">
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
        </KvCell>
      </KvRow>
    {/each}
  </KvTable>
  <div class="grpc-metadata-help">
    <span>{t('grpc.meta.lowercase')}</span>
    <span>{t('grpc.meta.binPre')}<code>-bin</code>{t('grpc.meta.binPost')}</span>
    {#if duplicateKeys.size > 0}<span class="warn">{t('grpc.meta.duplicate')}</span>{/if}
  </div>
</KvPanel>

<style>
  :global(:root .grpc-metadata-editor) {
    display: flex;
    flex-direction: column;
  }
  :global(:root .grpc-metadata-table) {
    flex: 0 0 auto;
  }
  :global(:root .grpc-metadata-action) {
    width: 38px;
    flex: 0 0 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  :global(:root .grpc-metadata-action button) {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--t3);
  }
  :global(:root .grpc-metadata-action button:hover) {
    background: var(--hover);
    color: var(--text);
  }
  :global(:root .bs-pr.invalid .bs-pc.k),
  :global(:root .bs-pr.duplicate .bs-pc.k) {
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
