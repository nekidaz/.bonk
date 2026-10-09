<script lang="ts">
  import { get } from 'svelte/store';
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

  let query = $state('');
  let recording = $state<string | null>(null);

  const conflicts = $derived(findConflicts($hotkeys));
  const label = (id: string) => {
    const c = HOTKEY_COMMANDS.find((c) => c.id === id);
    return c ? $t(c.label) : id;
  };
  const groups = $derived(
    HOTKEY_GROUPS.map((g) => ({
      group: g,
      rows: HOTKEY_COMMANDS.filter((c) => c.group === g && matchesQuery($t(c.label), $hotkeys[c.id])),
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
    if (await requestConfirm(get(t)('settings.hotkeys.resetAll.confirm'), get(t)('settings.hotkeys.resetAll.ok')))
      resetAllBindings();
  }
</script>

<div class="st-hk-bar">
  <input class="st-text" placeholder={$t('settings.hotkeys.search')} bind:value={query} />
  <button type="button" class="bs-btn ghost" onclick={() => void resetAll()}>{$t('settings.hotkeys.resetAll')}</button>
</div>
{#each groups as g (g.group)}
  <div class="st-group">{$t(g.group).toUpperCase()}</div>
  <div class="st-card">
    {#each g.rows as c (c.id)}
      {@const other = conflicts[c.id]}
      <div class="st-row">
        <span class="st-copy">
          <span class="st-name">{$t(c.label)}</span>
          {#if other}<span class="st-err st-hk-hint"
              >{$t('settings.hotkeys.conflict')}: {other.map(label).join(', ')}</span
            >{/if}
        </span>
        <span class="st-hk-end">
          {#if c.id in $hotkeyOverrides}
            <button
              type="button"
              class="st-hk-reset"
              title={$t('settings.hotkeys.default')}
              aria-label={$t('settings.hotkeys.default')}
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
              <span class="st-rec">{$t('settings.hotkeys.press')}</span>
            {:else}
              {#each formatBinding($hotkeys[c.id]) as k, i (i)}<kbd>{k}</kbd>{:else}<span class="st-rec"
                  >{$t('settings.hotkeys.unset')}</span
                >{/each}
            {/if}
          </button>
        </span>
      </div>
    {/each}
  </div>
{:else}
  <p class="st-note">{$t('settings.hotkeys.none')}</p>
{/each}
