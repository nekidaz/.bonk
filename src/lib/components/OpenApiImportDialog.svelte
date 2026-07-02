<script lang="ts">
  import { importOpenApiText, importOpenApiFile } from '../stores';

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
      error = 'Could not read the clipboard — paste the spec manually.';
      console.error('openapi: clipboard read failed', err);
    }
  }

  async function doImport(): Promise<void> {
    if (text.trim() === '') {
      error = 'Paste an OpenAPI or Swagger spec first.';
      return;
    }
    error = '';
    busy = true;
    try {
      await importOpenApiText(text, 'pasted');
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

  function pickFile(): void {
    open = false;
    void importOpenApiFile();
  }
</script>

{#if open}
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h">
        <span class="t">Import OpenAPI / Swagger</span>
        <button class="x" aria-label="Close" onclick={() => (open = false)}><span class="material-symbols-outlined" style="font-size:18px">close</span></button>
      </div>
      <div class="bs-modal-b">
        <div class="bs-flabel">Paste a spec (JSON or YAML)</div>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          class="bs-input oai-paste"
          bind:value={text}
          autofocus
          spellcheck="false"
          placeholder={'openapi: 3.0.0\ninfo:\n  title: My API\npaths: ...'}
        ></textarea>
        {#if error}<div class="bs-form-error">{error}</div>{/if}
      </div>
      <div class="bs-modal-f">
        <button class="bs-btn link" onclick={pasteFromClipboard}><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">content_paste</span> Paste from clipboard</button>
        <button class="bs-btn link" onclick={pickFile}><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">upload_file</span> Select file…</button>
        <div class="grow"></div>
        <button class="bs-btn primary" onclick={doImport} disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
        <button class="bs-btn ghost" onclick={() => (open = false)}>Cancel</button>
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
