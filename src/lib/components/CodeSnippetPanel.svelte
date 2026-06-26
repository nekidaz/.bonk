<script lang="ts">
  /**
   * Right-docked "Code snippet" panel: renders the active request as a curl
   * command (Postman-style) with a copy button. HTTP tabs only; overlays the
   * right edge of the work area so it doesn't disturb the request/response split.
   */
  import { toCurl } from '../domain/curl';
  import type { Tab } from '../domain/types';

  let { tab, onClose }: { tab: Tab; onClose: () => void } = $props();

  const code = $derived(toCurl(tab));
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1200);
    } catch (e) {
      console.error('copy snippet failed', e);
    }
  }
</script>

<aside class="bs-codepanel">
  <div class="bs-codepanel-h">
    <span class="t">Code snippet</span>
    <button class="x" aria-label="Close" onclick={onClose}>
      <span class="material-symbols-outlined" style="font-size:18px">close</span>
    </button>
  </div>
  <div class="bs-codepanel-sub">
    <span class="lang">cURL</span>
    <button class="copy" title="Copy" onclick={copy}>
      <span class="material-symbols-outlined" style="font-size:14px">{copied ? 'check' : 'content_copy'}</span>{copied ? 'Copied' : 'Copy'}
    </button>
  </div>
  <pre class="bs-codepanel-code">{code}</pre>
</aside>

<style>
  .bs-codepanel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 360px;
    max-width: 70%;
    background: var(--bg);
    border-left: 0.5px solid var(--sep);
    display: flex;
    flex-direction: column;
    z-index: 6;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  }
  .bs-codepanel-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 0.5px solid var(--sep);
  }
  .bs-codepanel-h .t {
    font-weight: 600;
    font-size: 13px;
    color: var(--t1);
  }
  .bs-codepanel-h .x {
    background: none;
    border: none;
    color: var(--t3);
    cursor: pointer;
    display: flex;
  }
  .bs-codepanel-sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px 6px;
  }
  .bs-codepanel-sub .lang {
    font-size: 12px;
    font-weight: 600;
    color: var(--t2);
  }
  .bs-codepanel-sub .copy {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--t2);
    background: var(--surface);
    border: 0.5px solid var(--sep);
    border-radius: 6px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .bs-codepanel-code {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 4px 14px 14px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--t1);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
