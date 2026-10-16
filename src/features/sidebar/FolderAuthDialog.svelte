<script lang="ts">
  import { saveFolderAuth, findNode, workspace } from '$entities/workspace';
  import type { AuthConfig } from '$shared/model';
  import { HttpAuthEditor } from '$entities/request/components';
  import { t } from '$shared/i18n';
  import { Button, Overlay, Modal, ModalHeader, ModalBody, ModalFooter } from '$shared/ui/components';

  // Collection-level auth (S11): requests set to "inherit" use it. `folderId` open = shown.
  let {
    folderId = $bindable(),
    onSaved,
    onOpenRunner,
  }: {
    folderId: string | undefined;
    /** Session: a sign-in from the card finished (the app shows a toast). */
    onSaved?: (text: string) => void;
    /** Session: «Открыть в Runner» on the sign-in scenario (the app owns the Runner). */
    onOpenRunner?: (scenario: string) => void;
  } = $props();

  const folder = $derived(folderId ? findNode(workspace.tree, folderId) : undefined);
  let draft = $state<AuthConfig | undefined>(undefined);
  $effect(() => {
    draft = folder?.kind === 'folder' ? folder.auth : undefined;
  });

  function save(): void {
    if (folderId) void saveFolderAuth(folderId, draft && draft.type !== 'inherit' ? draft : null);
    folderId = undefined;
  }
</script>

{#if folder?.kind === 'folder'}
  <Overlay role="dialog" aria-modal="true">
    <Modal class={{ 'bs-session-modal': draft?.type === 'session' }}>
      <ModalHeader>
        <span class="t">{t('dialog.auth.title', { name: folder.name })}</span>
        <button class="x" aria-label={t('common.close')} onclick={() => (folderId = undefined)}
          ><span class="material-symbols-outlined" style="font-size:18px">close</span></button
        >
      </ModalHeader>
      <ModalBody>
        <HttpAuthEditor
          value={draft}
          onChange={(a) => (draft = a)}
          where={folder.name}
          {onSaved}
          onOpenRunner={(name) => {
            folderId = undefined;
            onOpenRunner?.(name);
          }}
        />
      </ModalBody>
      <ModalFooter>
        <div class="grow"></div>
        <Button variant="primary" onclick={save}>{t('common.save')}</Button>
        <Button variant="ghost" onclick={() => (folderId = undefined)}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  </Overlay>
{/if}

<style>
  /* Flow · Сессия (SE2–SE5): the session card, its details and settings, a send's banner and timeline. */
  :global(:root .bs .bs-modal.bs-session-modal) {
    width: 940px;
  }
</style>
