<script lang="ts">
  import { t } from '$shared/i18n';
  import { oauthStatus, openUrl } from '$shared/ipc';
  import {
    decodeJwt,
    oauthGrant,
    oauthScopes,
    resolveVars,
    urlHost,
    type AuthConfig,
    type OAuthConfig,
    type OAuthGrant,
    type OAuthTokenInfo,
  } from '$shared/model';
  import { currentVarScope, environments, envToneOf } from '$entities/environment';
  import {
    cancelOAuthLogin,
    forgetOAuthToken,
    getOAuthToken,
    oauthCardKey,
    oauthRuntime,
    pasteOAuthCode,
    refreshOAuthToken,
    revokeOAuthToken,
  } from './oauth.svelte';
  import { oauthClock, oauthExpired, oauthLeft, oauthShortToken, oauthSpan } from './oauthFormat';
  import { currentRequestSettings } from './store';
  import OAuthTokensDialog from './OAuthTokensDialog.svelte';
  import { Button, Switch } from '$shared/ui/components';
  import AuthPanel from './AuthPanel.svelte';
  import AuthCard from './AuthCard.svelte';
  import StatusCard from './StatusCard.svelte';
  import AuthInput from './AuthInput.svelte';
  import AuthSeg from './AuthSeg.svelte';

  // Flow · OAuth 2.0 (OA2–OA7): the token card, its details, and the settings under the Type row.
  let {
    auth,
    onChange,
    tabId,
    where,
    configOpen = $bindable(false),
    folded = $bindable(false),
  }: {
    auth: AuthConfig;
    onChange: (a: AuthConfig) => void;
    /** The request tab, for the «renewed before sending» banner (OA7). */
    tabId?: string;
    /** Where this auth is set (collection / request name), for “All tokens”. */
    where: string;
    configOpen?: boolean;
    /** Settings fold into the Type row (any state but «no token»). */
    folded?: boolean;
  } = $props();

  const oauth = $derived<OAuthConfig>(auth.oauth ?? {});
  const grant = $derived(oauthGrant(oauth));
  const scope = $derived.by(() => {
    void environments.globals;
    void environments.list;
    void environments.activeId;
    return currentVarScope();
  });
  const resolve = (s: string | undefined): string => resolveVars(s ?? '', scope);
  const key = $derived(oauthCardKey(auth, environments.activeId));
  const activeEnv = $derived(environments.active);

  let token = $state.raw<OAuthTokenInfo | null>(null);
  $effect(() => {
    void oauthRuntime.version;
    const a = $state.snapshot(auth) as AuthConfig;
    const s = scope;
    let live = true;
    oauthStatus(a, s)
      .then((info) => live && (token = info))
      .catch(() => live && (token = null));
    return () => {
      live = false;
    };
  });

  let now = $state(Date.now() / 1000);
  $effect(() => {
    const id = setInterval(() => (now = Date.now() / 1000), 15_000);
    return () => clearInterval(id);
  });

  const login = $derived(oauthRuntime.login?.key === key ? oauthRuntime.login : null);
  const failure = $derived(oauthRuntime.failure?.key === key ? oauthRuntime.failure.error : null);
  const renewal = $derived.by(() => {
    const r = tabId ? oauthRuntime.renewals[tabId] : undefined;
    return r?.key === key ? r : undefined;
  });
  const expired = $derived(!!token && oauthExpired(token, now));
  const status = $derived(
    login ? 'wait' : failure ? 'error' : !token ? 'none' : expired ? 'expired' : renewal ? 'renewed' : 'valid',
  );
  const showConfig = $derived(status === 'none' || configOpen);
  $effect(() => {
    folded = status !== 'none';
  });
  const renews = $derived(oauth.autoRefresh !== false && (!!token?.hasRefresh || grant !== 'authorization_code'));
  const claims = $derived(token ? decodeJwt(token.accessToken) : null);
  const claimRows = $derived(
    claims
      ? Object.entries(claims).map(([k, v]) => [
          k,
          (k === 'exp' || k === 'iat' || k === 'nbf') && typeof v === 'number'
            ? new Date(v * 1000).toLocaleTimeString()
            : typeof v === 'string'
              ? v
              : JSON.stringify(v),
        ])
      : [],
  );

  let busy = $state(false);
  let pasteOpen = $state(false);
  let pasted = $state('');
  let revealToken = $state(false);
  let moreOpen = $state(false);
  let tokensOpen = $state(false);
  let scopeDraft = $state('');

  const settings = () => currentRequestSettings();
  const snap = () => $state.snapshot(auth) as AuthConfig;
  async function act(run: () => Promise<void>): Promise<void> {
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  }
  const get = () => act(() => getOAuthToken(snap(), scope, key, settings()));
  const refresh = () => act(() => refreshOAuthToken(snap(), scope, key, settings()));
  const forget = () => act(() => forgetOAuthToken(snap(), scope));
  const revoke = () => act(() => revokeOAuthToken(snap(), scope, key, settings()));

  function set(patch: Partial<OAuthConfig>): void {
    onChange({ ...auth, oauth: { ...oauth, ...patch } });
  }
  function addScope(raw: string): void {
    const add = raw.split(/\s+/).filter((s) => s && !oauthScopes(oauth).includes(s));
    if (add.length) set({ scope: [...oauthScopes(oauth), ...add].join(' ') });
    scopeDraft = '';
  }
  function removeScope(s: string): void {
    set({
      scope: oauthScopes(oauth)
        .filter((x) => x !== s)
        .join(' '),
    });
  }
  function submitPaste(): void {
    pasteOAuthCode(pasted);
    pasted = '';
  }

  const isVar = (v: string | undefined) => /^\s*\{\{[^{}]+\}\}\s*$/.test(v ?? '');
  const mask = (v: string) =>
    v.length <= 16 ? '•'.repeat(v.length) : `${v.slice(0, 32)}${'•'.repeat(12)}${v.slice(-5)}`;
  const copy = (text: string) => void navigator.clipboard.writeText(text);

  const grants: OAuthGrant[] = ['authorization_code', 'client_credentials', 'password'];
  type Field =
    'authUrl' | 'tokenUrl' | 'revokeUrl' | 'clientId' | 'clientSecret' | 'audience' | 'username' | 'password';

  // OA6: what to do about the provider's answer.
  const fix = $derived.by(() => {
    if (failure?.kind !== 'provider') return null;
    const text = `${failure.error} ${failure.description}`.toLowerCase();
    if (text.includes('redirect')) return 'redirect';
    if (failure.error === 'invalid_client' || failure.error === 'unauthorized_client') return 'client';
    if (failure.error === 'invalid_scope') return 'scope';
    if (failure.error === 'invalid_grant') return 'grant';
    return null;
  });
  const redirectShown = $derived(oauthRuntime.failure?.redirectUri || oauth.redirectUri || t('oauth.redirect_auto'));
</script>

{#snippet field(label: string, name: Field, opts: { secret?: boolean; placeholder?: string; hint?: string } = {})}
  <div class="row">
    <span class="lbl">{label}</span>
    <AuthInput class={{ var: isVar(oauth[name]) }}>
      {#if isVar(oauth[name])}<span class="material-symbols-outlined" aria-hidden="true">key</span>{/if}
      <input
        type={opts.secret && !isVar(oauth[name]) ? 'password' : 'text'}
        autocomplete="off"
        spellcheck="false"
        aria-label={label}
        placeholder={opts.placeholder ?? ''}
        value={oauth[name] ?? ''}
        oninput={(e) => set({ [name]: e.currentTarget.value })}
      />
    </AuthInput>
    {#if opts.hint}<span class="hint side">{opts.hint}</span>{/if}
  </div>
{/snippet}

{#snippet env()}
  {#if activeEnv}
    <span class="env tone-{envToneOf(activeEnv)}"
      >{#if envToneOf(activeEnv) === 'production'}<span class="material-symbols-outlined" aria-hidden="true">lock</span
        >{/if}{activeEnv.name}</span
    >
  {/if}
{/snippet}

<AuthPanel>
  <!-- The token card: what bonk has for this auth in the active environment. -->
  {#if status === 'wait' && login}
    <StatusCard class="tone-accent">
      <span class="ic spin material-symbols-outlined" aria-hidden="true">progress_activity</span>
      <div class="txt">
        <div class="ttl">{t('oauth.wait.title')} {@render env()}</div>
        <div class="sub">
          {login.listens ? t('oauth.wait.sub', { host: urlHost(login.url) }) : t('oauth.wait.sub_paste')}
        </div>
      </div>
      <div class="acts">
        <Button variant="ghost" onclick={cancelOAuthLogin}>{t('oauth.cancel')}</Button>
        <Button variant="ghost" onclick={() => void openUrl(login.url)}
          ><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>{t('oauth.reopen')}</Button
        >
      </div>
    </StatusCard>
    <div class="bs-oa-box">
      <div class="head">{t('oauth.fallback.title')}</div>
      <div class="url">
        <span class="mono">{login.url}</span>
        <button class="icon" type="button" aria-label={t('oauth.copy')} onclick={() => copy(login.url)}
          ><span class="material-symbols-outlined">content_copy</span></button
        >
      </div>
      {#if pasteOpen || !login.listens}
        <form
          class="paste"
          onsubmit={(e) => {
            e.preventDefault();
            submitPaste();
          }}
        >
          <AuthInput>
            <input
              type="text"
              autocomplete="off"
              spellcheck="false"
              aria-label={t('oauth.paste')}
              placeholder={t('oauth.paste_ph')}
              bind:value={pasted}
            />
          </AuthInput>
          <Button variant="primary" type="submit" disabled={!pasted.trim()}>{t('oauth.paste_go')}</Button>
        </form>
      {:else}
        <button class="link" type="button" onclick={() => (pasteOpen = true)}
          ><span class="material-symbols-outlined" aria-hidden="true">keyboard</span>{t('oauth.paste')}</button
        >
      {/if}
    </div>
  {:else if status === 'error' && failure}
    <StatusCard class="tone-danger">
      <span class="ic material-symbols-outlined" aria-hidden="true">error</span>
      <div class="txt">
        <div class="ttl">
          {failure.kind === 'provider'
            ? t('oauth.err.title')
            : failure.kind === 'login'
              ? t('oauth.login.title')
              : t('oauth.other.title')}
          {#if failure.kind === 'provider' && failure.error}<span class="code">{failure.error}</span>{/if}
        </div>
        <div class="sub">
          {failure.kind === 'provider'
            ? failure.description || failure.error || `HTTP ${failure.status}`
            : failure.kind === 'login'
              ? failure.reason
              : failure.message}
        </div>
      </div>
      <div class="acts">
        <Button variant="ghost" disabled={busy} onclick={get}
          ><span class="material-symbols-outlined" aria-hidden="true">refresh</span>{t('oauth.err.retry')}</Button
        >
      </div>
    </StatusCard>
    {#if fix}
      <div class="bs-oa-box">
        <div class="head">{t('oauth.err.fix')}</div>
        <ol class="steps">
          {#if fix === 'redirect'}
            <li>{t('oauth.err.redirect.1', { client: resolve(oauth.clientId) || 'client' })}</li>
            <li>
              {t('oauth.err.redirect.2')}
              <code>{redirectShown}</code>
              <button class="icon" type="button" aria-label={t('oauth.copy')} onclick={() => copy(redirectShown)}
                ><span class="material-symbols-outlined">content_copy</span></button
              >
            </li>
            <li>{t('oauth.err.redirect.3')}</li>
          {:else}
            <li>{t(`oauth.err.${fix}`)}</li>
          {/if}
        </ol>
      </div>
    {/if}
    {#if failure.kind === 'provider' && failure.status}
      <div class="bs-oa-box">
        <div class="head">
          {t('oauth.err.response')}
          <span class="code">{failure.status}</span>
          <span class="mono dim">POST {failure.url}</span>
        </div>
        <pre class="body">{failure.body}</pre>
      </div>
    {/if}
  {:else if status === 'none'}
    <StatusCard>
      <span class="ic material-symbols-outlined" aria-hidden="true">key</span>
      <div class="txt">
        <div class="ttl">{t('oauth.none.title')} {@render env()}</div>
        <div class="sub">{t('oauth.none.sub')}</div>
      </div>
      <div class="acts">
        <Button variant="primary" disabled={busy} onclick={get}
          ><span class="material-symbols-outlined" aria-hidden="true">login</span>{t('oauth.get')}</Button
        >
      </div>
    </StatusCard>
  {:else if token}
    <StatusCard class={{ 'tone-success': status !== 'expired', 'tone-warning': status === 'expired' }}>
      <span class="ic material-symbols-outlined" aria-hidden="true"
        >{status === 'expired' ? 'schedule' : status === 'renewed' ? 'autorenew' : 'check_circle'}</span
      >
      <div class="txt">
        <div class="ttl">
          {status === 'expired'
            ? t('oauth.expired.title')
            : status === 'renewed'
              ? t('oauth.renewed.title')
              : t('oauth.valid.title')}
          <span class="badge">{oauthLeft(token, now)}</span>
          {@render env()}
        </div>
        <div class="sub">
          {#if status === 'expired'}
            {renews ? t('oauth.expired.sub_auto') : t('oauth.expired.sub_manual')}
          {:else if status === 'renewed' && renewal}
            {t(renewal.byRefresh ? 'oauth.renewed.sub_refresh' : 'oauth.renewed.sub_new', {
              time: renewal.previousExpiresAt ? oauthClock(renewal.previousExpiresAt) : '—',
            })}
          {:else}
            {t('oauth.valid.sub')} · {renews ? t('oauth.valid.auto') : t('oauth.valid.no_refresh')}
          {/if}
        </div>
      </div>
      <div class="acts">
        {#if oauth.revokeUrl?.trim()}
          <Button variant="ghost" disabled={busy} onclick={revoke}>{t('oauth.revoke')}</Button>
        {/if}
        <Button variant="ghost" disabled={busy} onclick={forget}
          ><span class="material-symbols-outlined" aria-hidden="true">delete</span>{t('oauth.delete')}</Button
        >
        <Button variant="ghost" disabled={busy} onclick={status === 'expired' && !renews ? get : refresh}
          ><span class="material-symbols-outlined" aria-hidden="true">refresh</span>{status === 'expired' && !renews
            ? t('oauth.get')
            : t('oauth.refresh')}</Button
        >
      </div>
    </StatusCard>
    {#if status === 'renewed' && renewal}
      <div class="bs-oa-box timeline">
        {#if renewal.previousExpiresAt}
          <div class="ev">
            <span class="at">{new Date(renewal.at).toLocaleTimeString()}</span>
            <span class="what">{t('oauth.renewed.expired_line')}</span>
            <span class="meta">exp {oauthClock(renewal.previousExpiresAt)}</span>
          </div>
        {/if}
        <div class="ev">
          <span class="at">{new Date(renewal.at).toLocaleTimeString()}</span>
          <span class="what"
            >POST {renewal.tokenUrl}
            <span class="dim">grant_type={renewal.byRefresh ? 'refresh_token' : grant}</span></span
          >
          <span class="meta ok">200</span>
        </div>
        {#if renewal.sent}
          <div class="ev">
            <span class="at">{new Date(renewal.at).toLocaleTimeString()}</span>
            <span class="what">{renewal.sent.text}</span>
            <span class="meta" class:ok={renewal.sent.status < 400}>{renewal.sent.status} · {renewal.sent.ms} ms</span>
          </div>
        {/if}
      </div>
    {/if}
    {#if !showConfig}
      <AuthCard class="details">
        <div class="row">
          <span class="lbl">{t('oauth.d.access')}</span>
          <span class="secret grow">{revealToken ? token.accessToken : mask(token.accessToken)}</span>
          <button
            class="eye"
            type="button"
            aria-label={revealToken ? t('http.auth.hide') : t('http.auth.show')}
            aria-pressed={revealToken}
            onclick={() => (revealToken = !revealToken)}
            ><span class="material-symbols-outlined">{revealToken ? 'visibility' : 'visibility_off'}</span></button
          >
          <button class="eye" type="button" aria-label={t('oauth.copy')} onclick={() => copy(token!.accessToken)}
            ><span class="material-symbols-outlined">content_copy</span></button
          >
        </div>
        <div class="row">
          <span class="lbl">{t('oauth.d.expires')}</span>
          <span class="secret">
            {#if token.expiresAt !== null}
              {oauthClock(token.expiresAt)} · {expired
                ? oauthLeft(token, now)
                : t('oauth.d.in', { n: oauthSpan(token.expiresAt - now) })}
            {:else}
              {t('oauth.no_expiry')}
            {/if}
            <span class="dim">· {t('oauth.d.obtained', { time: oauthClock(token.obtainedAt) })}</span>
          </span>
        </div>
        <div class="row">
          <span class="lbl">{t('oauth.d.refresh')}</span>
          <span class="secret">{token.hasRefresh ? t('oauth.d.has') : t('oauth.d.hasnt')}</span>
          <span class="hint grow">{t('oauth.d.auto')}</span>
          <Switch
            aria-label={t('oauth.d.auto')}
            checked={oauth.autoRefresh !== false}
            onclick={() => set({ autoRefresh: oauth.autoRefresh === false })}
          />
        </div>
        {#if token.scope}
          <div class="row">
            <span class="lbl">{t('oauth.scope')}</span>
            <span class="chips"
              >{#each token.scope.split(/\s+/).filter(Boolean) as s (s)}<span class="chip">{s}</span>{/each}</span
            >
          </div>
        {/if}
        {#if claimRows.length}
          <div class="row top">
            <span class="lbl">{t('oauth.d.jwt')}</span>
            <dl class="claims">
              {#each claimRows as [k, v] (k)}<dt>{k}</dt>
                <dd>{v}</dd>{/each}
            </dl>
          </div>
        {/if}
        <div class="row foot">
          <button class="link" type="button" onclick={() => (tokensOpen = true)}
            ><span class="material-symbols-outlined" aria-hidden="true">key</span>{t('oauth.all')}</button
          >
        </div>
      </AuthCard>
    {/if}
  {/if}

  <!-- Settings: open while there is no token, else behind “Settings” on the Type row. -->
  {#if showConfig}
    <AuthCard class="config">
      <div class="row">
        <span class="lbl">{t('oauth.grant')}</span>
        <AuthSeg role="radiogroup" aria-label={t('oauth.grant_aria')}>
          {#each grants as g (g)}
            <button
              type="button"
              role="radio"
              class:on={grant === g}
              aria-checked={grant === g}
              onclick={() => set({ grant: g })}>{t(`oauth.grant.${g}`)}</button
            >
          {/each}
        </AuthSeg>
        <span class="hint">{t(`oauth.grant.hint.${grant}`)}</span>
      </div>
      {#if grant === 'authorization_code'}
        {@render field(t('oauth.auth_url'), 'authUrl', { placeholder: 'https://…/oauth/authorize' })}
      {/if}
      {@render field(t('oauth.token_url'), 'tokenUrl', { placeholder: 'https://…/oauth/token' })}
      {@render field(t('oauth.client_id'), 'clientId')}
      {@render field(t('oauth.client_secret'), 'clientSecret', {
        secret: true,
        placeholder: grant === 'authorization_code' && oauth.pkce !== false ? t('oauth.secret_pkce') : '',
        hint: grant === 'authorization_code' ? undefined : t('oauth.secret_hint'),
      })}
      {#if grant === 'password'}
        {@render field(t('http.auth.username'), 'username')}
        {@render field(t('http.auth.password'), 'password', { secret: true })}
      {/if}
      <div class="row">
        <span class="lbl">{t('oauth.scope')}</span>
        <span class="chips">
          {#each oauthScopes(oauth) as s (s)}
            <span class="chip"
              >{s}<button type="button" aria-label={t('oauth.scope_remove', { name: s })} onclick={() => removeScope(s)}
                ><span class="material-symbols-outlined">close</span></button
              ></span
            >
          {/each}
          <input
            class="chip-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            aria-label={t('oauth.scope')}
            placeholder={t('oauth.scope_add')}
            bind:value={scopeDraft}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                addScope(scopeDraft);
              }
            }}
            onblur={() => addScope(scopeDraft)}
          />
        </span>
      </div>
      {#if grant === 'authorization_code'}
        <div class="row">
          <span class="lbl">{t('oauth.redirect')}</span>
          <AuthInput>
            <input
              type="text"
              autocomplete="off"
              spellcheck="false"
              aria-label={t('oauth.redirect')}
              placeholder={t('oauth.redirect_auto')}
              value={oauth.redirectUri ?? ''}
              oninput={(e) => set({ redirectUri: e.currentTarget.value })}
            />
          </AuthInput>
          <span class="hint side">{t('oauth.redirect_hint')}</span>
        </div>
        <div class="row">
          <span class="lbl">{t('oauth.pkce')}</span>
          <Switch
            aria-label={t('oauth.pkce')}
            checked={oauth.pkce !== false}
            onclick={() => set({ pkce: oauth.pkce === false })}
          />
          <span class="secret">S256</span>
          <span class="grow"></span>
          <button class="link" type="button" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}
            >{t('oauth.more')}<span class="material-symbols-outlined" aria-hidden="true"
              >{moreOpen ? 'expand_less' : 'expand_more'}</span
            ></button
          >
        </div>
      {:else}
        <div class="row">
          <span class="lbl">{t('oauth.credentials')}</span>
          <AuthSeg role="radiogroup" aria-label={t('oauth.cred_aria')}>
            {#each ['basic', 'body'] as c (c)}
              <button
                type="button"
                role="radio"
                class:on={(oauth.clientAuth || 'basic') === c}
                aria-checked={(oauth.clientAuth || 'basic') === c}
                onclick={() => set({ clientAuth: c as 'basic' | 'body' })}>{t(`oauth.cred.${c}`)}</button
              >
            {/each}
          </AuthSeg>
        </div>
        <div class="row">
          <span class="lbl">{t('oauth.auto')}</span>
          <Switch
            aria-label={t('oauth.auto_hint')}
            checked={oauth.autoRefresh !== false}
            onclick={() => set({ autoRefresh: oauth.autoRefresh === false })}
          />
          <span class="hint">{t('oauth.auto_hint')}</span>
          <span class="grow"></span>
          <button class="link" type="button" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}
            >{t('oauth.more')}<span class="material-symbols-outlined" aria-hidden="true"
              >{moreOpen ? 'expand_less' : 'expand_more'}</span
            ></button
          >
        </div>
      {/if}
      {#if moreOpen}
        {@render field(t('oauth.audience'), 'audience')}
        {@render field(t('oauth.revoke_url'), 'revokeUrl', { placeholder: 'https://…/oauth/revoke' })}
      {/if}
    </AuthCard>
  {/if}
</AuthPanel>

{#if tokensOpen}
  <OAuthTokensDialog {auth} {where} onClose={() => (tokensOpen = false)} />
{/if}

<style>
  :global(.bs) .bs-oa-box :global(.ev) {
    display: flex;
    align-items: baseline;
    gap: 14px;
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-oa-box :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  :global(.bs) .bs-oa-box :global(.dim) {
    color: var(--color-text-muted);
  }

  :global(.bs .bs-oa) .chip-input {
    flex: 1;
    min-width: 90px;
    height: 24px;
    padding: 0 4px;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs .bs-oa) .chip-input:focus {
    flex: 1;
    min-width: 90px;
    height: 24px;
    padding: 0 4px;
    border: 0;
    outline: none;
    box-shadow: none;
    background: transparent;
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs .bs-oa) .claims {
    flex: 1;
    display: grid;
    grid-template-columns: max-content 1fr max-content 1fr;
    gap: 6px 16px;
    margin: 0;
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs .bs-oa) .claims :global(dt) {
    color: var(--color-text-muted);
  }

  :global(.bs .bs-oa) .claims :global(dd) {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
  }

  :global(.bs) .bs-oa-box :global(.head .code) {
    padding: 1px 6px;
    border-radius: var(--radius-control);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    font: 500 var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-oa-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    outline: 1px solid var(--color-border-subtle);
    outline-offset: -1px;
    border-radius: var(--radius-card);
    background: var(--color-field);
  }

  :global(.bs) .bs-oa-box :global(.head) {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text);
    font: 600 var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-oa-box :global(.mono) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-oa-box :global(.url) {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 6px 0 12px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text-secondary);
  }

  :global(.bs) .bs-oa-box :global(.url .mono) {
    flex: 1;
  }

  :global(.bs) .bs-oa-box :global(.paste) {
    display: flex;
    gap: 8px;
  }

  :global(.bs) .bs-oa-box :global(.steps) {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding-left: 20px;
    list-style: decimal outside;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  :global(.bs) .bs-oa-box :global(.steps code) {
    padding: 2px 6px;
    border-radius: var(--radius-control);
    background: var(--color-panel);
    font: var(--font-size-caption) var(--font-code);
  }

  :global(.bs) .bs-oa-box :global(.steps .icon) {
    display: inline-grid;
    vertical-align: middle;
  }

  :global(.bs) .bs-oa-box :global(.body) {
    max-height: 160px;
    margin: 0;
    overflow: auto;
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-code);
    white-space: pre-wrap;
    word-break: break-all;
  }

  :global(.bs) .bs-oa-box.timeline {
    gap: 6px;
    padding: 10px 16px;
  }

  :global(.bs) .bs-oa-box :global(.ev .at) {
    flex: none;
    color: var(--color-text-muted);
  }

  :global(.bs) .bs-oa-box :global(.ev .what) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
  }

  :global(.bs) .bs-oa-box :global(.ev .meta) {
    flex: none;
    color: var(--color-warning);
  }

  :global(.bs) .bs-oa-box :global(.ev .meta.ok) {
    color: var(--color-success);
  }
</style>
