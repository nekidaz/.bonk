<script lang="ts">
  import { t } from '$shared/i18n';
  import type { AuthConfig, Tab } from '$shared/model';
  import { environments, envToneOf } from '$entities/environment';
  import { inputPrompts } from '$entities/input';
  import { workspace } from '$entities/workspace';
  import { requestRuntime } from './requestRuntime.svelte';
  import { sessionRuntime } from './session.svelte';
  import { sessionClock, sessionStatusText } from './sessionFormat';
  import { joinNames, nodeMethod, promptLines, timelineLines } from './sessionView';

  // Flow · Сессия SE4/SE5: how the last send of this tab got its token (renewed / signed in again),
  // or, while the send waits for a sign-in code, why and how far the sign-in got.
  let { tab, auth }: { tab: Tab; auth: AuthConfig } = $props();

  const use = $derived(sessionRuntime.uses[tab.id]);
  const requestId = $derived(requestRuntime.busy[tab.id]?.requestId);
  const asking = $derived(requestId ? inputPrompts.byRequest[requestId] : undefined);
  const prompt = $derived(asking?.session);
  const renewMethod = $derived(nodeMethod(workspace.tree, auth.session?.renewRequest));
  const envName = $derived(prompt?.environment ?? use?.environment ?? '');
  const env = $derived(environments.list.find((e) => e.name === envName));

  const failedRenew = $derived(prompt?.trace.some((e) => e.kind === 'renew' && !e.ok) ?? false);
  const waitSub = $derived.by(() => {
    if (!prompt) return '';
    const done = prompt.steps.filter((s) => s.state === 'done').map((s) => s.name);
    const label = asking?.fields[0]?.label?.trim();
    const what = label ? label[0].toLowerCase() + label.slice(1) : t('session.b.waitWhat');
    const key = !done.length
      ? 'session.b.waitSubNone'
      : done.length === 1
        ? 'session.b.waitSubStep'
        : 'session.b.waitSubSteps';
    return (
      (failedRenew ? t('session.b.waitSubRefresh') : '') +
      t(key, { login: prompt.scenario, done: joinNames(done), what })
    );
  });
  const pending = $derived(`${tab.request.method} ${tab.request.url.split('?')[0]}`);
  const lines = $derived(
    prompt
      ? promptLines(prompt, pending, renewMethod)
      : use
        ? timelineLines(use.trace, use.sent ? { sent: use.sent, at: use.at } : undefined, renewMethod)
        : [],
  );
  const renewed = $derived.by(() => {
    if (!use) return '';
    const expired = use.trace.find((e) => e.kind === 'expired');
    const renew = use.trace.find((e) => e.kind === 'renew');
    const exp = expired?.kind === 'expired' && expired.exp !== null ? sessionClock(expired.exp) : '—';
    return t('session.b.renewedSub', { time: exp, name: renew?.kind === 'renew' ? renew.request : '' });
  });
</script>

{#if prompt || use}
  <div class="bs-oa-card se-card se-banner" class:tone-ask={!!prompt} class:tone-var={!prompt}>
    <span class="se-badge"
      ><span class="material-symbols-outlined" aria-hidden="true"
        >{prompt ? 'lock_clock' : use?.outcome === 'signedIn' ? 'login' : 'autorenew'}</span
      ></span
    >
    <div class="txt">
      <div class="ttl">
        {#if prompt}
          {t('session.b.wait')}
          <span class="badge dead"
            >{failedRenew
              ? t('session.b.waitRefresh')
              : prompt.trace.length
                ? t('session.b.waitExpired')
                : t('session.none')}</span
          >
        {:else if use}
          {use.outcome === 'signedIn' ? t('session.b.signedIn') : t('session.b.renewed')}
          <span class="badge">{sessionStatusText(use.info, Date.now() / 1000)}</span>
        {/if}
        {#if envName}
          <span class="env tone-{envToneOf(env)}"
            >{#if envToneOf(env) === 'production'}<span class="material-symbols-outlined" aria-hidden="true">lock</span
              >{/if}{envName}</span
          >
        {/if}
      </div>
      <div class="sub wrap">
        {prompt ? waitSub : use?.outcome === 'signedIn' ? t('session.b.signedInSub', { login: use.login }) : renewed}
      </div>
    </div>
  </div>
  {#if lines.length}
    <div class="se-timeline">
      {#each lines as line, i (i)}
        <div class="ev">
          <span class="at">{line.at}</span>
          <span class="material-symbols-outlined ic tone-{line.tone}" aria-hidden="true">{line.icon}</span>
          <span class="what">{line.what}</span>
          <span class="meta tone-{line.metaTone}">{line.meta}</span>
        </div>
      {/each}
    </div>
  {/if}
{/if}
