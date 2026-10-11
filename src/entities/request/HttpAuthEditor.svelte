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

  // Edits the request's auth (`tab`; gRPC tabs keep it on `tab.grpc`) or, in the folder dialog, a draft `value` (`onChange`).
  let {
    tab,
    value,
    onChange,
    where,
  }: {
    tab?: Tab;
    value?: AuthConfig;
    onChange?: (a: AuthConfig) => void;
    /** Where `value` is set (the folder dialog's collection), for OAuth's «Все токены». */
    where?: string;
  } = $props();
  const isGrpc = $derived(tab?.protocol === 'grpc');

  // S11: a label column + controls, with what the secret resolves to in the active environment.
  const authTypes: { key: Exclude<AuthType, 'inherit'>; label: string; hint: string }[] = [
    { key: 'bearer', label: 'http.auth.bearer', hint: 'http.auth.bearer.hint' },
    { key: 'basic', label: 'http.auth.basic', hint: 'http.auth.basic.hint' },
    { key: 'apiKey', label: 'http.auth.apikey', hint: 'http.auth.apikey.hint' },
    { key: 'oauth2', label: 'http.auth.oauth2', hint: 'http.auth.oauth2.hint' },
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
      ] as AuthType[]
    ).map((key) => ({ key, label: typeLabel(key), icon: typeIcons[key] })),
  );
  const current = $derived(authTypes.find((a) => a.key === auth.type) ?? authTypes[4]);
  // OAuth: with a token the settings fold into a summary on the Type row (OA4/OA5).
  let oauthConfigOpen = $state(false);
  let oauthFolded = $state(false);
  const oauthLine = $derived.by(() => {
    if (auth.type !== 'oauth2') return '';
    void environments.activeId;
    const scope = currentVarScope();
    return oauthSummary(auth.oauth, (s) => resolveVars(s, scope));
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
  const shown = $derived(reveal ?? /^\s*\{\{[^{}]+\}\}\s*$/.test(secret));

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
    write({ ...auth, [field]: value });
  }
  function setApiKeyLocation(value: ApiKeyLocation): void {
    write({ ...auth, type: 'apiKey', apiKeyIn: value });
  }
</script>

{#snippet field(label: string, key: AuthStringField, secretInput = false)}
  <div class="row">
    <span class="lbl">{label}</span>
    <label class="bs-auth-input" class:var={isVar(auth[key])}>
      {#if isVar(auth[key])}<span class="material-symbols-outlined" aria-hidden="true">key</span>{/if}
      <input
        type={secretInput && !shown ? 'password' : 'text'}
        readonly={inheriting}
        autocomplete="off"
        spellcheck="false"
        aria-label={label}
        value={auth[key] ?? ''}
        oninput={(e) => setAuthField(key, e.currentTarget.value)}
      />
    </label>
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

<div class="bs-pwrap bs-auth-wrap">
  {#if inheriting}
    <div class="bs-auth-inherit">
      <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
      <span class="msg">{t('http.auth.inherited_msg', { name: parent?.name ?? '' })}</span>
      <button type="button" onclick={() => write({ ...auth })}>{t('http.auth.override')}</button>
    </div>
  {/if}
  <div class="bs-auth-card">
    <div class="row">
      <span class="lbl">{t('http.auth.type')}</span>
      <AuthTypeMenu options={typeOptions} value={selectValue} label={typeLabel(selectValue)} onSelect={setAuthType} />
      {#if auth.type === 'oauth2' && (oauthFolded || inheriting)}
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
    {#if auth.type === 'bearer'}
      {@render field(t('http.auth.token'), 'bearerToken', true)}
    {:else if auth.type === 'basic'}
      {@render field(t('http.auth.username'), 'basicUsername')}
      {@render field(t('http.auth.password'), 'basicPassword', true)}
    {:else if auth.type === 'apiKey'}
      <div class="row">
        <span class="lbl">{t('http.auth.add_to')}</span>
        <span class="bs-auth-seg" role="radiogroup" aria-label={t('http.auth.loc_aria')}>
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
        </span>
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
  </div>
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
</div>
