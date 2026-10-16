<script lang="ts">
  /** G10: «Stash changes» — a message and the three `git stash push` options. Anchored at `git.stashMenu`. */
  import { untrack } from 'svelte';
  import { git, stashPush } from '$entities/git';
  import { t } from '$shared/i18n';
  import { GitButton, GitLayer } from '$entities/git/components';

  let message = $state('');
  let includeUntracked = $state(true);
  let stagedOnly = $state(false);
  let keepIndex = $state(false);
  let input = $state<HTMLInputElement>();

  const at = $derived(git.stashMenu);
  const count = $derived(git.status?.files.length ?? 0);

  $effect(() => {
    if (!at) return;
    untrack(() => {
      message = '';
      requestAnimationFrame(() => input?.focus());
    });
  });

  const close = () => (git.stashMenu = null);

  async function stash(): Promise<void> {
    close();
    await stashPush(message, { includeUntracked, stagedOnly, keepIndex });
  }
</script>

{#if at}
  <GitLayer role="presentation" onpointerdown={close}></GitLayer>
  <div class="bs-stashmenu" role="dialog" aria-label={t('git.stash.title')} style:left="{at.x}px" style:top="{at.y}px">
    <div class="eb">{`${t('git.stash.title')}  ·  ${t('git.stash.count', { n: count })}`}</div>
    <input
      bind:this={input}
      class="msg"
      bind:value={message}
      placeholder={t('git.stash.placeholder')}
      aria-label={t('git.stash.placeholder')}
      onkeydown={(e) => {
        if (e.key === 'Enter') void stash();
        else if (e.key === 'Escape') close();
      }}
    />
    <label
      ><input type="checkbox" bind:checked={includeUntracked} /><span
        ><b>{t('git.stash.untracked')}</b><i>{t('git.stash.untrackedHint')}</i></span
      ></label
    >
    <label
      ><input type="checkbox" bind:checked={stagedOnly} /><span
        ><b>{t('git.stash.stagedOnly')}</b><i>{t('git.stash.stagedOnlyHint')}</i></span
      ></label
    >
    <label
      ><input type="checkbox" bind:checked={keepIndex} /><span
        ><b>{t('git.stash.keep')}</b><i>{t('git.stash.keepHint')}</i></span
      ></label
    >
    <div class="btns">
      <GitButton onclick={close}>{t('common.cancel')}</GitButton>
      <GitButton class="inv" onclick={stash}><span class="material-symbols-outlined">inventory_2</span>Stash</GitButton>
    </div>
  </div>
{/if}

<style>
  .bs-stashmenu {
    position: fixed;
    z-index: 60;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: 0 18px 48px var(--color-shadow);
  }
  .eb {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  .msg {
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    outline: none;
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-ui) var(--font-ui);
  }
  .msg:focus {
    border-color: var(--color-text-muted);
  }
  label {
    display: flex;
    gap: 10px;
    cursor: pointer;
  }
  label input {
    margin: 2px 0 0;
    accent-color: var(--color-text);
  }
  label span {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  b {
    color: var(--color-text);
    font: 500 var(--font-size-body) var(--font-ui);
  }
  i {
    color: var(--color-text-muted);
    font: normal var(--font-size-caption) var(--font-ui);
  }
  .btns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 4px;
  }
  :global(:root .btns .bs-gbtn) {
    height: 34px;
  }
</style>
