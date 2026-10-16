<script lang="ts">
  import { t } from '$shared/i18n';
  import { oauthStatus } from '$shared/ipc';
  import type { AuthConfig, OAuthTokenInfo, TreeNode } from '$shared/model';
  import { currentVarScope, environments } from '$entities/environment';
  import { oauthRuntime } from './oauth.svelte';
  import { oauthExpired, oauthLeft, oauthShortToken } from './oauthFormat';
  import TokenPill from './TokenPill.svelte';

  // OA8: a request inheriting its collection's OAuth sees the shared token, read-only.
  let { auth, folder }: { auth: AuthConfig; folder: Extract<TreeNode, { kind: 'folder' }> | undefined } = $props();

  let token = $state.raw<OAuthTokenInfo | null>(null);
  $effect(() => {
    void oauthRuntime.version;
    void environments.list;
    void environments.activeId;
    const a = $state.snapshot(auth) as AuthConfig;
    const scope = currentVarScope();
    let live = true;
    oauthStatus(a, scope)
      .then((info) => live && (token = info))
      .catch(() => live && (token = null));
    return () => {
      live = false;
    };
  });

  const count = (nodes: TreeNode[]): number =>
    nodes.reduce((n, node) => n + (node.kind === 'folder' ? count(node.children) : 1), 0);
  const requests = $derived(folder ? count(folder.children) : 0);
  const now = Date.now() / 1000;
</script>

<div class="row">
  <span class="lbl">{t('oauth.inh.token')}</span>
  {#if token}
    <TokenPill class={{ bad: oauthExpired(token, now) }}>{oauthLeft(token, now)}</TokenPill>
  {:else}
    <TokenPill class="none">{t('oauth.tokens.none')}</TokenPill>
  {/if}
  <span class="hint">{t('oauth.inh.shared', { n: requests })}</span>
</div>
{#if token}
  <div class="row">
    <span class="lbl">{t('oauth.inh.header')}</span>
    <span class="secret">Authorization: Bearer {oauthShortToken(token.accessToken)}</span>
  </div>
{/if}
