<!--
  HTTP request → Auth tab: auth type (inherit, none, bearer, basic, API key, OAuth 2.0, session), its
  fields, and what an inherited folder auth resolves to. OAuth / session have their own panels nearby.
-->
<script lang="ts">
  import { t } from '$shared/i18n';
  import { authFolderFor, workspace } from '$entities/workspace';
  import { resolveVars, type ApiKeyLocation, type AuthConfig, type AuthType, type Tab } from '$shared/model';
  import { envToneOf, currentVarScope, environments } from '$entities/environment';
  import { tabs } from '$entities/tab';
  import AuthTypeMenu from './AuthTypeMenu.svelte';
  import OAuthPanel from './OAuthPanel.svelte';
  import OAuthInheritedRows from './OAuthInheritedRows.svelte';
  import { oauthSummary } from './oauthFormat';
  import { inputPrompts } from '$entities/input';
  import { requestRuntime } from './requestRuntime.svelte';
  import { sessionRuntime } from './session.svelte';
  import { nodeLabel } from './sessionView';
  import SessionPanel from './SessionPanel.svelte';
  import SessionInheritedRows from './SessionInheritedRows.svelte';
  import SessionSendBanner from './SessionSendBanner.svelte';
  import AuthCard from './AuthCard.svelte';
  import AuthInput from './AuthInput.svelte';
  import AuthSeg from './AuthSeg.svelte';
  import KvPanel from './KvPanel.svelte';
  import KvVarInput from './KvVarInput.svelte';

  // Edits the request's auth (`tab`; gRPC tabs keep it on `tab.grpc`) or, in the folder dialog, a draft `value` (`onChange`).
  let {
    tab,
    value,
    onChange,
    where,
    onSaved,
    onOpenRunner,
  }: {
    tab?: Tab;
    value?: AuthConfig;
    onChange?: (a: AuthConfig) => void;
    /** Where `value` is set (the folder dialog's collection), for OAuth's «Все токены». */
    where?: string;
    /** Session (folder dialog): a sign-in from the card finished, for the app's toast. */
    onSaved?: (text: string) => void;
    /** Session (folder dialog): «Открыть в Runner» on the sign-in scenario. */
    onOpenRunner?: (scenario: string) => void;
  } = $props();
  const isGrpc = $derived(tab?.protocol === 'grpc');

  // S11: a label column + controls, with what the secret resolves to in the active environment.
  const authTypes: { key: Exclude<AuthType, 'inherit'>; label: string; hint: string }[] = [
    { key: 'bearer', label: 'http.auth.bearer', hint: 'http.auth.bearer.hint' },
    { key: 'basic', label: 'http.auth.basic', hint: 'http.auth.basic.hint' },
    { key: 'apiKey', label: 'http.auth.apikey', hint: 'http.auth.apikey.hint' },
    { key: 'oauth2', label: 'http.auth.oauth2', hint: 'http.auth.oauth2.hint' },
    { key: 'session', label: 'session.type', hint: 'session.hint' },
    { key: 'none', label: 'http.auth.none', hint: 'http.auth.none.hint' },
  ];
  type AuthStringField = 'bearerToken' | 'basicUsername' | 'basicPassword' | 'apiKeyName' | 'apiKeyValue';

  const none: AuthConfig = { type: 'none', apiKeyIn: 'header' };
  const ownAuth = $derived(tab ? (isGrpc ? tab.grpc?.auth : tab.request.auth) : value);
  const parent = $derived(tab ? authFolderFor(workspace.tree, tab.savedPath) : undefined);
  const ownType = $derived(ownAuth?.type ?? 'inherit');
  // S11: a request without its own auth shows (read-only) what its collection hands down.
  const inheriting = $derived(!!parent?.auth && ownType === 'inherit');
  const auth = $derived<AuthConfig>(inheriting ? parent!.auth! : ownType === 'inherit' ? none : ownAuth!);
  const selectValue = $derived(ownType === 'inherit' && !inheriting && tab ? 'none' : inheriting ? auth.type : ownType);
  const inheritLabel = $derived(tab ? t('http.auth.inherit') : t('http.auth.unset'));
  // OA1: the menu's order and icons.
  const typeIcons: Record<AuthType, string> = {
    inherit: 'account_tree',
    none: 'block',
    bearer: 'key',
    basic: 'badge',
    apiKey: 'vpn_key',
    oauth2: 'shield_person',
    session: 'passkey',
  };
  const typeLabel = (key: AuthType) =>
    key === 'inherit' ? inheritLabel : t(authTypes.find((a) => a.key === key)?.label ?? 'http.auth.none');
  const typeOptions = $derived(
    (
      [
        ...(!tab || (parent && !inheriting) ? ['inherit'] : []),
        'none',
        'bearer',
        'basic',
        'apiKey',
        'oauth2',
        // Flow · Сессия: set on a collection; a request inherits it (one it already has stays shown).
        ...(!tab || ownType === 'session' ? ['session'] : []),
      ] as AuthType[]
    ).map((key) => ({ key, label: typeLabel(key), icon: typeIcons[key] })),
  );
  const current = $derived(authTypes.find((a) => a.key === auth.type) ?? authTypes.find((a) => a.key === 'none')!);
  // OAuth: with a token the settings fold into a summary on the Type row (OA4/OA5).
  let oauthConfigOpen = $state(false);
  let oauthFolded = $state(false);
  const oauthLine = $derived.by(() => {
    if (auth.type !== 'oauth2') return '';
    void environments.activeId;
    const scope = currentVarScope();
    return oauthSummary(auth.oauth, (s) => resolveVars(s, scope));
  });
  // Session: the collection edits it (SE2); a request shows it read-only (SE3), or how its last send got the token (SE4/SE5).
  let sessionConfigOpen = $state(false);
  let sessionFolded = $state(false);
  const sessionCfg = $derived(auth.type === 'session' ? auth.session : undefined);
  const sessionSummary = $derived(
    sessionCfg?.login
      ? [
          t('session.summary', { login: sessionCfg.login }),
          sessionCfg.renewRequest
            ? t('session.summary.renew', { name: nodeLabel(workspace.tree, sessionCfg.renewRequest) })
            : t('session.summary.noRenew'),
        ].join('  ·  ')
      : t('session.summary.unset'),
  );
  const sessionCompact = $derived(
    sessionCfg
      ? [
          inheriting ? t('session.inh.compact') : t('session.inh.own'),
          sessionCfg.login ? t('session.inh.login', { login: sessionCfg.login }) : '',
          sessionCfg.renewRequest
            ? t('session.inh.renew', { name: nodeLabel(workspace.tree, sessionCfg.renewRequest) })
            : '',
        ]
          .filter(Boolean)
          .join('  ·  ')
      : '',
  );
  const sessionSending = $derived.by(() => {
    if (!tab || auth.type !== 'session') return false;
    const requestId = requestRuntime.busy[tab.id]?.requestId;
    return !!sessionRuntime.uses[tab.id] || !!(requestId && inputPrompts.byRequest[requestId]?.session);
  });
  const secretField = $derived<AuthStringField | null>(
    auth.type === 'bearer'
      ? 'bearerToken'
      : auth.type === 'basic'
        ? 'basicPassword'
        : auth.type === 'apiKey'
          ? 'apiKeyValue'
          : null,
  );
  const secret = $derived(secretField ? (auth[secretField] ?? '') : '');
  const activeEnv = $derived(environments.active);
  const envName = $derived(activeEnv?.name);
  // Re-read the scope whenever variables change.
  const resolved = $derived.by(() => {
    void environments.globals;
    void environments.list;
    void environments.activeId;
    return /\{\{/.test(secret) ? resolveVars(secret, currentVarScope()) : '';
  });
  let reveal = $state<boolean | null>(null);
  // Typing keeps the field as it was: `{{x}}` appearing or going away must not swap the editor under the caret.
  let typedShown = $state<boolean | null>(null);
  const shown = $derived(reveal ?? typedShown ?? /^\s*\{\{[^{}]+\}\}\s*$/.test(secret));

  const isVar = (v: string | undefined) => /^\s*\{\{[^{}]+\}\}\s*$/.test(v ?? '');
  function mask(v: string): string {
    return v.length <= 12 ? '•'.repeat(v.length) : `${v.slice(0, 8)}${'•'.repeat(12)}${v.slice(-4)}`;
  }

  function write(next: AuthConfig): void {
    if (tab && isGrpc) tabs.updateActive((t) => (t.grpc ? { ...t, grpc: { ...t.grpc, auth: next } } : t));
    else if (tab) tabs.updateActive((t) => ({ ...t, request: { ...t.request, auth: next } }));
    else onChange?.(next);
  }
  function setAuthType(type: AuthType): void {
    write(type === 'inherit' ? { type } : { ...auth, type, apiKeyIn: auth.apiKeyIn ?? 'header' });
  }
  function setAuthField(field: AuthStringField, value: string): void {
    typedShown ??= shown;
    write({ ...auth, [field]: value });
  }
  function setApiKeyLocation(value: ApiKeyLocation): void {
    write({ ...auth, type: 'apiKey', apiKeyIn: value });
  }
</script>

{#snippet field(label: string, key: AuthStringField, secretInput = false)}
  <div class="row">
    <span class="lbl">{label}</span>
    <AuthInput class={{ var: isVar(auth[key]) }}>
      {#if isVar(auth[key])}<span class="material-symbols-outlined" aria-hidden="true">key</span>{/if}
      {#if inheriting || (secretInput && !shown)}
        <input
          type={secretInput && !shown ? 'password' : 'text'}
          readonly={inheriting}
          autocomplete="off"
          spellcheck="false"
          aria-label={label}
          value={auth[key] ?? ''}
          oninput={(e) => setAuthField(key, e.currentTarget.value)}
        />
      {:else}
        <!-- `{{var}}` chip + popover to set its value, like the URL bar. -->
        <KvVarInput
          ariaLabel={label}
          value={auth[key] ?? ''}
          onChange={(v) => setAuthField(key, v)}
          docId={`${tab?.id ?? where ?? 'folder'}:auth:${key}`}
        />
      {/if}
    </AuthInput>
    {#if secretInput}
      <button
        class="eye"
        type="button"
        aria-label={shown ? t('http.auth.hide') : t('http.auth.show')}
        aria-pressed={shown}
        onclick={() => (reveal = !shown)}
      >
        <span class="material-symbols-outlined">{shown ? 'visibility' : 'visibility_off'}</span>
      </button>
    {/if}
  </div>
{/snippet}

<KvPanel class="bs-auth-wrap">
  {#if sessionSending && tab}
    <div class="se-send">
      <AuthCard class="se-compact">
        <div class="row">
          <span class="lbl">{t('http.auth.type')}</span>
          <span class="se-type"
            ><span class="material-symbols-outlined" aria-hidden="true">{typeIcons.session}</span>{t(
              'session.type',
            )}</span
          >
          <span class="hint grow">{sessionCompact}</span>
        </div>
      </AuthCard>
      <SessionSendBanner {tab} {auth} />
    </div>
  {:else}
    {#if inheriting}
      <div class="bs-auth-inherit">
        <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
        <span class="msg">{t('http.auth.inherited_msg', { name: parent?.name ?? '' })}</span>
        <button type="button" onclick={() => write({ ...auth })}>{t('http.auth.override')}</button>
      </div>
    {/if}
    <AuthCard>
      <div class="row">
        <span class="lbl">{t('http.auth.type')}</span>
        {#if auth.type === 'session' && inheriting}
          <span class="se-type"
            ><span class="material-symbols-outlined" aria-hidden="true">{typeIcons.session}</span>{t(
              'session.inh.type',
              {
                login: sessionCfg?.login || '—',
              },
            )}</span
          >
        {:else}
          <AuthTypeMenu
            options={typeOptions}
            value={selectValue}
            label={typeLabel(selectValue)}
            onSelect={setAuthType}
          />
        {/if}
        {#if auth.type === 'session' && !tab}
          <span class="hint grow">{sessionFolded ? sessionSummary : t('session.hint')}</span>
          {#if sessionFolded}
            <button
              class="bs-oa-settings"
              type="button"
              aria-expanded={sessionConfigOpen}
              onclick={() => (sessionConfigOpen = !sessionConfigOpen)}
              >{t('oauth.settings')}<span class="material-symbols-outlined" aria-hidden="true"
                >{sessionConfigOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}</span
              ></button
            >
          {/if}
        {:else if auth.type === 'session'}
          {#if !inheriting}<span class="hint grow">{t('session.hint')}</span>{/if}
        {:else if auth.type === 'oauth2' && (oauthFolded || inheriting)}
          <span class="hint grow">{oauthLine}</span>
          {#if !inheriting}
            <button
              class="bs-oa-settings"
              type="button"
              aria-expanded={oauthConfigOpen}
              onclick={() => (oauthConfigOpen = !oauthConfigOpen)}
              ><span class="material-symbols-outlined" aria-hidden="true">tune</span>{t('oauth.settings')}</button
            >
          {/if}
        {:else}
          <span class="hint">{selectValue === 'inherit' ? '' : t(current.hint)}</span>
        {/if}
      </div>
      {#if auth.type === 'oauth2' && inheriting}
        <OAuthInheritedRows {auth} folder={parent} />
      {/if}
      {#if auth.type === 'session' && tab}
        <SessionInheritedRows {auth} />
      {/if}
      {#if auth.type === 'bearer'}
        {@render field(t('http.auth.token'), 'bearerToken', true)}
      {:else if auth.type === 'basic'}
        {@render field(t('http.auth.username'), 'basicUsername')}
        {@render field(t('http.auth.password'), 'basicPassword', true)}
      {:else if auth.type === 'apiKey'}
        <div class="row">
          <span class="lbl">{t('http.auth.add_to')}</span>
          <AuthSeg role="radiogroup" aria-label={t('http.auth.loc_aria')}>
            {#each [['header', 'http.auth.loc.header'], ['query', 'http.auth.loc.query']] as [key, label] (key)}
              <button
                type="button"
                role="radio"
                class:on={(auth.apiKeyIn ?? 'header') === key}
                aria-checked={(auth.apiKeyIn ?? 'header') === key}
                disabled={inheriting}
                onclick={() => setApiKeyLocation(key as ApiKeyLocation)}>{t(label)}</button
              >
            {/each}
          </AuthSeg>
        </div>
        {@render field(t('http.auth.key'), 'apiKeyName')}
        {@render field(t('http.auth.value'), 'apiKeyValue', true)}
      {/if}
      {#if resolved && auth.type !== 'oauth2'}
        <div class="row resolves">
          <span class="lbl">{t('http.auth.resolves')}</span>
          <span class="secret">{reveal ? resolved : mask(resolved)}</span>
          {#if envName}
            <span class="env tone-{envToneOf(activeEnv)}"
              >{#if envToneOf(activeEnv) === 'production'}<span class="material-symbols-outlined" aria-hidden="true"
                  >lock</span
                >{/if}{envName}</span
            >
          {/if}
        </div>
      {/if}
    </AuthCard>
    {#if auth.type === 'oauth2' && !inheriting}
      <OAuthPanel
        {auth}
        onChange={write}
        tabId={tab?.id}
        where={where ?? tab?.title ?? ''}
        bind:configOpen={oauthConfigOpen}
        bind:folded={oauthFolded}
      />
    {/if}
    {#if auth.type === 'session' && !tab}
      <SessionPanel
        {auth}
        onChange={write}
        where={where ?? ''}
        {onSaved}
        {onOpenRunner}
        bind:configOpen={sessionConfigOpen}
        bind:folded={sessionFolded}
      />
    {/if}
  {/if}
</KvPanel>

<style>
  :global(.bs .bs-auth-card) .row.resolves {
    min-height: 44px;
  }

  :global(:root .bs-auth-wrap) {
    background: color-mix(in srgb, var(--surface) 20%, transparent);
  }

  :global(.bs) .bs-auth-inherit {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 45px;
    margin-bottom: 12px;
    padding: 0 8px 0 16px;
    border-radius: var(--radius-card);
    background: var(--color-selected);
  }

  :global(.bs) .bs-auth-inherit > :global(.material-symbols-outlined) {
    flex: none;
    font-size: 16px;
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-auth-inherit :global(.msg) {
    flex: 1;
    margin-left: -2px;
    min-width: 0;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-auth-inherit :global(button) {
    flex: none;
    height: 25px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-auth-inherit :global(button:hover) {
    background: var(--color-raised);
  }

  :global(.bs) .bs-oa-settings {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-oa-settings:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }

  :global(.bs) .bs-oa-settings :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  :global(.bs) .se-send {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  :global(.bs) .se-type {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
    white-space: nowrap;
  }

  :global(.bs) .se-type :global(.material-symbols-outlined) {
    font-size: 15px;
    color: var(--color-text-secondary);
  }
</style>
