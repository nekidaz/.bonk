<script lang="ts">
  import { t, tp } from '$shared/i18n';
  import { scenariosLoad } from '$shared/ipc';
  import {
    methodColor,
    sessionCanRenew,
    sessionConfigured,
    sessionTone,
    type AuthConfig,
    type Scenario,
    type SessionConfig,
    type SessionInfo,
    type TokenSource,
  } from '$shared/model';
  import { environments, envToneOf } from '$entities/environment';
  import { inputs } from '$entities/input';
  import { workspace } from '$entities/workspace';
  import {
    activeEnvName,
    cancelSessionRun,
    openSessions,
    runSession,
    sessionCardKey,
    sessionRuntime,
    sessionStatuses,
    signOutSessions,
  } from './session.svelte';
  import { sessionClock, sessionSpan, sessionStatusText } from './sessionFormat';
  import {
    allRequests,
    askedSteps,
    isFolder,
    nodeLabel,
    nodeMethod,
    nodeOptions,
    scenarioRequests,
    sessionMissing,
  } from './sessionView';
  import { Button, Switch } from '$shared/ui/components';
  import AuthPanel from './AuthPanel.svelte';
  import AuthCard from './AuthCard.svelte';
  import StatusCard from './StatusCard.svelte';
  import AuthInput from './AuthInput.svelte';

  // Flow · Session SE2: the session card of the selected environment, the setup at a glance, and the
  // settings under “Settings” (open while the setup cannot sign in yet). Collection level only.
  let {
    auth,
    onChange,
    where,
    configOpen = $bindable(false),
    folded = $bindable(false),
    onSaved,
    onOpenRunner,
  }: {
    auth: AuthConfig;
    onChange: (a: AuthConfig) => void;
    /** The collection it is set on, for “All sessions” and the toast. */
    where: string;
    configOpen?: boolean;
    /** Settings fold into the Type row once the setup can sign in. */
    folded?: boolean;
    /** A sign-in from the card finished: the app shows a toast. */
    onSaved?: (text: string) => void;
    /** “Open in Runner”: the app opens the sign-in scenario there. */
    onOpenRunner?: (scenario: string) => void;
  } = $props();

  const cfg = $derived<SessionConfig>(auth.session ?? {});
  const env = $derived(activeEnvName());
  const activeEnv = $derived(environments.active);
  const key = $derived(sessionCardKey(auth, env));
  const configured = $derived(sessionConfigured(cfg));
  const canRenew = $derived(sessionCanRenew(cfg));
  const showConfig = $derived(!configured || configOpen);
  $effect(() => {
    folded = configured;
  });

  let scenarios = $state.raw<Scenario[]>([]);
  $effect(() => {
    const root = workspace.path;
    let live = true;
    if (root)
      scenariosLoad(root)
        .then((list) => live && (scenarios = list))
        .catch(() => live && (scenarios = []));
    return () => {
      live = false;
    };
  });
  const scenario = $derived(scenarios.find((s) => s.name === cfg.login));
  const steps = $derived(scenarioRequests(scenario, workspace.tree));
  const asked = $derived(askedSteps(steps, Object.keys(inputs.defs)));
  const stepOptions = $derived(scenario ? steps : allRequests(workspace.tree));
  const everyRequest = $derived(allRequests(workspace.tree));

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
  const running = $derived(Object.entries(sessionRuntime.running).find(([, r]) => r.key === key));
  const failure = $derived(sessionRuntime.failure?.key === key ? sessionRuntime.failure.message : '');
  const auto = $derived(cfg.autoRefresh !== false);
  const login = $derived(cfg.login || '—');
  const renewName = $derived(nodeLabel(workspace.tree, cfg.renewRequest));

  const refreshPart = $derived(
    !info?.hasRefresh
      ? ''
      : info.refreshExp === null
        ? t('session.card.refreshNoExp')
        : t('session.card.refreshLeft', { n: sessionSpan(info.refreshExp - now) }),
  );
  const okSub = $derived.by(() => {
    if (!info) return '';
    const access =
      info.accessExp === null
        ? t('session.noExpiry')
        : t(auto && canRenew && info.hasRefresh ? 'session.card.accessAuto' : 'session.card.accessExp', {
            time: sessionClock(info.accessExp),
          });
    const rest = [access, refreshPart].filter(Boolean).join(', ');
    return info.who ? `${t('session.card.who', { who: info.who })}  ·  ${rest}` : rest;
  });

  async function run(mode: 'signIn' | 'refresh'): Promise<void> {
    const used = await runSession(mode, $state.snapshot(auth) as AuthConfig, env);
    if (used && mode === 'signIn') onSaved?.(t('session.saved', { where, env: env || '—' }));
  }
  const signOut = () => void signOutSessions($state.snapshot(auth) as AuthConfig, [env]);

  function set(patch: Partial<SessionConfig>): void {
    onChange({ ...auth, session: { ...cfg, ...patch } });
  }
  function setSource(field: 'access' | 'refresh' | 'who', patch: Partial<TokenSource>): void {
    set({ [field]: { ...cfg[field], ...patch } });
  }
  const excludeOptions = $derived(nodeOptions(workspace.tree).filter((o) => !(cfg.exclude ?? []).includes(o.rel)));
  const excludedText = $derived.by(() => {
    const rels = [...(scenario?.paths ?? []), ...(cfg.exclude ?? [])];
    const names = rels.map((rel) => {
      const name = nodeLabel(workspace.tree, `fs:${rel}`);
      return isFolder(workspace.tree, rel) ? t('session.d.folder', { name }) : name;
    });
    return names.length ? t('session.d.injectExcept', { list: names.join(', ') }) : t('session.d.injectAll');
  });
  const askedText = $derived(asked ? t(`session.d.asked.${tp(asked, ['one', 'many'])}`, { n: asked }) : '');
  const pill = (exp: number | null): string =>
    exp === null
      ? t('session.noExpiry')
      : exp <= now
        ? t('session.d.expired')
        : t('session.left', { n: sessionSpan(exp - now) });
</script>

{#snippet envPill()}
  {#if activeEnv}
    <span class="env tone-{envToneOf(activeEnv)}"
      >{#if envToneOf(activeEnv) === 'production'}<span class="material-symbols-outlined" aria-hidden="true">lock</span
        >{/if}{activeEnv.name}</span
    >
  {/if}
{/snippet}

{#snippet method(id: string | undefined)}
  {@const m = nodeMethod(workspace.tree, id)}
  {#if m}<span class="se-method" style:color={methodColor(m)}>{m}</span>{/if}
{/snippet}

{#snippet requestSelect(
  value: string | undefined,
  options: { id: string; name: string }[],
  label: string,
  pick: (id: string) => void,
  optional = false,
)}
  <AuthInput class="se-select">
    <select aria-label={label} value={value ?? ''} onchange={(e) => pick(e.currentTarget.value)}>
      <option value="" disabled={!optional}>{optional ? t('session.s.none') : t('session.s.request_ph')}</option>
      {#if value && !options.some((o) => o.id === value)}
        <option {value}>{nodeLabel(workspace.tree, value)}</option>
      {/if}
      {#each options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
    </select>
    <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
  </AuthInput>
{/snippet}

{#snippet pathInput(value: string | undefined, label: string, placeholder: string, write: (v: string) => void)}
  <AuthInput class="se-path">
    <input
      type="text"
      autocomplete="off"
      spellcheck="false"
      aria-label={label}
      {placeholder}
      value={value ?? ''}
      oninput={(e) => write(e.currentTarget.value)}
    />
  </AuthInput>
{/snippet}

<AuthPanel class="bs-se">
  {#if configured}
    {#if running}
      {@const [requestId, r] = running}
      <StatusCard class="se-card tone-accent">
        <span class="se-badge"
          ><span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span></span
        >
        <div class="txt">
          <div class="ttl">
            {r.mode === 'signIn' ? t('session.card.signingIn', { login }) : t('session.card.refreshing')}
            {@render envPill()}
          </div>
          <div class="sub">
            {r.mode === 'signIn' ? t('session.card.waitSub') : t('session.card.refreshSub', { name: renewName })}
          </div>
        </div>
        <div class="acts">
          <Button variant="ghost" onclick={() => void cancelSessionRun(requestId)}>{t('session.cancel')}</Button>
        </div>
      </StatusCard>
    {:else}
      <StatusCard
        class={[
          'se-card',
          {
            'tone-success': tone === 'ok',
            'tone-warning': tone === 'renew',
            'tone-danger': !!failure,
            'se-dead': tone === 'dead' && !failure,
          },
        ]}
      >
        <span class="se-badge"
          ><span class="material-symbols-outlined" aria-hidden="true"
            >{failure ? 'error' : tone === 'renew' ? 'schedule' : tone === 'dead' ? 'lock_clock' : 'key'}</span
          ></span
        >
        <div class="txt">
          <div class="ttl">
            {failure ? t('session.card.failed') : t(`session.card.${tone}`)}
            {#if tone !== 'none'}<span class="badge">{sessionStatusText(info, now)}</span>{/if}
            {@render envPill()}
          </div>
          <div class="sub">
            {#if failure}
              {failure}
            {:else if tone === 'ok'}
              {okSub}
            {:else if tone === 'renew'}
              {auto && canRenew
                ? `${refreshPart} — ${t('session.card.renewSub', { name: renewName })}`
                : t('session.card.renewManual')}
            {:else if tone === 'dead'}
              {t('session.card.deadSub', { login })}
            {:else}
              {t('session.card.noneSub', { login })}
            {/if}
          </div>
        </div>
        <div class="acts">
          {#if tone !== 'none'}
            <button class="link" type="button" onclick={signOut}
              ><span class="material-symbols-outlined" aria-hidden="true">logout</span>{t('session.signOut')}</button
            >
          {/if}
          {#if (tone === 'ok' || tone === 'renew') && canRenew && !failure}
            <Button variant="ghost" onclick={() => void run('refresh')}
              ><span class="material-symbols-outlined" aria-hidden="true">refresh</span>{t('session.refresh')}</Button
            >
          {:else}
            <Button variant="primary" onclick={() => void run('signIn')}
              ><span class="material-symbols-outlined" aria-hidden="true">login</span>{t('session.signIn')}</Button
            >
          {/if}
        </div>
      </StatusCard>
    {/if}
  {/if}

  {#if !showConfig}
    <!-- The setup at a glance (read-only; “Settings” on the Type row edits it). -->
    <AuthCard class="details se-details">
      <div class="row">
        <span class="lbl">{t('session.d.login')}</span>
        <span class="se-chip"
          ><span class="material-symbols-outlined" aria-hidden="true">play_circle</span>{cfg.login}</span
        >
        <span class="hint grow se-ellipsis"
          >{steps.map((s) => s.name).join(' → ')}{askedText ? `  ·  ${askedText}` : ''}</span
        >
        {#if onOpenRunner && cfg.login}
          <button class="link" type="button" onclick={() => onOpenRunner?.(cfg.login ?? '')}
            ><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>{t(
              'session.d.openRunner',
            )}</button
          >
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.access')}</span>
        <span class="secret grow se-ellipsis"
          >{`${nodeLabel(workspace.tree, cfg.access?.request)}  →  ${cfg.access?.path ?? ''}`}</span
        >
        {#if info && info.accessExp !== null && info.accessExp > info.obtainedAt}
          <span class="se-chip dim"
            >{t(info.accessPreview.startsWith('eyJ') ? 'session.d.jwt' : 'session.d.exp', {
              n: sessionSpan(info.accessExp - info.obtainedAt),
            })}</span
          >
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.refresh')}</span>
        {#if cfg.refresh?.request}
          <span class="secret grow se-ellipsis"
            >{`${nodeLabel(workspace.tree, cfg.refresh.request)}  →  ${cfg.refresh.path ?? ''}`}</span
          >
          {#if info?.hasRefresh}
            <span
              class="se-chip"
              class:ok={info.refreshExp === null || info.refreshExp > now}
              class:bad={info.refreshExp !== null && info.refreshExp <= now}>{pill(info.refreshExp)}</span
            >
          {/if}
        {:else}
          <span class="hint">{t('session.d.noRefresh')}</span>
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.renew')}</span>
        {#if cfg.renewRequest}
          {@render method(cfg.renewRequest)}
          <span class="se-name">{renewName}</span>
          <span class="hint grow se-mono se-ellipsis"
            >{`{{session.refresh}}  →  ${cfg.renewAccess || 'body.access_token'}${cfg.renewRefresh ? `, ${cfg.renewRefresh}` : ''}`}</span
          >
        {:else}
          <span class="hint">{t('session.d.noRenew')}</span>
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.when')}</span>
        <span class="se-chip dim"
          ><span class="material-symbols-outlined" aria-hidden="true">schedule</span>{t('session.d.lead', {
            n: cfg.leadSecs ?? 60,
          })}</span
        >
        {#if cfg.retryOn401 !== false}
          <span class="se-chip dim"
            ><span class="material-symbols-outlined" aria-hidden="true">replay</span>{t('session.d.retry')}</span
          >
        {/if}
        <span class="grow"></span>
        <span class="hint">{t('session.d.auto')}</span>
        <Switch aria-label={t('session.d.auto')} checked={auto} onclick={() => set({ autoRefresh: !auto })} />
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.inject')}</span>
        <span class="secret se-nowrap">Authorization: Bearer <span class="se-var">{'{{session.access}}'}</span></span>
        <span class="hint grow se-ellipsis">{excludedText}</span>
      </div>
      <div class="row foot">
        <button class="link" type="button" onclick={() => openSessions($state.snapshot(auth) as AuthConfig, where)}
          ><span class="material-symbols-outlined" aria-hidden="true">passkey</span>{t('session.all')}</button
        >
      </div>
    </AuthCard>
  {:else}
    <!-- Settings: which scenario signs in, where its responses keep the tokens, how they renew. -->
    <AuthCard class="config se-config">
      {#if !configured}
        <div class="row se-missing">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          <span
            >{t('session.s.missing', {
              list: sessionMissing(cfg)
                .map((k) => t(k))
                .join(', '),
            })}</span
          >
        </div>
      {/if}
      <div class="row">
        <span class="lbl">{t('session.d.login')}</span>
        {#if scenarios.length || cfg.login}
          <AuthInput class="se-select">
            <select
              aria-label={t('session.d.login')}
              value={cfg.login ?? ''}
              onchange={(e) => set({ login: e.currentTarget.value })}
            >
              <option value="" disabled>{t('session.s.scenario_ph')}</option>
              {#if cfg.login && !scenario}<option value={cfg.login}>{cfg.login}</option>{/if}
              {#each scenarios as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
            </select>
            <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
          </AuthInput>
          <span class="hint grow se-ellipsis">{steps.map((s) => s.name).join(' → ')}</span>
        {:else}
          <span class="hint">{t('session.s.noScenarios')}</span>
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.access')}</span>
        {@render requestSelect(cfg.access?.request, stepOptions, t('session.d.access'), (id) =>
          setSource('access', { request: id, path: cfg.access?.path || 'body.access_token' }),
        )}
        {@render pathInput(cfg.access?.path, t('session.s.path'), 'body.access_token', (v) =>
          setSource('access', { path: v }),
        )}
        {@render pathInput(cfg.access?.ttlPath, t('session.s.ttl_ph'), t('session.s.ttl_ph'), (v) =>
          setSource('access', { ttlPath: v }),
        )}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.refresh')}</span>
        {@render requestSelect(
          cfg.refresh?.request,
          stepOptions,
          t('session.d.refresh'),
          (id) => setSource('refresh', { request: id, path: cfg.refresh?.path || (id ? 'body.refresh_token' : '') }),
          true,
        )}
        {#if cfg.refresh?.request}
          {@render pathInput(cfg.refresh?.path, t('session.s.path'), 'body.refresh_token', (v) =>
            setSource('refresh', { path: v }),
          )}
          {@render pathInput(cfg.refresh?.ttlPath, t('session.s.ttl_ph'), t('session.s.ttl_ph'), (v) =>
            setSource('refresh', { ttlPath: v }),
          )}
        {:else}
          <span class="hint grow">{t('session.d.noRefresh')}</span>
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.renew')}</span>
        {@render requestSelect(
          cfg.renewRequest,
          everyRequest,
          t('session.d.renew'),
          (id) => set({ renewRequest: id }),
          true,
        )}
        {#if cfg.renewRequest}
          {@render pathInput(cfg.renewAccess, t('session.s.renewAccess_ph'), t('session.s.renewAccess_ph'), (v) =>
            set({ renewAccess: v }),
          )}
          {@render pathInput(cfg.renewRefresh, t('session.s.renewRefresh_ph'), t('session.s.renewRefresh_ph'), (v) =>
            set({ renewRefresh: v }),
          )}
        {:else}
          <span class="hint grow">{t('session.d.noRenew')}</span>
        {/if}
      </div>
      <div class="row se-note">
        <span class="lbl"></span>
        <span class="hint">{t('session.s.renew_hint')}</span>
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.who')}</span>
        {@render requestSelect(
          cfg.who?.request,
          stepOptions,
          t('session.d.who'),
          (id) => setSource('who', { request: id }),
          true,
        )}
        {#if cfg.who?.request}
          {@render pathInput(cfg.who?.path, t('session.s.path'), 'body.phone', (v) => setSource('who', { path: v }))}
        {:else}
          <span class="grow"></span>
        {/if}
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.when')}</span>
        <span class="hint">{t('session.s.lead')}</span>
        <AuthInput class="se-num">
          <input
            type="number"
            min="0"
            aria-label={t('session.s.lead')}
            value={cfg.leadSecs ?? 60}
            oninput={(e) => {
              const n = e.currentTarget.valueAsNumber;
              if (Number.isFinite(n) && n >= 0) set({ leadSecs: Math.round(n) });
            }}
          />
        </AuthInput>
        <span class="hint">{t('session.s.secs')}</span>
        <span class="grow"></span>
        <span class="hint">{t('session.d.auto')}</span>
        <Switch aria-label={t('session.d.auto')} checked={auto} onclick={() => set({ autoRefresh: !auto })} />
      </div>
      <div class="row">
        <span class="lbl">401</span>
        <Switch
          aria-label={t('session.s.retry')}
          checked={cfg.retryOn401 !== false}
          onclick={() => set({ retryOn401: cfg.retryOn401 === false })}
        />
        <span class="hint">{t('session.s.retry')}</span>
      </div>
      <div class="row">
        <span class="lbl">{t('session.d.exclude')}</span>
        <span class="chips">
          {#each cfg.exclude ?? [] as rel (rel)}
            <span class="chip"
              >{rel}<button
                type="button"
                aria-label={t('session.s.exclude_remove', { name: rel })}
                onclick={() => set({ exclude: (cfg.exclude ?? []).filter((x) => x !== rel) })}
                ><span class="material-symbols-outlined">close</span></button
              ></span
            >
          {/each}
          <AuthInput class="se-select se-add">
            <select
              aria-label={t('session.s.exclude_add')}
              value=""
              onchange={(e) => {
                const rel = e.currentTarget.value;
                e.currentTarget.value = '';
                if (rel) set({ exclude: [...(cfg.exclude ?? []), rel] });
              }}
            >
              <option value="" disabled>{t('session.s.exclude_add')}</option>
              {#each excludeOptions as o (o.rel)}<option value={o.rel}>{o.label}</option>{/each}
            </select>
          </AuthInput>
        </span>
        <span class="hint side">{t('session.s.exclude_hint')}</span>
      </div>
      {#if configured}
        <div class="row foot">
          <button class="link" type="button" onclick={() => openSessions($state.snapshot(auth) as AuthConfig, where)}
            ><span class="material-symbols-outlined" aria-hidden="true">passkey</span>{t('session.all')}</button
          >
        </div>
      {/if}
    </AuthCard>
  {/if}
</AuthPanel>

<style>
  :global(:root .bs .se-card.se-dead .badge) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .se-chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 9px;
    border-radius: 999px;
    background: var(--color-raised);
    color: var(--color-text);
    font: 500 var(--font-size-caption) var(--font-ui);
    white-space: nowrap;
  }

  :global(.bs) .se-chip.dim {
    color: var(--color-text-secondary);
  }

  :global(.bs) .se-chip.ok {
    background: var(--color-success-soft);
    color: var(--color-success);
  }

  :global(.bs) .se-chip.bad {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  :global(.bs) .se-chip :global(.material-symbols-outlined) {
    font-size: 13px;
  }

  :global(.bs) .se-method {
    flex: none;
    font: 600 var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .se-name {
    flex: none;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs .bs-auth-card) .hint.se-mono {
    font-family: var(--font-code);
  }

  :global(.bs) .se-ellipsis {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.bs) .se-nowrap {
    flex: none;
    white-space: nowrap;
  }

  :global(.bs) .se-var {
    display: inline-flex;
    align-items: center;
    height: 22px;
    margin-left: 2px;
    padding: 0 9px;
    border-radius: 999px;
    background: var(--color-var-soft);
    color: var(--color-var);
    font: 500 var(--font-size-caption) var(--font-code);
  }

  :global(:root .bs .bs-auth-input.se-select) {
    position: relative;
    flex: 0 1 220px;
    padding-right: 30px;
  }

  :global(:root .bs .bs-auth-input.se-select select) {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    appearance: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
    cursor: pointer;
  }

  :global(:root .bs .bs-auth-input.se-select select:focus-visible) {
    outline: none;
  }

  :global(:root .bs .bs-auth-input.se-select .material-symbols-outlined) {
    position: absolute;
    right: 10px;
    color: var(--color-text-muted);
    pointer-events: none;
  }

  :global(:root .bs .bs-auth-input.se-path) {
    flex: 1 1 150px;
  }

  :global(:root .bs .bs-auth-input.se-num) {
    flex: 0 0 72px;
    padding: 0 10px;
  }

  :global(:root .bs .bs-auth-input.se-select.se-add) {
    flex: 0 0 auto;
    height: 24px;
    padding: 0 10px;
    background: transparent;
  }

  :global(:root .bs .bs-auth-input.se-select.se-add select) {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }

  :global(.bs .bs-auth-card) .row.se-missing {
    gap: 8px;
    min-height: 40px;
    color: var(--color-warning);
    font: var(--font-size-caption) var(--font-ui);
  }

  :global(.bs .bs-auth-card) .row.se-missing :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs .bs-auth-card) .row.se-note {
    min-height: 0;
    padding: 0 0 8px;
  }

  :global(.bs .bs-auth-card) .row.se-note :global(.hint) {
    font-size: var(--font-size-caption);
  }
</style>
