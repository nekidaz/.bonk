/** Open request dialogs; each is `null` when closed. */
class Dialogs {
  /** Save-to dialog (folder + name) for the active tab; `copy` = “Save As…”. */
  save = $state.raw<{ copy: boolean; resolve: (saved: boolean) => void } | null>(null);
  /** Production send guard: the request awaiting a typed confirmation. */
  productionGuard = $state.raw<(ProductionSend & { resolve: (ok: boolean) => void }) | null>(null);
}
export const dialogs = new Dialogs();

/** Open the save-to dialog; resolves `true` once the request is written, `false` on cancel. */
export function requestSaveDialog(copy = false): Promise<boolean> {
  dialogs.save?.resolve(false);
  return new Promise((resolve) => (dialogs.save = { copy, resolve }));
}

export interface ProductionSend {
  method: string;
  url: string;
  envName: string;
  host: string;
}

export function requestProductionSend(info: ProductionSend): Promise<boolean> {
  dialogs.productionGuard?.resolve(false);
  return new Promise((resolve) => (dialogs.productionGuard = { ...info, resolve }));
}
