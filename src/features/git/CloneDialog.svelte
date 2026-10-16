<script lang="ts">
  /**
   * Clone a repository by URL into a new folder (named after the repo) under a chosen parent, then
   * open it as the workspace. Opened from the workspace menu (`git.cloneOpen`).
   */
  import { untrack } from 'svelte';
  import { switchWorkspace, workspace } from '$entities/workspace';
  import { git } from '$entities/git';
  import { gitClone, workspacePickFolder } from '$shared/ipc';
  import { t } from '$shared/i18n';
  import { Overlay } from '$shared/ui/components';
  import { GitButton, GitError } from '$entities/git/components';

  let url = $state('');
  let parent = $state('');
  let busy = $state(false);
  let error = $state('');
  let input = $state<HTMLInputElement>();

  const open = $derived(git.cloneOpen);
  // The folder it lands in, as git will name it.
  const name = $derived(
    url
      .trim()
      .replace(/\/+$/, '')
      .split(/[/:]/)
      .at(-1)
      ?.replace(/\.git$/, '') ?? '',
  );

  $effect(() => {
    if (!open) return;
    untrack(() => {
      url = '';
      error = '';
      // Next to the current workspace by default.
      parent = workspace.path ? workspace.path.replace(/[\\/][^\\/]+[\\/]?$/, '') : '';
      requestAnimationFrame(() => input?.focus());
    });
  });

  const close = () => {
    if (!busy) git.cloneOpen = false;
  };

  async function pick(): Promise<void> {
    const p = await workspacePickFolder().catch(() => null);
    if (p) parent = p;
  }

  async function clone(): Promise<void> {
    if (!url.trim() || !parent || busy) return;
    busy = true;
    error = '';
    try {
      const path = await gitClone(url.trim(), parent);
      git.cloneOpen = false;
      await switchWorkspace(path);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void clone();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <Overlay role="dialog" aria-modal="true" aria-labelledby="bs-clone-title">
    <div class="bs-clone">
      <h2 id="bs-clone-title">{t('git.clone.title')}</h2>
      <p>{t('git.clone.body')}</p>
      <label class="fld">
        <span>URL</span>
        <input
          bind:this={input}
          bind:value={url}
          disabled={busy}
          placeholder="git@github.com:team/api-collections.git"
          aria-label="URL"
        />
      </label>
      <div class="fld">
        <span>{t('git.clone.where')}</span>
        <div class="where">
          <code title={parent}>{parent ? `${parent}/${name || '…'}` : t('git.clone.pick')}</code>
          <GitButton disabled={busy} onclick={pick}
            ><span class="material-symbols-outlined">folder_open</span>{t('git.clone.choose')}</GitButton
          >
        </div>
      </div>
      {#if error}<GitError>{error}</GitError>{/if}
      <div class="foot">
        <GitButton disabled={busy} onclick={close}>{t('common.cancel')}</GitButton>
        <GitButton class="inv" disabled={busy || !url.trim() || !parent} onclick={clone}
          ><span class="material-symbols-outlined" class:spin={busy}>{busy ? 'sync' : 'download'}</span>{busy
            ? t('git.clone.busy')
            : t('git.clone.go')}</GitButton
        >
      </div>
    </div>
  </Overlay>
{/if}

<style>
  .bs-clone {
    width: min(560px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 28px 24px 20px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-dialog);
    background: var(--color-raised);
    box-shadow: 0 24px 64px var(--color-shadow);
  }
  h2 {
    margin: 0;
    color: var(--color-text);
    font: 600 20px var(--font-ui);
  }
  p {
    margin: 0 0 4px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui);
    line-height: 1.5;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fld > span {
    color: var(--color-text-muted);
    font: 500 var(--font-size-micro) var(--font-code);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }
  input {
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-control);
    outline: none;
    background: var(--color-field);
    color: var(--color-text);
    font: var(--font-size-body) var(--font-code);
  }
  input:focus {
    border-color: var(--color-border);
  }
  .where {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    font: var(--font-size-body) var(--font-code);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
  .spin {
    animation: bs-clone-spin 1s linear infinite;
  }
  @keyframes bs-clone-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
