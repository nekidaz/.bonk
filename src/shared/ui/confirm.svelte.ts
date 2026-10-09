import { t } from '$shared/i18n';

export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  altLabel?: string;
  resolve: (ok: boolean | 'alt') => void;
}

/** One-shot confirm dialog (`confirmState.current`); `null` when no dialog is open. `altLabel` adds a third button that resolves `'alt'`. */
class ConfirmState {
  current = $state.raw<ConfirmRequest | null>(null);
}
export const confirmState = new ConfirmState();

/** Show an in-app confirm modal (the Tauri webview has no window.confirm). */
export function requestConfirm(message: string, confirmLabel = t('app.confirm.ok')): Promise<boolean> {
  return requestChoice(message, confirmLabel).then((r) => r === true);
}

/** Three-way confirm: `true` = confirm, `'alt'` = the secondary action (e.g. «Не сохранять»), `false` = cancel. */
export function requestChoice(message: string, confirmLabel: string, altLabel?: string): Promise<boolean | 'alt'> {
  // Resolve any still-open confirm as cancelled so its awaiter never hangs.
  confirmState.current?.resolve(false);
  return new Promise((resolve) => (confirmState.current = { message, confirmLabel, altLabel, resolve }));
}
