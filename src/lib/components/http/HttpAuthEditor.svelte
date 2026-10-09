<script lang="ts">
  import { t } from '../../i18n';
  import { authFolderFor } from '../../domain/authInherit';
  import { resolveVars } from '../../domain/vars';
  import { envToneOf } from '../../domain/palette';
  import {
    activeEnvironmentId,
    currentVarScope,
    collections,
    environments,
    globals,
    updateActiveTab,
  } from '../../stores';
  import type { ApiKeyLocation, AuthConfig, AuthType, Tab } from '../../domain/types';

  // Edits the request's auth (`tab`; gRPC tabs keep it on `tab.grpc`) or, in the folder dialog, a draft `value` (`onChange`).
  let { tab, value, onChange }: { tab?: Tab; value?: AuthConfig; onChange?: (a: AuthConfig) => void } = $props();
  const isGrpc = $derived(tab?.protocol === 'grpc');

  // S11: a label column + controls, with what the secret resolves to in the active environment.
  const authTypes: { key: Exclude<AuthType, 'inherit'>; label: string; hint: string }[] = [
    { key: 'bearer', label: 'http.auth.bearer', hint: 'http.auth.bearer.hint' },
    { key: 'basic', label: 'http.auth.basic', hint: 'http.auth.basic.hint' },
    { key: 'apiKey', label: 'http.auth.apikey', hint: 'http.auth.apikey.hint' },
    { key: 'none', label: 'http.auth.none', hint: 'http.auth.none.hint' },
  ];
  type AuthStringField = 'bearerToken' | 'basicUsername' | 'basicPassword' | 'apiKeyName' | 'apiKeyValue';

  const none: AuthConfig = { type: 'none', apiKeyIn: 'header' };
  const ownAuth = $derived(tab ? (isGrpc ? tab.grpc?.auth : tab.request.auth) : value);
  const parent = $derived(tab ? authFolderFor($collections, tab.savedPath) : undefined);
  const ownType = $derived(ownAuth?.type ?? 'inherit');
  // S11: a request without its own auth shows (read-only) what its collection hands down.
  const inheriting = $derived(!!parent?.auth && ownType === 'inherit');
  const auth = $derived<AuthConfig>(inheriting ? parent!.auth! : ownType === 'inherit' ? none : ownAuth!);
  const selectValue = $derived(ownType === 'inherit' && !inheriting && tab ? 'none' : inheriting ? auth.type : ownType);
  const inheritLabel = $derived(tab ? $t('http.auth.inherit') : $t('http.auth.unset'));
  const current = $derived(authTypes.find((a) => a.key === auth.type) ?? authTypes[3]);
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
  const activeEnv = $derived($environments.find((e) => e.id === $activeEnvironmentId));
  const envName = $derived(activeEnv?.name);
  // Re-read the scope whenever variables change.
  const resolved = $derived.by(() => {
    void $globals;
    void $environments;
    void $activeEnvironmentId;
    return /\{\{/.test(secret) ? resolveVars(secret, currentVarScope()) : '';
  });
  let reveal = $state<boolean | null>(null);
  const shown = $derived(reveal ?? /^\s*\{\{[^{}]+\}\}\s*$/.test(secret));

  const isVar = (v: string | undefined) => /^\s*\{\{[^{}]+\}\}\s*$/.test(v ?? '');
  function mask(v: string): string {
    return v.length <= 12 ? '•'.repeat(v.length) : `${v.slice(0, 8)}${'•'.repeat(12)}${v.slice(-4)}`;
  }

  function write(next: AuthConfig): void {
    if (tab && isGrpc) updateActiveTab((t) => (t.grpc ? { ...t, grpc: { ...t.grpc, auth: next } } : t));
    else if (tab) updateActiveTab((t) => ({ ...t, request: { ...t.request, auth: next } }));
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
        aria-label={shown ? $t('http.auth.hide') : $t('http.auth.show')}
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
      <span class="msg">{$t('http.auth.inherited_msg', { name: parent?.name ?? '' })}</span>
      <button type="button" onclick={() => write({ ...auth })}>{$t('http.auth.override')}</button>
    </div>
  {/if}
  <div class="bs-auth-card">
    <div class="row">
      <span class="lbl">{$t('http.auth.type')}</span>
      <span class="bs-auth-select">
        <select
          aria-label={$t('http.auth.type_aria')}
          value={selectValue}
          onchange={(e) => setAuthType(e.currentTarget.value as AuthType)}
        >
          {#if !tab || (parent && !inheriting)}<option value="inherit">{inheritLabel}</option>{/if}
          {#each authTypes as item (item.key)}<option value={item.key}>{$t(item.label)}</option>{/each}
        </select>
        <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
      </span>
      <span class="hint">{selectValue === 'inherit' ? '' : $t(current.hint)}</span>
    </div>
    {#if auth.type === 'bearer'}
      {@render field($t('http.auth.token'), 'bearerToken', true)}
    {:else if auth.type === 'basic'}
      {@render field($t('http.auth.username'), 'basicUsername')}
      {@render field($t('http.auth.password'), 'basicPassword', true)}
    {:else if auth.type === 'apiKey'}
      <div class="row">
        <span class="lbl">{$t('http.auth.add_to')}</span>
        <span class="bs-auth-seg" role="radiogroup" aria-label={$t('http.auth.loc_aria')}>
          {#each [['header', 'http.auth.loc.header'], ['query', 'http.auth.loc.query']] as [key, label] (key)}
            <button
              type="button"
              role="radio"
              class:on={(auth.apiKeyIn ?? 'header') === key}
              aria-checked={(auth.apiKeyIn ?? 'header') === key}
              disabled={inheriting}
              onclick={() => setApiKeyLocation(key as ApiKeyLocation)}>{$t(label)}</button
            >
          {/each}
        </span>
      </div>
      {@render field($t('http.auth.key'), 'apiKeyName')}
      {@render field($t('http.auth.value'), 'apiKeyValue', true)}
    {/if}
    {#if resolved}
      <div class="row resolves">
        <span class="lbl">{$t('http.auth.resolves')}</span>
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
</div>
