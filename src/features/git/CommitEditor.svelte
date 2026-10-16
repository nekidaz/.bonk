<script lang="ts">
  /**
   * G4b·E: the commit message in a tab, for long messages — monospace, line numbers, a ruler at
   * 72 characters. It edits the same `git.message` as the sidebar box; Esc closes the tab.
   */
  import { commitChanges, git, SUBJECT_MAX } from '$entities/git';
  import { t, tp } from '$shared/i18n';
  import { GitButton, GitHead, GitView, GitViewBody } from '$entities/git/components';

  let { onClose }: { onClose: () => void } = $props();

  let gutter = $state<HTMLElement>();
  let area = $state<HTMLTextAreaElement>();
  $effect(() => area?.focus());
  const lines = $derived(git.message.split('\n'));
  const subject = $derived(lines[0].length);
  const staged = $derived((git.status?.files ?? []).filter((f) => f.index !== ' ' && f.index !== '?').length);
  const canCommit = $derived(git.message.trim() !== '' && (staged > 0 || git.amend));

  async function commit(): Promise<void> {
    if (canCommit && (await commitChanges(git.message, git.amend))) onClose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }
</script>

<GitView>
  <GitHead>
    <div class="ttl"><span class="crumb">{`${t('git.title')}  /  ${t('git.tab.commit')}`}</span></div>
    <span class="meta" class:over={subject > SUBJECT_MAX}
      >{`${t('git.commit.subject')} ${subject} / ${SUBJECT_MAX} · ${lines.length} ${tp(lines.length, ['строка', 'строки', 'строк'], ['line', 'lines'])}`}</span
    >
  </GitHead>
  <GitViewBody>
    <div class="ed">
      <div class="gutter" bind:this={gutter} aria-hidden="true">
        {#each lines as _, i (i)}<div>{i + 1}</div>{/each}
      </div>
      <textarea
        bind:this={area}
        bind:value={git.message}
        wrap="off"
        spellcheck="false"
        aria-label={t('git.commit.placeholder')}
        placeholder={t('git.commit.placeholder')}
        onkeydown={onKey}
        onscroll={(e) => gutter && (gutter.scrollTop = e.currentTarget.scrollTop)}></textarea>
    </div>
    <div class="foot">
      <span>{t('git.commit.escBack')}</span>
      <GitButton class="inv" disabled={!canCommit} onclick={commit}
        ><span class="material-symbols-outlined">check</span>{t('git.commit')}<kbd>⌘↵</kbd></GitButton
      >
    </div>
  </GitViewBody>
</GitView>

<style>
  .meta {
    color: var(--color-text-muted);
    font: var(--font-size-caption) var(--font-code);
    padding-bottom: 4px;
  }
  .meta.over {
    color: var(--color-warning);
  }
  .ed {
    flex: 1;
    min-height: 0;
    display: flex;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-card);
    background: var(--color-field);
    overflow: hidden;
    font: 14px/35px var(--font-code);
  }
  .gutter {
    flex: none;
    width: 52px;
    padding: 12px 12px 12px 0;
    overflow: hidden;
    text-align: right;
    color: var(--color-text-muted);
  }
  textarea {
    flex: 1;
    min-width: 0;
    padding: 12px 16px 12px 8px;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    /* The 72-character ruler: 8px of padding plus 72 monospace columns. */
    background-image: linear-gradient(var(--color-border-subtle), var(--color-border-subtle));
    background-size: 1px 100%;
    background-repeat: no-repeat;
    background-position: calc(8px + 72ch) 0;
    background-attachment: local;
  }
  .foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
  }
</style>
