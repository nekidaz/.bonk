<script lang="ts">
  // The small window by Send that asks for the «ask on send» values of the active tab's request
  // (Flow · Сценарий с вводом OT3). The send is parked in bonk-core until it is answered or cancelled.
  import { cancelRequest } from '$shared/ipc';
  import { answerInput, closePrompt, inputPrompts } from '$entities/input';
  import { InputForm } from '$entities/input/components';
  import { requestRuntime } from '$entities/request';
  import { tabs } from '$entities/tab';

  const requestId = $derived(tabs.activeId ? requestRuntime.busy[tabs.activeId]?.requestId : undefined);
  const request = $derived(requestId ? inputPrompts.byRequest[requestId] : undefined);

  // Right-aligned under the Send button.
  let at = $state({ top: 0, right: 20 });
  $effect(() => {
    if (!request) return;
    const rect = document.querySelector<HTMLElement>('button.bs-send')?.getBoundingClientRect();
    if (rect) at = { top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) };
  });
</script>

{#if request && requestId}
  <div class="prompt" style="top:{at.top}px; right:{at.right}px">
    <InputForm
      {request}
      variant="popover"
      onsubmit={(values) => {
        void answerInput(request, { kind: 'values', values });
        closePrompt(requestId);
      }}
      oncancel={() => void cancelRequest(requestId)}
    />
  </div>
{/if}

<style>
  .prompt {
    position: fixed;
    z-index: 55;
  }
</style>
