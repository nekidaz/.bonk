<script lang="ts">
  import { importCurlAsTab } from '../stores';

  // Two-way bound from the parent (App.svelte holds the source of truth for the
  // open trigger). The fields below are local to this dialog.
  let { open = $bindable() }: { open: boolean } = $props();

  let curlText = $state('');
  let curlError = $state('');
  const curlPlaceholder = `curl 'https://api.example.com' -H 'Authorization: Bearer ...' -d '{"ok":true}'`;

  // Clear the fields each time the dialog is opened so it always starts empty.
  $effect(() => {
    if (open) {
      curlText = '';
      curlError = '';
    }
  });

  function confirmCurlImport(): void {
    try {
      importCurlAsTab(curlText);
      open = false;
      curlText = '';
      curlError = '';
    } catch (e) {
      curlError = String(e);
    }
  }
</script>

{#if open}
  <div class="bs-overlay" role="dialog" aria-modal="true">
    <div class="bs-modal">
      <div class="bs-modal-h"><div class="t">Import cURL</div><button class="x" onclick={() => (open = false)}><span class="material-symbols-outlined" style="font-size:16px">close</span></button></div>
      <div class="bs-modal-b">
        <div class="bs-flabel">Paste cURL command</div>
        <textarea class="bs-textarea" placeholder={curlPlaceholder} value={curlText} oninput={(e) => { curlText = e.currentTarget.value; curlError = ''; }}></textarea>
        {#if curlError}<div class="bs-form-error">{curlError}</div>{/if}
      </div>
      <div class="bs-modal-f">
        <button class="bs-btn primary" disabled={!curlText.trim()} onclick={confirmCurlImport}>Import</button>
        <button class="bs-btn ghost" onclick={() => (open = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
