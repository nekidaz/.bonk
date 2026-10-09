import { get } from 'svelte/store';
import { persisted } from '$shared/persist';
import { pruneByAge } from './history';
import { history } from './store';

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

// Prune on every history change and when the setting changes, but only once the
// saved setting has loaded (else the 30-day default would eat a "forever" history).
void historyDays.ready.then(() => {
  const prune = () => {
    const h = get(history);
    const kept = pruneByAge(h, get(historyDays));
    if (kept !== h) history.set(kept);
  };
  history.subscribe(prune);
  historyDays.subscribe(prune);
});
