<script lang="ts">
  /** U1/U2: toolbar pill once an update is downloaded; opens the "what's new" popover. */
  import { t } from '$shared/i18n';
  import {
    updateStatus,
    updateVersion,
    updateCurrent,
    updateNotes,
    installUpdate,
    openReleaseNotes,
  } from '$shared/updater';

  const KIND_ICON: Record<string, string> = {
    added: 'auto_awesome',
    changed: 'tune',
    fixed: 'build',
    security: 'shield',
    removed: 'remove_circle',
  };
  const MAX_ITEMS = 4;

  let open = $state(false);
  const busy = $derived($updateStatus === 'installing');
</script>

<svelte:window
  onpointerdown={() => (open = false)}
  onkeydown={(e) => {
    if (e.key === 'Escape') open = false;
  }}
/>

{#if $updateStatus === 'ready' || busy}
  <div class="upd" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    <button class="pill" type="button" aria-haspopup="dialog" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="material-symbols-outlined" aria-hidden="true">arrow_circle_up</span>
      <span class="label">{$t('update.pill')}</span>
      <span class="ver">{$updateVersion}</span>
    </button>
    {#if open}
      <div class="pop" role="dialog" aria-label={$t('update.ready')}>
        <div class="head">
          <span class="eyebrow">{$t('update.ready')}</span>
          <div class="title-row">
            <span class="title">Bonk {$updateVersion}</span>{#if $updateCurrent}<span class="cur"
                >{$t('update.current', { v: $updateCurrent })}</span
              >{/if}
          </div>
        </div>
        {#if $updateNotes.length}
          <ul class="notes">
            {#each $updateNotes.slice(0, MAX_ITEMS) as n, i (i)}
              <li>
                <span class="mark"
                  ><span class="material-symbols-outlined" aria-hidden="true"
                    >{KIND_ICON[n.kind] ?? 'auto_awesome'}</span
                  ></span
                >
                <span class="copy"
                  ><span class="n-title">{n.title}</span>{#if n.desc}<span class="n-desc">{n.desc}</span>{/if}</span
                >
              </li>
            {/each}
          </ul>
        {/if}
        <button class="link" type="button" onclick={openReleaseNotes}
          >{$t('update.allChanges')}<span class="material-symbols-outlined" aria-hidden="true">arrow_outward</span
          ></button
        >
        <div class="divider"></div>
        <p class="note">{$t('update.restoreNote')}</p>
        <div class="actions">
          <button class="btn quiet" type="button" onclick={() => (open = false)}>{$t('update.later')}</button>
          <button class="btn primary" type="button" disabled={busy} onclick={installUpdate}>
            <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>{busy
              ? $t('update.restarting')
              : $t('update.restart')}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .upd {
    position: relative;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: 999px;
    background: var(--success-soft);
    color: var(--green);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .pill .material-symbols-outlined {
    font-size: 16px;
  }
  .ver {
    font-family: var(--font-code);
    font-size: 11px;
    font-weight: 400;
    opacity: 0.7;
  }
  .pop {
    position: absolute;
    z-index: 110;
    top: calc(100% + 8px);
    right: 0;
    width: 340px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 20px;
    background: var(--color-raised);
    outline: 1px solid var(--color-border);
    outline-offset: -1px;
    box-shadow: 0 16px 40px #00000080;
    color: var(--text);
    cursor: default;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .eyebrow {
    font-family: var(--font-code);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--green);
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .title {
    font-size: 17px;
    font-weight: 600;
  }
  .cur {
    font-family: var(--font-code);
    font-size: 11px;
    color: var(--t3);
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .notes li {
    display: flex;
    gap: 10px;
  }
  .mark {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: var(--hover);
    color: var(--t2);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mark .material-symbols-outlined {
    font-size: 15px;
  }
  .copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .n-title {
    font-size: 12px;
    font-weight: 500;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .n-desc {
    font-size: 11px;
    color: var(--t3);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .link {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--t2);
    cursor: pointer;
  }
  .link:hover {
    color: var(--text);
  }
  .link .material-symbols-outlined {
    font-size: 12px;
  }
  .divider {
    height: 1px;
    background: var(--border2);
  }
  .note {
    margin: 0;
    font-size: 11px;
    color: var(--t3);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn.quiet {
    color: var(--t2);
  }
  .btn.quiet:hover {
    background: var(--hover);
  }
  .btn.primary {
    padding-left: 12px;
    background: var(--primary);
    color: var(--primary-text);
  }
  .btn.primary:hover {
    background: var(--primary-hover);
  }
  .btn.primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .btn .material-symbols-outlined {
    font-size: 16px;
  }
</style>
