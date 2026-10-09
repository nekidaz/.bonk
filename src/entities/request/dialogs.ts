import { writable, get } from 'svelte/store';

/** Save-to dialog (folder + name) for the active tab; `copy` = «Сохранить как…». `null` when closed. */
export const saveDialog = writable<{ copy: boolean; resolve: (saved: boolean) => void } | null>(null);

/** Open the save-to dialog; resolves `true` once the request is written, `false` on cancel. */
export function requestSaveDialog(copy = false): Promise<boolean> {
  get(saveDialog)?.resolve(false);
  return new Promise((resolve) => saveDialog.set({ copy, resolve }));
}

/** Production send guard: the request awaiting a typed confirmation; `null` when closed. */
export interface ProductionSend {
  method: string;
  url: string;
  envName: string;
  host: string;
}
export const productionGuard = writable<(ProductionSend & { resolve: (ok: boolean) => void }) | null>(null);

export function requestProductionSend(info: ProductionSend): Promise<boolean> {
  get(productionGuard)?.resolve(false);
  return new Promise((resolve) => productionGuard.set({ ...info, resolve }));
}
