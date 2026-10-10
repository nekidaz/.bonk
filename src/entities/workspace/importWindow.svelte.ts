import type { ImportFile } from '$shared/ipc';

/** What the import window opens with: nothing (pick a source), a dropped file, or a collection to update. */
export interface ImportWindowRequest {
  file?: ImportFile;
  /** Folder id of a collection made by import: «Обновить из спецификации» (IM8). */
  update?: string;
}

/**
 * Whether the import window (IM1–IM9, features/import) is open and with what. Any slice may open it —
 * menus, ⌘K, Settings, a file dropped on the window; only features/import shows it.
 */
class ImportWindow {
  /** null = closed. A fresh object per open, so reopening with the same file still resets the window. */
  current = $state.raw<ImportWindowRequest | null>(null);

  open = (request: ImportWindowRequest = {}): void => {
    this.current = { ...request };
  };

  close = (): void => {
    this.current = null;
  };
}
export const importWindow = new ImportWindow();
