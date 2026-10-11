import type { RequestProtocol, ScriptTestResult } from '$shared/model';
import { environments } from '$entities/environment';

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
  /** Script tests of this send (CT1 line under the row). */
  tests?: Pick<ScriptTestResult, 'name' | 'passed' | 'error'>[];
  /** The request had a pre-request or test script («Со скриптами»). */
  scripted?: boolean;
  /** Request name and saved node id («Открыть запрос», Issues «по запросу»). */
  title?: string;
  nodeId?: string;
  tabId?: string;
  /** Environment name at send time. */
  env?: string;
  /** Sent by the Collection Runner. */
  runner?: boolean;
  /** HTTP only: what went out and what came back (CT2). Bodies are cut to 8 KB. */
  request?: { headers: Record<string, string>; body?: string };
  response?: { headers: Record<string, string>; body: string; sizeBytes: number };
}

const MAX_CONSOLE_ENTRIES = 500;
const MAX_BODY = 8_000;

/** Runtime-only request console (`appConsole.entries`). It is intentionally separate from History. */
class AppConsole {
  entries = $state.raw<AppConsoleEntry[]>([]);
}
export const appConsole = new AppConsole();

export function addAppConsoleEntry(
  entry: Omit<AppConsoleEntry, 'id' | 'at'> & Partial<Pick<AppConsoleEntry, 'id' | 'at'>>,
): void {
  const next: AppConsoleEntry = {
    env: environments.active?.name,
    ...entry,
    message: entry.message?.slice(0, MAX_BODY),
    logs: entry.logs?.slice(-100).map((line) => line.slice(0, 4_000)),
    tests: entry.tests?.slice(0, 100).map(({ name, passed, error }) => ({ name, passed, error })),
    request: entry.request && { ...entry.request, body: entry.request.body?.slice(0, MAX_BODY) },
    response: entry.response && { ...entry.response, body: entry.response.body.slice(0, MAX_BODY) },
    id: entry.id ?? crypto.randomUUID(),
    at: entry.at ?? Date.now(),
  };
  appConsole.entries = [...appConsole.entries, next].slice(-MAX_CONSOLE_ENTRIES);
}

export function clearAppConsole(): void {
  appConsole.entries = [];
}
