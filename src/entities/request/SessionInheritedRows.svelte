<script lang="ts">
  import { t } from '$shared/i18n';
  import { sessionCanRenew, sessionTone, type AuthConfig, type SessionInfo } from '$shared/model';
  import { environments, envToneOf } from '$entities/environment';
  import { activeEnvName, sessionRuntime, sessionStatuses } from './session.svelte';
  import { sessionStatusText } from './sessionFormat';
  import TokenPill from './TokenPill.svelte';

  // Flow · Сессия SE3: a request under the collection's session sees it read-only, for the selected environment.
  let { auth }: { auth: AuthConfig } = $props();

  const env = $derived(activeEnvName());
  const activeEnv = $derived(environments.active);
  let info = $state.raw<SessionInfo | null>(null);
  $effect(() => {
    void sessionRuntime.version;
    const a = $state.snapshot(auth) as AuthConfig;
    const name = env;
    let live = true;
    sessionStatuses(a, [name])
      .then((list) => live && (info = list[0]?.info ?? null))
      .catch(() => live && (info = null));
    return () => {
      live = false;
    };
  });
  let now = $state(Date.now() / 1000);
  $effect(() => {
    const id = setInterval(() => (now = Date.now() / 1000), 15_000);
    return () => clearInterval(id);
  });

  const tone = $derived(sessionTone(info, now));
  const status = $derived(sessionStatusText(info, now));
  const renews = $derived(auth.session?.autoRefresh !== false && sessionCanRenew(auth.session) && !!info?.hasRefresh);
  const note = $derived(
    [info?.who ? t('session.inh.who', { who: info.who }) : '', tone === 'ok' && renews ? t('session.inh.auto') : '']
      .filter(Boolean)
      .join('  ·  '),
  );
</script>

<div class="row">
  <span class="lbl">{t('session.inh.session')}</span>
  <TokenPill class={{ bad: tone === 'renew', dead: tone === 'dead', none: tone === 'none' }}
    >{tone === 'ok' ? t('session.inh.active', { left: status }) : status}</TokenPill
  >
  {#if activeEnv}
    <span class="env tone-{envToneOf(activeEnv)}"
      >{#if envToneOf(activeEnv) === 'production'}<span class="material-symbols-outlined" aria-hidden="true">lock</span
        >{/if}{activeEnv.name}</span
    >
  {/if}
  {#if note}<span class="hint grow">{note}</span>{/if}
</div>
{#if info}
  <div class="row">
    <span class="lbl">{t('session.inh.header')}</span>
    <span class="secret dim"
      >{`Authorization: Bearer ${info.accessPreview}  ·  ${t('session.inh.from', { var: '{{session.access}}' })}`}</span
    >
  </div>
{/if}

<style>
  :global(:root .bs .bs-oa-pill.dead) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
</style>
