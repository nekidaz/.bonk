import { persisted } from '$shared/persist';
import { pruneByAge } from './history';
import { history } from './store.svelte';

/** Export: include keychain secret values. Off by default. */
export const exportIncludeSecrets = persisted<boolean>('exportIncludeSecrets', false);
/** Workspace export format: Bonk JSON or Postman Collection v2.1. */
export type ExportFormat = 'bonk' | 'postman';
export const exportFormat = persisted<ExportFormat>(
  'exportFormat',
  'bonk',
  (v): v is ExportFormat => v === 'bonk' || v === 'postman',
);
/** History retention in days; 0 = forever. */
export const historyDays = persisted<number>('historyDays', 30);

/**
 * Drop entries older than `historyDays`: on every history change and when the setting changes, but
 * only once the saved setting has loaded (else the 30-day default would eat a "forever" history).
 * Started once by startApp() (app/lifecycle); returns a stop function.
 */
export function watchHistoryRetention(): () => void {
  return $effect.root(() => {
    $effect(() => {
      if (!historyDays.loaded) return;
      const kept = pruneByAge(history.list, historyDays.current);
      if (kept !== history.list) history.list = kept;
    });
  });
}
