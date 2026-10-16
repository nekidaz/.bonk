<script lang="ts">
  import { t } from '$shared/i18n';
  import {
    hotkeys,
    hotkeyOverrides,
    setBinding,
    resetBinding,
    resetAllBindings,
    HOTKEY_COMMANDS,
    HOTKEY_GROUPS,
    eventToBinding,
    findConflicts,
    formatBinding,
  } from '$shared/settings';
  import { requestConfirm } from '$shared/ui';
  import { Button } from '$shared/ui/components';
  import TextField from './TextField.svelte';
  import Row from './Row.svelte';

  let query = $state('');
  let recording = $state<string | null>(null);

  const conflicts = $derived(findConflicts(hotkeys.current));
  const label = (id: string) => {
    const c = HOTKEY_COMMANDS.find((c) => c.id === id);
    return c ? t(c.label) : id;
  };
  const groups = $derived(
    HOTKEY_GROUPS.map((g) => ({
      group: g,
      rows: HOTKEY_COMMANDS.filter((c) => c.group === g && matchesQuery(t(c.label), hotkeys.current[c.id])),
    })).filter((g) => g.rows.length),
  );

  function matchesQuery(name: string, binding: string): boolean {
    const q = query.trim().toLowerCase();
    return (
      !q ||
      name.toLowerCase().includes(q) ||
      formatBinding(binding).join('').toLowerCase().includes(q) ||
      formatBinding(binding).join('+').toLowerCase().includes(q)
    );
  }

  // While recording, capture on window (capture phase) and stop the event so neither the
  // global shortcuts nor the sheet's Escape-to-close ever see it.
  $effect(() => {
    const id = recording;
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') recording = null;
      else if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setBinding(id, '');
        recording = null;
      } else {
        const b = eventToBinding(e);
        if (b) {
          setBinding(id, b);
          recording = null;
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  async function resetAll(): Promise<void> {
    if (await requestConfirm(t('settings.hotkeys.resetAll.confirm'), t('settings.hotkeys.resetAll.ok')))
      resetAllBindings();
  }
</script>

<div class="st-hk-bar">
  <TextField placeholder={t('settings.hotkeys.search')} bind:value={query} />
  <Button variant="ghost" onclick={() => void resetAll()}>{t('settings.hotkeys.resetAll')}</Button>
</div>
{#each groups as g (g.group)}
  <div class="st-group">{t(g.group).toUpperCase()}</div>
  <div class="st-card">
    {#each g.rows as c (c.id)}
      {@const other = conflicts[c.id]}
      <Row>
        <span class="st-copy">
          <span class="st-name">{t(c.label)}</span>
          {#if other}<span class="st-err st-hk-hint"
              >{t('settings.hotkeys.conflict')}: {other.map(label).join(', ')}</span
            >{/if}
        </span>
        <span class="st-hk-end">
          {#if c.id in hotkeyOverrides.current}
            <button
              type="button"
              class="st-hk-reset"
              title={t('settings.hotkeys.default')}
              aria-label={t('settings.hotkeys.default')}
              onclick={() => resetBinding(c.id)}>↺</button
            >
          {/if}
          <button
            type="button"
            class="st-keys"
            class:recording={recording === c.id}
            class:conflict={!!other}
            onclick={() => (recording = recording === c.id ? null : c.id)}
          >
            {#if recording === c.id}
              <span class="st-rec">{t('settings.hotkeys.press')}</span>
            {:else}
              {#each formatBinding(hotkeys.current[c.id]) as k, i (i)}<kbd>{k}</kbd>{:else}<span class="st-rec"
                  >{t('settings.hotkeys.unset')}</span
                >{/each}
            {/if}
          </button>
        </span>
      </Row>
    {/each}
  </div>
{:else}
  <p class="st-note">{t('settings.hotkeys.none')}</p>
{/each}

<style>
  /* Хоткеи (S32.6): search + reset-all bar, clickable key-cap buttons, conflict highlight */
  .st-hk-bar {
    flex: none;
    display: flex;
    gap: 8px;
  }

  .st-hk-bar :global(.st-text) {
    flex: 1;
  }

  .st-hk-end {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }

  .st-hk-hint {
    padding: 0;
  }

  .st-hk-reset {
    border: 0;
    background: none;
    padding: 2px 4px;
    border-radius: 4px;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: var(--font-size-ui);
  }

  .st-hk-reset:hover {
    color: var(--color-text);
    background: var(--color-hover);
  }

  .st-keys {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 26px;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    cursor: pointer;
  }

  .st-keys:hover {
    background: var(--color-hover);
  }

  :global(.st-sheet) .st-keys :global(kbd) {
    min-width: 22px;
    padding: 2px 6px;
    text-align: center;
    box-sizing: border-box;
    border: 1px solid var(--color-border-subtle);
    border-radius: 5px;
    background: var(--color-panel);
    font: var(--font-size-body)/16px var(--font-code);
    color: var(--color-text-secondary);
  }

  :global(.st-sheet) .st-keys.conflict :global(kbd) {
    border-color: var(--red);
    color: var(--red);
  }

  .st-keys.recording {
    border-color: var(--color-text-muted);
    background: var(--color-panel);
  }

  .st-rec {
    padding: 0 6px;
    font: var(--font-size-caption) var(--font-ui);
    color: var(--color-text-muted);
  }
</style>
