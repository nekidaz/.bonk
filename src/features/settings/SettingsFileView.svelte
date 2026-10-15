<script lang="ts">
  /**
   * The settings.json tab (issue #2): ~/.bonk/settings.json in the code editor, with key completion
   * (Ctrl+Space) and warnings for unknown keys and ignored values. ⌘S saves and applies; while
   * there are no unsaved edits it shows the file as it is now (a change from the Settings window
   * or another editor appears here).
   */
  import { linter } from '@codemirror/lint';
  import { t } from '$shared/i18n';
  import { CodeEditor } from '$shared/editor/components';
  import { settingsFileOpenExternal } from '$shared/ipc';
  import { settingSpecs, settingsFile } from '$shared/persist';
  import { formatBinding, hotkeys } from '$shared/settings';
  import { settingsDraft, saveSettingsDraft } from './settingsFileTab.svelte';
  import { settingsCompletions, settingsProblems } from './settingsJson';

  const specs = settingSpecs().sort((a, b) => a.key.localeCompare(b.key));
  const text = $derived(settingsDraft.text ?? settingsFile.text);
  const dirty = $derived(settingsDraft.text !== null && settingsDraft.text !== settingsFile.text);
  const saveKeys = $derived(formatBinding(hotkeys.current.save ?? '').join(''));
  let saveError = $state('');

  const syntaxError = $derived.by(() => {
    if (!text.trim()) return '';
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? '' : t('settingsFile.notObject');
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  const problems = $derived(settingsProblems(text, specs).length);

  const extensions = linter(
    (v) =>
      settingsProblems(v.state.doc.toString(), specs).map((p) => ({
        from: p.from,
        to: p.to,
        severity: 'warning' as const,
        message: t(p.kind === 'unknown' ? 'settingsFile.unknown' : 'settingsFile.invalid', { key: p.key }),
      })),
    { delay: 400 },
  );

  async function save(): Promise<void> {
    try {
      await saveSettingsDraft();
      saveError = '';
    } catch (e) {
      saveError = String(e);
    }
  }

  function openExternal(): void {
    settingsFileOpenExternal().catch((e) => (saveError = String(e)));
  }
</script>

<div class="sf">
  <div class="head">
    <span class="material-symbols-outlined" aria-hidden="true">settings</span>
    <span class="path">~/.bonk/settings.json</span>
    {#if dirty}<span class="dot" title={t('settingsFile.unsavedEdits')}></span>{/if}
    <span class="grow"></span>
    {#if dirty}
      <button class="act" type="button" onclick={() => (settingsDraft.text = null)}>{t('settingsFile.revert')}</button>
    {/if}
    <button class="act" type="button" disabled={!dirty} onclick={save}
      ><span class="material-symbols-outlined" aria-hidden="true">save</span>{t('common.save')}
      <kbd>{saveKeys}</kbd></button
    >
    <button class="act" type="button" onclick={openExternal}
      ><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>{t('settingsFile.external')}</button
    >
  </div>
  <div class="ed">
    <CodeEditor
      value={text}
      onChange={(v) => (settingsDraft.text = v)}
      lang="json"
      docId="settings.json"
      fill
      bare
      lintJson
      folding={false}
      ariaLabel="settings.json"
      completionSource={(ctx) => settingsCompletions(specs, ctx)}
      completionFooter={t('settingsFile.completionHint')}
      {extensions}
    />
  </div>
  <div class="bar">
    {#if saveError || syntaxError || (!dirty && settingsFile.error)}
      <span class="material-symbols-outlined state err" aria-hidden="true">error</span>
      <span class="msg err" role="alert">{saveError || syntaxError || settingsFile.error}</span>
    {:else}
      <span class="material-symbols-outlined state ok" aria-hidden="true">check_circle</span>
      <span class="msg"
        >{dirty ? t('settingsFile.validUnsaved', { keys: saveKeys }) : t('settingsFile.applied')}{problems
          ? `  ·  ${t('settingsFile.problems', { n: problems })}`
          : ''}</span
      >
    {/if}
  </div>
</div>

<style>
  .sf {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-field);
  }
  .head,
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 14px;
    color: var(--color-text-secondary);
    font: var(--font-size-caption) var(--font-ui);
  }
  .head {
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .head > .material-symbols-outlined {
    font-size: 16px;
  }
  .path {
    color: var(--color-text);
    font: var(--font-size-caption) var(--font-code);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-warning);
  }
  .grow {
    flex: 1;
  }
  .ed {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 0 0;
  }
  .bar {
    border-top: 1px solid var(--color-border-subtle);
  }
  .state {
    flex: none;
    font-size: 16px;
  }
  .state.ok {
    color: var(--color-success);
  }
  .state.err,
  .msg.err {
    color: var(--color-danger);
  }
  .msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .act {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--color-text-secondary);
    font: 500 var(--font-size-caption) var(--font-ui);
  }
  .act:hover:not(:disabled) {
    background: var(--color-hover);
    color: var(--color-text);
  }
  .act:disabled {
    color: var(--color-text-muted);
    opacity: 0.6;
  }
  .act .material-symbols-outlined {
    font-size: 16px;
  }
  .act kbd {
    color: var(--color-text-muted);
    font: var(--font-size-micro) var(--font-ui);
  }
</style>
