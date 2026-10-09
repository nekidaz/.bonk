import type { RequestProtocol } from '$shared/model';

export interface AppConsoleEntry {
  id: string;
  at: number;
  protocol: RequestProtocol;
  method: string;
  url: string;
  ok: boolean;
  status: string;
  elapsedMs: number;
  message?: string;
  logs?: string[];
}

const MAX_CONSOLE_ENTRIES = 500;

/** Runtime-only request console (`appConsole.entries`). It is intentionally separate from History. */
class AppConsole {
  entries = $state.raw<AppConsoleEntry[]>([]);
}
export const appConsole = new AppConsole();

export function addAppConsoleEntry(
  entry: Omit<AppConsoleEntry, 'id' | 'at'> & Partial<Pick<AppConsoleEntry, 'id' | 'at'>>,
): void {
  const next: AppConsoleEntry = {
    ...entry,
    message: entry.message?.slice(0, 8_000),
    logs: entry.logs?.slice(-100).map((line) => line.slice(0, 4_000)),
    id: entry.id ?? crypto.randomUUID(),
    at: entry.at ?? Date.now(),
  };
  appConsole.entries = [...appConsole.entries, next].slice(-MAX_CONSOLE_ENTRIES);
}

export function clearAppConsole(): void {
  appConsole.entries = [];
}
