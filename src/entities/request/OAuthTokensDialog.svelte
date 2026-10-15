<script lang="ts">
  import { t } from '$shared/i18n';
  import { portal } from '$shared/ui';
  import { oauthStatus } from '$shared/ipc';
  import { mergeScope, type AuthConfig, type Environment, type OAuthTokenInfo } from '$shared/model';
  import { environments, envToneOf } from '$entities/environment';
  import { forgetOAuthToken, getOAuthToken, oauthCardKey, oauthRuntime, revokeOAuthToken } from './oauth.svelte';
  import { oauthExpired, oauthGrantLabel, oauthLeft } from './oauthFormat';
  import { currentRequestSettings } from './store';
  import { Button } from '$shared/ui/components';

  // OA9: this auth's token in every environment. The keychain can't be listed, so each row
  // asks for the token its environment's variables resolve the settings to.
  let { auth, where, onClose }: { auth: AuthConfig; where: string; onClose: () => void } = $props();

  type Row = { env: Environment | undefined; name: string; scope: Record<string, string> };
  const rows = $derived<Row[]>([
    ...environments.list.map((env) => ({ env, name: env.name, scope: mergeScope(environments.globals, env) })),
    ...(environments.list.length
      ? []
      : [{ env: undefined, name: t('oauth.tokens.no_env'), scope: mergeScope(environments.globals, undefined) }]),
  ]);

  let tokens = $state.raw<(OAuthTokenInfo | null)[]>([]);
  $effect(() => {
    void oauthRuntime.version;
    const a = $state.snapshot(auth) as AuthConfig;
    const list = rows;
    let live = true;
    Promise.all(list.map((r) => oauthStatus(a, r.scope).catch(() => null))).then((got) => live && (tokens = got));
    return () => {
      live = false;
    };
  });

  let now = $state(Date.now() / 1000);
  const active = $derived(rows.find((r) => r.env?.id === environments.activeId) ?? rows[0]);
  const snap = () => $state.snapshot(auth) as AuthConfig;
  const keyOf = (r: Row) => oauthCardKey(auth, r.env?.id ?? null);
</script>

<div use:portal class="bs-overlay" role="dialog" aria-modal="true" aria-label={t('oauth.tokens.title')}>
  <div class="bs-modal bs-oa-tokens">
    <div class="bs-modal-h">
      <span class="t">{t('oauth.tokens.title')}</span>
      <button class="x" aria-label={t('common.close')} onclick={onClose}
        ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
      >
    </div>
    <div class="bs-modal-b">
      <p class="lede">{t('oauth.tokens.lede')}</p>
      <div class="table" role="table">
        <div class="tr th" role="row">
          <span role="columnheader">{t('oauth.tokens.env')}</span>
          <span role="columnheader">{t('oauth.tokens.where')}</span>
          <span role="columnheader">{t('oauth.tokens.grant')}</span>
          <span role="columnheader">{t('oauth.tokens.status')}</span>
          <span></span>
        </div>
        {#each rows as row, i (row.env?.id ?? '')}
          {@const token = tokens[i]}
          <div class="tr" role="row">
            <span class="env-name"
              ><span class="dot tone-{row.env ? envToneOf(row.env) : 'none'}"></span>{row.name}</span
            >
            <span class="dim">{where}</span>
            <span class="dim">{oauthGrantLabel(auth.oauth)}</span>
            <span>
              {#if token}
                <span class="pill" class:bad={oauthExpired(token, now)}>{oauthLeft(token, now)}</span>
              {:else}
                <span class="pill none">{t('oauth.tokens.none')}</span>
              {/if}
            </span>
            <span class="acts">
              {#if !token || oauthExpired(token, now)}
                <Button
                  variant="ghost"
                  onclick={() => void getOAuthToken(snap(), row.scope, keyOf(row), currentRequestSettings())}
                  >{t('oauth.get')}</Button
                >
              {/if}
              {#if token}
                <button
                  class="icon"
                  type="button"
                  aria-label={t('oauth.delete')}
                  onclick={() => void forgetOAuthToken(snap(), row.scope)}
                  ><span class="material-symbols-outlined">delete</span></button
                >
              {/if}
            </span>
          </div>
        {/each}
      </div>
      <div class="signout">
        <span class="material-symbols-outlined" aria-hidden="true">logout</span>
        <div class="txt">
          <div class="ttl">{t('oauth.tokens.signout')}</div>
          <div class="sub">
            {auth.oauth?.revokeUrl?.trim() ? t('oauth.tokens.signout_hint') : t('oauth.tokens.no_revoke')}
          </div>
        </div>
        <Button
          variant="ghost-danger"
          disabled={!auth.oauth?.revokeUrl?.trim() || !tokens[rows.indexOf(active)]}
          onclick={() => void revokeOAuthToken(snap(), active.scope, keyOf(active), currentRequestSettings())}
          >{t('oauth.revoke')} · {active.name}</Button
        >
      </div>
    </div>
    <div class="bs-modal-f">
      <span class="note"
        ><span class="material-symbols-outlined" aria-hidden="true">lock</span>{t('oauth.tokens.keychain')}</span
      >
      <div class="grow"></div>
      <Button variant="primary" onclick={onClose}>{t('oauth.done')}</Button>
    </div>
  </div>
</div>
