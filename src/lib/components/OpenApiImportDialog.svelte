<script lang="ts">
  import { importApiText, importApiFile } from '../stores';
  import { t } from '../i18n';
  import { get } from 'svelte/store';

  // `open` is the trigger held by App.svelte; the paste buffer + error live here.
  let { open = $bindable() }: { open: boolean } = $props();

  let text = $state('');
  let error = $state('');
  let busy = $state(false);

  // Clear the buffer each time the dialog is (re)opened.
  $effect(() => {
    if (open) {
      text = '';
      error = '';
      busy = false;
    }
  });

  async function pasteFromClipboard(): Promise<void> {
    error = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      error = get(t)('import.clipboardFail');
      console.error('openapi: clipboard read failed', err);
    }
  }

  async function doImport(): Promise<void> {
    if (text.trim() === '') {
      error = get(t)('import.pasteFirst');
      return;
    }
    error = '';
    busy = true;
    try {
      await importApiText(text, 'pasted');
      open = false;
    } catch (err) {
      // Keep the dialog open and show why the spec didn't parse, so the paste
      // isn't silently lost.
      error = err instanceof Error ? err.message : String(err);
      console.error('openapi: paste import failed', err);
    } finally {
      busy = false;
    }
  }

  async function pickFile(): Promise<void> {
    error = '';
    busy = true;
    try {
      await importApiFile();
      open = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h">
        <span class="t">{$t('import.title')}</span>
        <button class="x" aria-label={$t('common.close')} onclick={() => (open = false)}><span class="material-symbols-outlined" style="font-size:18px">close</span></button>
      </div>
      <div class="bs-modal-b">
        <label class="bs-flabel" for="bs-import-text">{$t('import.label')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          class="bs-input oai-paste"
          id="bs-import-text"
          aria-invalid={!!error}
          aria-describedby={error ? 'bs-import-error' : undefined}
          bind:value={text}
          autofocus
          spellcheck="false"
          placeholder={'{ "info": { "name": "My API" }, "item": [...] }'}
        ></textarea>
        {#if error}<div class="bs-form-error" id="bs-import-error" role="alert">{error}</div>{/if}
      </div>
      <div class="bs-modal-f">
        <button class="bs-btn link" onclick={pasteFromClipboard}><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">content_paste</span> {$t('import.paste')}</button>
        <button class="bs-btn link" onclick={pickFile} disabled={busy}><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">upload_file</span> {$t('import.selectFile')}</button>
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={doImport} disabled={busy}>{busy ? $t('import.importing') : $t('import.confirm')}</button>
        <button class="bs-btn ghost" onclick={() => (open = false)}>{$t('common.cancel')}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .oai-paste {
    width: 100%;
    height: 240px;
    min-height: 120px;
    resize: vertical;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    overflow: auto;
  }
</style>
