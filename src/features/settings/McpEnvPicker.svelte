<script lang="ts">
  /** “Environments for AI” summary + popover (S32.8): which environments the AI may send requests to. */
  import { tick } from 'svelte';
  import { t } from '$shared/i18n';
  import {
    environments,
    mcpPrefs,
    type McpPrefs,
    allowedEnvNames,
    isProdLike,
    scopeOf,
    setAllEnvs,
    toggleEnv,
  } from '$entities/environment';
  import { Switch } from '$shared/ui/components';

  let { disabled = false }: { disabled?: boolean } = $props();

  let open = $state(false);
  let query = $state('');
  let chip = $state<HTMLButtonElement | undefined>(undefined);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let pos = $state({ left: 0, top: 0 });

  const scope = $derived(scopeOf(mcpPrefs.current));
  const allowed = $derived(allowedEnvNames(mcpPrefs.current, environments.list));
  // One row per name: the allow-list is name-based.
  const rows = $derived.by(() => {
    const byName = new Map<string, { name: string; prod: boolean }>();
    for (const e of environments.list)
      byName.set(e.name, { name: e.name, prod: (byName.get(e.name)?.prod ?? false) || isProdLike(e) });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const total = $derived(rows.length);
  const q = $derived(query.trim().toLowerCase());
  const shown = $derived(rows.filter((r) => !q || r.name.toLowerCase().includes(q)));
  const label = $derived(
    t(scope === 'all-but-prod' ? 'settings.mcp.envChip.all' : 'settings.mcp.envChip.sel', { n: allowed.size, total }),
  );

  const apply = (p: Partial<McpPrefs>) => (mcpPrefs.current = { ...mcpPrefs.current, ...p });

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
    aria-label={t('settings.mcp.envs.aria')}
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
      aria-label={t('settings.mcp.envs')}
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="me-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          bind:this={input}
          bind:value={query}
          placeholder={t('settings.mcp.env.search')}
          aria-label={t('settings.mcp.env.search')}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="me-total">{total}</span>
      </div>

      <div class="me-scope" role="radiogroup" aria-label={t('settings.mcp.envs')}>
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'all-but-prod'}
          class:on={scope === 'all-but-prod'}
          onclick={() => apply({ envScope: 'all-but-prod' })}>{t('settings.mcp.env.scopeAll')}</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'selected'}
          class:on={scope === 'selected'}
          onclick={() => apply({ envScope: 'selected', environments: [...allowed] })}
          >{t('settings.mcp.env.scopeSel')}</button
        >
      </div>

      <div class="me-eyebrow">
        <span>{t('settings.mcp.env.allowed', { n: allowed.size, total })}</span>
        <span class="me-bulk">
          <button type="button" onclick={() => apply(setAllEnvs(environments.list, true))}
            >{t('settings.mcp.env.all')}</button
          >
          <button type="button" onclick={() => apply(setAllEnvs(environments.list, false))}
            >{t('settings.mcp.env.none')}</button
          >
        </span>
      </div>

      <div class="me-list">
        {#each shown as r (r.name)}
          <label class="me-row">
            <input
              type="checkbox"
              checked={allowed.has(r.name)}
              onchange={() => apply(toggleEnv(mcpPrefs.current, environments.list, r.name))}
            />
            <span class="me-nm" title={r.name}>{r.name}</span>
            {#if r.prod}<span class="me-prod">{t('settings.mcp.env.prod')}</span>{/if}
          </label>
        {:else}
          <div class="me-empty">{t(total ? 'settings.mcp.env.noMatch' : 'settings.mcp.env.empty')}</div>
        {/each}
      </div>

      <div class="me-auto" class:dim={scope === 'all-but-prod'}>
        <span id="me-auto-l">{t('settings.mcp.env.autoNew')}</span>
        <Switch
          aria-labelledby="me-auto-l"
          disabled={scope === 'all-but-prod'}
          checked={!!mcpPrefs.current.autoAllowNew}
          onclick={() => apply({ autoAllowNew: !mcpPrefs.current.autoAllowNew })}
        />
      </div>
      <p class="me-foot">{t('settings.mcp.env.footer')}</p>
    </div>
  {/if}
</div>

<style>
  .me-chip:hover:not(:disabled) {
    background: var(--color-hover);
  }

  /* S32.8 environments-for-AI picker */
  .me-wrap {
    flex: none;
    position: relative;
  }

  .me-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
    cursor: pointer;
  }

  .me-chip:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .me-chip :global(.material-symbols-outlined) {
    font-size: 16px;
    color: var(--color-text-muted);
  }

  .me-pop {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    width: 380px;
    max-width: calc(100vw - 16px);
    max-height: min(440px, calc(100vh - 16px));
    padding: 8px;
    gap: 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: var(--shadow-panel);
  }

  .me-search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    background: var(--color-field);
    color: var(--color-text-muted);
  }

  .me-search :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  .me-search :global(input) {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--color-text);
    font: var(--font-size-body) var(--font-ui);
  }

  .me-total {
    font: var(--font-size-caption) var(--font-code);
  }

  .me-scope {
    flex: none;
    display: flex;
    gap: 6px;
  }

  .me-scope :global(button) {
    flex: 1;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: 999px;
    background: var(--color-field);
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
    cursor: pointer;
  }

  .me-scope :global(button:hover) {
    background: var(--color-hover);
  }

  .me-scope :global(button.on) {
    background: var(--color-selected);
    color: var(--color-text);
    font-weight: 600;
  }

  .me-eyebrow {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro)/13px var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
  }

  .me-bulk {
    display: inline-flex;
    gap: 10px;
  }

  .me-bulk :global(button) {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    letter-spacing: 0;
    cursor: pointer;
  }

  .me-bulk :global(button:hover) {
    color: var(--color-text);
  }

  .me-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }

  .me-row {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    cursor: pointer;
  }

  .me-row:hover {
    background: var(--color-hover);
  }

  .me-nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--font-size-body) var(--font-ui);
  }

  .me-prod {
    flex: none;
    padding: 0 7px;
    height: 18px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--red) 14%, transparent);
    color: var(--red);
    font: 500 10px/18px var(--font-code);
  }

  .me-empty {
    padding: 16px;
    color: var(--color-text-muted);
    font: var(--font-size-body) var(--font-ui);
    text-align: center;
  }

  .me-auto {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 6px 0;
    border-top: 1px solid var(--color-border-subtle);
    font: var(--font-size-body) var(--font-ui);
  }

  .me-auto.dim {
    opacity: 0.45;
  }

  .me-foot {
    flex: none;
    margin: 0;
    padding: 0 6px 4px;
    font: var(--font-size-caption)/15px var(--font-ui);
    color: var(--color-text-muted);
  }
</style>
