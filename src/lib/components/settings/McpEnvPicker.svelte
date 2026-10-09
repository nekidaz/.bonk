<script lang="ts">
  /** "Окружения для AI" summary + popover (S32.8): which environments the AI may send requests to. */
  import { tick } from 'svelte';
  import { t } from '../../i18n';
  import { environments } from '../../stores';
  import { mcpPrefs, type McpPrefs } from '../../stores/mcpPrefs';
  import { allowedEnvNames, isProdLike, scopeOf, setAllEnvs, toggleEnv } from '../../domain/mcpEnvs';

  let { disabled = false }: { disabled?: boolean } = $props();

  let open = $state(false);
  let query = $state('');
  let chip = $state<HTMLButtonElement | undefined>(undefined);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let pos = $state({ left: 0, top: 0 });

  const scope = $derived(scopeOf($mcpPrefs));
  const allowed = $derived(allowedEnvNames($mcpPrefs, $environments));
  // One row per name: the allow-list is name-based.
  const rows = $derived.by(() => {
    const byName = new Map<string, { name: string; prod: boolean }>();
    for (const e of $environments)
      byName.set(e.name, { name: e.name, prod: (byName.get(e.name)?.prod ?? false) || isProdLike(e) });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const total = $derived(rows.length);
  const q = $derived(query.trim().toLowerCase());
  const shown = $derived(rows.filter((r) => !q || r.name.toLowerCase().includes(q)));
  const label = $derived(
    $t(scope === 'all-but-prod' ? 'settings.mcp.envChip.all' : 'settings.mcp.envChip.sel', { n: allowed.size, total }),
  );

  const apply = (p: Partial<McpPrefs>) => mcpPrefs.update((v) => ({ ...v, ...p }));

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    query = '';
    const r = chip?.getBoundingClientRect();
    if (r)
      pos = {
        left: Math.max(8, Math.min(window.innerWidth - 388, r.right - 380)),
        top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 440)),
      };
    await tick();
    input?.focus();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // do not close the settings sheet behind the popover
    open = false;
    chip?.focus();
  }
</script>

<svelte:window onpointerdown={() => (open = false)} />

<div class="me-wrap" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
  <button
    bind:this={chip}
    type="button"
    class="me-chip"
    {disabled}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={$t('settings.mcp.envs.aria')}
    onclick={() => void toggle()}
  >
    <span>{label}</span><span class="material-symbols-outlined" aria-hidden="true"
      >{open ? 'expand_less' : 'expand_more'}</span
    >
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="me-pop"
      style="left:{pos.left}px;top:{pos.top}px"
      role="dialog"
      aria-label={$t('settings.mcp.envs')}
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="me-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          bind:this={input}
          bind:value={query}
          placeholder={$t('settings.mcp.env.search')}
          aria-label={$t('settings.mcp.env.search')}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="me-total">{total}</span>
      </div>

      <div class="me-scope" role="radiogroup" aria-label={$t('settings.mcp.envs')}>
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'all-but-prod'}
          class:on={scope === 'all-but-prod'}
          onclick={() => apply({ envScope: 'all-but-prod' })}>{$t('settings.mcp.env.scopeAll')}</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'selected'}
          class:on={scope === 'selected'}
          onclick={() => apply({ envScope: 'selected', environments: [...allowed] })}
          >{$t('settings.mcp.env.scopeSel')}</button
        >
      </div>

      <div class="me-eyebrow">
        <span>{$t('settings.mcp.env.allowed', { n: allowed.size, total })}</span>
        <span class="me-bulk">
          <button type="button" onclick={() => apply(setAllEnvs($environments, true))}
            >{$t('settings.mcp.env.all')}</button
          >
          <button type="button" onclick={() => apply(setAllEnvs($environments, false))}
            >{$t('settings.mcp.env.none')}</button
          >
        </span>
      </div>

      <div class="me-list">
        {#each shown as r (r.name)}
          <label class="me-row">
            <input
              type="checkbox"
              checked={allowed.has(r.name)}
              onchange={() => apply(toggleEnv($mcpPrefs, $environments, r.name))}
            />
            <span class="me-nm" title={r.name}>{r.name}</span>
            {#if r.prod}<span class="me-prod">{$t('settings.mcp.env.prod')}</span>{/if}
          </label>
        {:else}
          <div class="me-empty">{$t(total ? 'settings.mcp.env.noMatch' : 'settings.mcp.env.empty')}</div>
        {/each}
      </div>

      <div class="me-auto" class:dim={scope === 'all-but-prod'}>
        <span id="me-auto-l">{$t('settings.mcp.env.autoNew')}</span>
        <button
          type="button"
          class="mono-switch"
          role="switch"
          aria-labelledby="me-auto-l"
          disabled={scope === 'all-but-prod'}
          aria-checked={!!$mcpPrefs.autoAllowNew}
          onclick={() => apply({ autoAllowNew: !$mcpPrefs.autoAllowNew })}
        ></button>
      </div>
      <p class="me-foot">{$t('settings.mcp.env.footer')}</p>
    </div>
  {/if}
</div>
