import { invoke } from '@tauri-apps/api/core';

type PendingSave = { timer: ReturnType<typeof setTimeout>; value: unknown };
const pendingSaves = new Map<string, PendingSave>();

let cache: Record<string, unknown> | null = null;
let loadPromise: Promise<Record<string, unknown>> | null = null;

async function ensureLoaded(): Promise<Record<string, unknown>> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = invoke<Record<string, unknown>>('app_state_load')
      .then((v) => (cache = v ?? {}))
      .catch((err) => { console.error('persist: load failed', err); return (cache = {}); });
  }
  return loadPromise;
}

export async function loadState<T>(key: string, fallback: T): Promise<T> {
  const map = await ensureLoaded();
  const v = map[key];
  return (v === undefined || v === null) ? fallback : (v as T);
}

export async function saveState<T>(key: string, value: T): Promise<void> {
  try {
    const map = await ensureLoaded();
    map[key] = value;
    await invoke('app_state_set', { key, value });
  } catch (err) {
    console.error(`persist: saveState("${key}") failed`, err);
  }
}

export function saveStateDebounced<T>(key: string, value: T, delayMs = 350): void {
  const pending = pendingSaves.get(key);
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    pendingSaves.delete(key);
    void saveState(key, value);
  }, delayMs);
  pendingSaves.set(key, { timer, value });
}

export async function flushPendingSaves(): Promise<void> {
  const entries = [...pendingSaves.entries()];
  pendingSaves.clear();
  await Promise.all(entries.map(([key, pending]) => {
    clearTimeout(pending.timer);
    return saveState(key, pending.value);
  }));
}
