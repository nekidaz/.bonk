<script lang="ts">
  // The sign-in form of a session started by a button (“Sign in” on the Authorization card, Sessions dialog),
  // Flow · Session SE5. A send's own form is SendInputPrompt, under Send; this one has no button to sit under,
  // so it floats at the top centre. Answer → the sign-in goes on; “Later” → it stops.
  import { answerInput, closePrompt, inputPrompts } from '$entities/input';
  import { InputForm } from '$entities/input/components';
  import { cancelSessionRun, sessionRuntime } from '$entities/request';
  import { t } from '$shared/i18n';

  const asking = $derived(
    Object.keys(sessionRuntime.running).flatMap((requestId) => {
      const request = inputPrompts.byRequest[requestId];
      return request ? [{ requestId, request }] : [];
    }),
  );
</script>

{#each asking as { requestId, request } (requestId)}
  <div class="prompt">
    <InputForm
      {request}
      variant="popover"
      submitLabel={t('sessionrun.prompt.signIn')}
      onsubmit={(values) => {
        void answerInput(request, { kind: 'values', values });
        closePrompt(requestId);
      }}
      oncancel={() => void cancelSessionRun(requestId)}
    />
  </div>
{/each}

<style>
  .prompt {
    position: fixed;
    z-index: 55;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
  }
</style>
