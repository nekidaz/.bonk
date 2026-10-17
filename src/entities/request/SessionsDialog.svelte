<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import { workspaceName } from '$shared/ui';
  import { sessionTone, type AuthConfig, type EnvSession } from '$shared/model';
  import { environments, envToneOf } from '$entities/environment';
  import { workspace } from '$entities/workspace';
  import {
    environmentNames,
    runSession,
    cancelSessionRun,
    sessionCardKey,
    sessionRuntime,
    sessionStatuses,
    signOutSessions,
  } from './session.svelte';
  import { sessionStatusText } from './sessionFormat';
  import { sessionRowActions } from './sessionRows';
  import TokensDialog from './TokensDialog.svelte';
  import { Button, ModalHeader, ModalBody, ModalFooter } from '$shared/ui/components';

  // The sessions of this collection's auth in every environment (Flow · Session SE6).
  let { auth, where, onClose }: { auth: AuthConfig; where: string; onClose: () => void } = $props();

  const names = $derived(environmentNames());
  const snap = () => $state.snapshot(auth) as AuthConfig;

  let sessions = $state.raw<EnvSession[]>([]);
  $effect(() => {
    void sessionRuntime.version;
    const list = names;
    let live = true;
    sessionStatuses(snap(), list)
      .catch(() => [] as EnvSession[])
      .then((got) => live && (sessions = got));
    return () => {
      live = false;
    };
  });

  const now = $derived.by(() => {
    void sessions; // a fresh read is also a fresh clock
    return Date.now() / 1000;
  });
  const infoOf = (name: string) => sessions.find((s) => s.environment === name)?.info ?? null;
  const busyIn = (name: string) =>
    Object.values(sessionRuntime.running).some((r) => r.key === sessionCardKey(auth, name));
  const cancelRunIn = async (name: string) => {
    const id = Object.entries(sessionRuntime.running).find(([, r]) => r.key === sessionCardKey(auth, name))?.[0];
    if (id) await cancelSessionRun(id);
  };
  const anyBusy = $derived(names.some(busyIn));
  const failure = $derived(
    sessionRuntime.failure && names.some((n) => sessionRuntime.failure?.key === sessionCardKey(auth, n))
      ? sessionRuntime.failure.message
      : null,
  );

  const wsName = $derived(workspaceName(workspace.path ?? '').replace(/[-_]+/g, ' '));
  const count = $derived(tp(names.length, ['environment', 'environments']));

  let confirmAll = $state(false);
  async function signOutAll(): Promise<void> {
    if (!confirmAll) {
      confirmAll = true;
      return;
    }
    confirmAll = false;
    await signOutSessions(snap(), names);
  }

  let doneBtn: HTMLButtonElement | undefined = $state();
  $effect(() => doneBtn?.focus());
</script>

<svelte:window
  onkeydown={(e) => {
    // While a sign-in runs, Esc belongs to its form.
    if (e.key === 'Escape' && !anyBusy) {
      e.preventDefault();
      onClose();
    }
  }}
/>

<TokensDialog label={t('sessions.title')} class="bs-sessions">
  <ModalHeader>
    <div class="head">
      <span class="eyebrow">{wsName} · {where} · {names.length} {count}</span>
      <span class="t">{t('sessions.title')}</span>
    </div>
    <button class="x" aria-label={t('common.close')} onclick={onClose}
      ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
    >
  </ModalHeader>
  <ModalBody>
    <p class="lede">{t('sessions.lede')}</p>
    <div class="table" role="table">
      <div class="tr th" role="row">
        <span role="columnheader">{t('sessions.env')}</span>
        <span role="columnheader">{t('sessions.who')}</span>
        <span role="columnheader">{t('sessions.login')}</span>
        <span role="columnheader">{t('sessions.status')}</span>
        <span></span>
      </div>
      {#each names as name (name)}
        {@const env = environments.list.find((e) => e.name === name)}
        {@const info = infoOf(name)}
        {@const tone = sessionTone(info, now)}
        {@const can = sessionRowActions(tone)}
        {@const busy = busyIn(name)}
        <div class="tr" role="row">
          <span class="env-name"><span class="dot tone-{env ? envToneOf(env) : 'none'}"></span>{name}</span>
          <span class="dim who"
            ><span class="material-symbols-outlined" aria-hidden="true">person</span>{info?.who ?? '—'}</span
          >
          <span class="dim">{auth.session?.login ?? '—'}</span>
          <span>
            {#if busy}
              <span class="pill none">{t('sessions.busy')}</span>
            {:else}
              <span class="pill" class:bad={tone === 'renew'} class:dead={tone === 'dead'} class:none={tone === 'none'}
                >{sessionStatusText(info, now)}</span
              >
            {/if}
          </span>
          <span class="acts">
            {#if busy}
              <span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span>
              <button
                class="icon"
                type="button"
                title={t('common.cancel')}
                aria-label={t('common.cancel')}
                onclick={() => void cancelRunIn(name)}><span class="material-symbols-outlined">close</span></button
              >
            {:else}
              {#if can.refresh}
                <button
                  class="icon"
                  type="button"
                  title={t('sessions.refresh')}
                  aria-label={t('sessions.refresh')}
                  disabled={anyBusy}
                  onclick={() => void runSession('refresh', snap(), name)}
                  ><span class="material-symbols-outlined">refresh</span></button
                >
              {/if}
              {#if can.signOut}
                <button
                  class="icon"
                  type="button"
                  title={t('sessions.signOut')}
                  aria-label={t('sessions.signOut')}
                  disabled={anyBusy}
                  onclick={() => void signOutSessions(snap(), [name])}
                  ><span class="material-symbols-outlined">logout</span></button
                >
              {/if}
              {#if can.signIn}
                <Button variant="ghost" disabled={anyBusy} onclick={() => void runSession('signIn', snap(), name)}
                  >{t('sessions.signIn')}</Button
                >
              {/if}
            {/if}
          </span>
        </div>
      {/each}
    </div>
    {#if failure}
      <div class="fail" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>{failure}
      </div>
    {/if}
    <div class="signout">
      <span class="material-symbols-outlined" aria-hidden="true">logout</span>
      <div class="txt">
        <div class="ttl">{t('sessions.all.title')}</div>
        <div class="sub">{t('sessions.all.sub')}</div>
      </div>
      <Button
        variant="ghost-danger"
        disabled={anyBusy || !names.length}
        onclick={() => void signOutAll()}
        onblur={() => (confirmAll = false)}
        ><span class="material-symbols-outlined" aria-hidden="true">logout</span>{confirmAll
          ? t('sessions.all.confirm')
          : t('sessions.all.title')}</Button
      >
    </div>
  </ModalBody>
  <ModalFooter>
    <span class="note"
      ><span class="material-symbols-outlined" aria-hidden="true">lock</span>{t('sessions.keychain')}</span
    >
    <div class="grow"></div>
    <Button variant="primary" bind:ref={doneBtn} onclick={onClose}>{t('sessions.done')}</Button>
  </ModalFooter>
</TokensDialog>

<style>
  :global(.bs-oa-tokens) .pill.dead {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  /* Flow · Session SE6: the Sessions dialog reuses the OAuth tokens table. */
  :global(:root .bs-sessions .bs-modal-h) {
    flex: none;
    align-items: flex-start;
    padding: 16px 20px 0;
  }

  :global(:root .bs-sessions .bs-modal-h .head) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  :global(:root .bs-sessions .eyebrow) {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  :global(:root .bs-sessions .bs-modal-h .t) {
    font: 600 var(--font-size-heading) var(--font-ui);
    letter-spacing: 0;
    text-transform: none;
  }

  :global(:root .bs-sessions .bs-modal-b) {
    padding: 16px 20px;
  }

  :global(:root .bs-sessions .tr) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1.7fr) 110px;
  }

  :global(:root .bs-sessions .who) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(:root .bs-sessions .icon:disabled) {
    opacity: 0.4;
    pointer-events: none;
  }

  :global(:root .bs-sessions .bs-btn:disabled) {
    opacity: 0.4;
    pointer-events: none;
  }

  :global(:root .bs-sessions .acts .spin) {
    font-size: 17px;
    color: var(--color-text-muted);
    animation: send-spin 1s linear infinite;
  }

  :global(:root .bs-sessions .fail) {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    color: var(--color-danger);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(:root .bs-sessions .signout .bs-btn .material-symbols-outlined) {
    margin-right: 6px;
    font-size: 15px;
  }
</style>
