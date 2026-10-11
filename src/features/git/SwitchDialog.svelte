<script lang="ts">
  /**
   * G11: switching branches with uncommitted changes. Stash and switch (optionally popping the
   * stash on the way back), take the changes along, or discard them. Opened by `requestCheckout`.
   */
  import { GitBranchIcon } from '$shared/ui/components';
  import { untrack } from 'svelte';
  import { findNode, workspace } from '$entities/workspace';
  import { describeFile, git, switchBranch, type SwitchChoice } from '$entities/git';
  import { t } from '$shared/i18n';

  let choice = $state<SwitchChoice>('stash');
  let autoRestore = $state(true);

  const to = $derived(git.pendingSwitch);
  const from = $derived(git.status?.branch || 'HEAD');
  const target = $derived(to ? (to.remote ? to.name.split('/').slice(1).join('/') : to.name) : '');
  const names = $derived(
    (git.status?.files ?? []).map((f) => describeFile(f.path, git.prefix, (id) => findNode(workspace.tree, id)).name),
  );

  $effect(() => {
    if (!to) return;
    untrack(() => {
      choice = 'stash';
      autoRestore = true;
    });
  });

  const cancel = () => (git.pendingSwitch = null);

  function onKey(e: KeyboardEvent): void {
    if (to && e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if to}
  <div class="bs-overlay" role="dialog" aria-modal="true" aria-labelledby="bs-switch-title">
    <div class="bs-branchswitch">
      <div class="crumb">{`${from}  →  ${target}`}</div>
      <h2 id="bs-switch-title">{t('git.switch.title')}</h2>
      <p>{t('git.switch.body', { n: names.length, names: names.slice(0, 5).join(', ') })}</p>

      <label class="opt" class:on={choice === 'stash'}>
        <input type="radio" bind:group={choice} value="stash" />
        <span class="body">
          <span class="h"
            ><span class="material-symbols-outlined">inventory_2</span>{t('git.switch.stash')}<span class="rec"
              >{t('git.switch.recommended')}</span
            ></span
          >
          <span class="d"
            >{t('git.switch.stashHint', { name: autoRestore ? `auto: ${from}` : `${from} → ${target}` })}</span
          >
          {#if choice === 'stash'}
            <label class="chk"
              ><input type="checkbox" bind:checked={autoRestore} />{t('git.switch.autoRestore', {
                branch: from,
              })}</label
            >
          {/if}
        </span>
      </label>
      <label class="opt" class:on={choice === 'carry'}>
        <input type="radio" bind:group={choice} value="carry" />
        <span class="body">
          <span class="h"><span class="material-symbols-outlined">sync_alt</span>{t('git.switch.carry')}</span>
          <span class="d">{t('git.switch.carryHint', { branch: target })}</span>
        </span>
      </label>
      <label class="opt danger" class:on={choice === 'discard'}>
        <input type="radio" bind:group={choice} value="discard" />
        <span class="body">
          <span class="h"><span class="material-symbols-outlined">delete</span>{t('git.switch.discard')}</span>
          <span class="d">{t('git.switch.discardHint')}</span>
        </span>
      </label>

      <div class="foot">
        <button class="bs-gbtn" onclick={cancel}>{t('common.cancel')}</button>
        <button class="bs-gbtn inv" onclick={() => switchBranch(to, choice, autoRestore)}
          ><GitBranchIcon size={15} />{t('git.switch.go', { branch: target })}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .bs-branchswitch {
    width: min(560px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 28px 24px 20px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: 0 24px 64px var(--color-shadow);
  }
  .crumb {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    white-space: pre;
  }
  h2 {
    margin: 0;
    color: var(--color-text);
    font: 600 20px var(--font-ui);
  }
  p {
    margin: 0 0 6px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui);
    line-height: 1.5;
  }
  .opt {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    cursor: pointer;
  }
  .opt.on {
    border-color: var(--color-text-secondary);
  }
  .opt > input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 1px 0 0;
    accent-color: var(--color-text);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .h {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text);
    font: 600 var(--font-size-label) var(--font-ui);
  }
  .h .material-symbols-outlined {
    font-size: 16px;
  }
  .danger .h {
    color: var(--color-danger);
  }
  .rec {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    background: var(--color-success-soft);
    color: var(--color-success);
    font: 500 var(--font-size-caption) var(--font-ui);
  }
  .d {
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    line-height: 1.45;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    color: var(--color-text);
    font-size: var(--font-size-body);
  }
  .chk input {
    accent-color: var(--color-text);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .foot .bs-gbtn {
    height: 38px;
    padding: 0 18px;
  }
</style>
