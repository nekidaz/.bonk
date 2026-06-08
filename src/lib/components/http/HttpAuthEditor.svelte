<script lang="ts">
  import { authFor } from '../../domain/httpHeaders';
  import { updateActiveTab } from '../../stores';
  import type { ApiKeyLocation, AuthConfig, AuthType, Tab } from '../../domain/types';

  let { tab }: { tab: Tab } = $props();

  const authTypes: { key: AuthType; label: string }[] = [
    { key: 'none', label: 'No Auth' },
    { key: 'bearer', label: 'Bearer Token' },
    { key: 'basic', label: 'Basic Auth' },
    { key: 'apiKey', label: 'API Key' },
  ];
  const apiKeyLocations: { key: ApiKeyLocation; label: string }[] = [
    { key: 'header', label: 'Header' },
    { key: 'query', label: 'Query Params' },
  ];

  function setAuthType(type: AuthType): void {
    updateActiveTab((t) => ({ ...t, request: { ...t.request, auth: { ...authFor(t), type, apiKeyIn: authFor(t).apiKeyIn ?? 'header' } } }));
  }

  function setAuthField(field: keyof AuthConfig, value: string): void {
    updateActiveTab((t) => ({ ...t, request: { ...t.request, auth: { ...authFor(t), [field]: value } as AuthConfig } }));
  }

  function setApiKeyLocation(value: ApiKeyLocation): void {
    updateActiveTab((t) => ({ ...t, request: { ...t.request, auth: { ...authFor(t), type: 'apiKey', apiKeyIn: value } } }));
  }
</script>

<div class="bs-pwrap bs-auth-wrap">
  <div class="bs-auth-layout">
    <div class="bs-auth-types" role="radiogroup" aria-label="Authorization type">
      {#each authTypes as item (item.key)}
        <button
          class:on={authFor(tab).type === item.key}
          type="button"
          role="radio"
          aria-checked={authFor(tab).type === item.key}
          onclick={() => setAuthType(item.key)}
        >
          {item.label}
        </button>
      {/each}
    </div>
    <div class="bs-auth-panel">
      {#if authFor(tab).type === 'none'}
        <div class="bs-auth-empty">
          <span class="material-symbols-outlined" style="font-size:32px">lock_open</span>
          <div>No authorization configured.</div>
        </div>
      {:else if authFor(tab).type === 'bearer'}
        <div class="bs-auth-form">
          <label>
            <span>Token</span>
            <input type="password" autocomplete="off" value={authFor(tab).bearerToken ?? ''} oninput={(e) => setAuthField('bearerToken', e.currentTarget.value)} />
          </label>
        </div>
      {:else if authFor(tab).type === 'basic'}
        <div class="bs-auth-form two">
          <label>
            <span>Username</span>
            <input autocomplete="off" value={authFor(tab).basicUsername ?? ''} oninput={(e) => setAuthField('basicUsername', e.currentTarget.value)} />
          </label>
          <label>
            <span>Password</span>
            <input type="password" autocomplete="off" value={authFor(tab).basicPassword ?? ''} oninput={(e) => setAuthField('basicPassword', e.currentTarget.value)} />
          </label>
        </div>
      {:else}
        <div class="bs-auth-form api">
          <div class="bs-auth-inline" role="radiogroup" aria-label="API key location">
            {#each apiKeyLocations as item (item.key)}
              <button
                class:on={(authFor(tab).apiKeyIn ?? 'header') === item.key}
                type="button"
                role="radio"
                aria-checked={(authFor(tab).apiKeyIn ?? 'header') === item.key}
                onclick={() => setApiKeyLocation(item.key)}
              >
                {item.label}
              </button>
            {/each}
          </div>
          <label>
            <span>Key</span>
            <input autocomplete="off" value={authFor(tab).apiKeyName ?? ''} oninput={(e) => setAuthField('apiKeyName', e.currentTarget.value)} />
          </label>
          <label>
            <span>Value</span>
            <input type="password" autocomplete="off" value={authFor(tab).apiKeyValue ?? ''} oninput={(e) => setAuthField('apiKeyValue', e.currentTarget.value)} />
          </label>
        </div>
      {/if}
    </div>
  </div>
</div>
