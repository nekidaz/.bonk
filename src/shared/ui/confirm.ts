import { writable, get } from 'svelte/store';
import { t } from '$shared/i18n';

/** One-shot confirm dialog state; `null` when no dialog is open. `altLabel` adds a third button that resolves `'alt'`. */
export const confirmState = writable<{
  message: string;
  confirmLabel: string;
  altLabel?: string;
  resolve: (ok: boolean | 'alt') => void;
} | null>(null);

/** Show an in-app confirm modal (the Tauri webview has no window.confirm). */
export function requestConfirm(message: string, confirmLabel = get(t)('app.confirm.ok')): Promise<boolean> {
  return requestChoice(message, confirmLabel).then((r) => r === true);
}

/** Three-way confirm: `true` = confirm, `'alt'` = the secondary action (e.g. «Не сохранять»), `false` = cancel. */
export function requestChoice(message: string, confirmLabel: string, altLabel?: string): Promise<boolean | 'alt'> {
  // Resolve any still-open confirm as cancelled so its awaiter never hangs.
  get(confirmState)?.resolve(false);
  return new Promise((resolve) => confirmState.set({ message, confirmLabel, altLabel, resolve }));
}
