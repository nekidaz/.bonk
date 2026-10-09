import { invoke } from '@tauri-apps/api/core';
import { writable, type Writable } from 'svelte/store';

type PendingSave = { timer: ReturnType<typeof setTimeout>; value: unknown };
const pendingSaves = new Map<string, PendingSave>();

let cache: Record<string, unknown> | null = null;
let loadPromise: Promise<Record<string, unknown>> | null = null;

async function ensureLoaded(): Promise<Record<string, unknown>> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = invoke<Record<string, unknown>>('app_state_load')
      .then((v) => (cache = v ?? {}))
      .catch((err) => {
        console.error('persist: load failed', err);
        return (cache = {});
      });
  }
  return loadPromise;
}

/**
 * Type guard for "this persisted value is an array of items each accepted by
 * `item`". Use with `loadState` so corrupt/old persisted state (e.g. a renamed
 * shape, or a non-array left by an older build) falls back instead of being
 * blindly cast and crashing a consumer downstream.
 */
export function isArrayOf<T>(item: (v: unknown) => v is T): (v: unknown) => v is T[] {
  return (v): v is T[] => Array.isArray(v) && v.every(item);
}

/** Loose guard for a persisted "tab"/"history entry": a non-null object with an `id`. */
export function isRecordWithId(v: unknown): v is { id: string } {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string';
}

/**
 * Load a persisted value by key. Returns `fallback` when the key is missing.
 *
 * When `validate` is supplied, the stored value must pass it or `fallback` is
 * returned — this stops corrupt/legacy state from being cast to `T` and crashing
 * a consumer. When `validate` is omitted but `fallback` is an array, the stored
 * value must at least be an array before it is cast (cheap structural guard).
 * The `validate` parameter is optional, so existing callers are unaffected.
 */
export async function loadState<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): Promise<T> {
  const map = await ensureLoaded();
  const v = map[key];
  if (v === undefined || v === null) return fallback;
  if (validate) return validate(v) ? v : fallback;
  // No explicit validator: if the caller expects an array, at least verify the
  // stored value is one before casting, so a corrupt non-array can't slip through.
  if (Array.isArray(fallback) && !Array.isArray(v)) return fallback;
  return v as T;
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
  await Promise.all(
    entries.map(([key, pending]) => {
      clearTimeout(pending.timer);
      return saveState(key, pending.value);
    }),
  );
}

export type PersistedStore<T> = Writable<T> & { ready: Promise<void> };

/**
 * A writable that restores itself from app-state on creation and saves every
 * later change, so a settings module needs no wiring in app/persistence.ts.
 * Holds `fallback` until `ready` resolves; without `validate`, a stored value of
 * a different type than `fallback` is ignored.
 */
export function persisted<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): PersistedStore<T> {
  const store = writable(fallback);
  const sameType = (v: unknown): v is T => typeof v === typeof fallback && Array.isArray(v) === Array.isArray(fallback);
  const ready = loadState(key, fallback, validate ?? sameType).then((v) => {
    store.set(v);
    store.subscribe((value) => saveStateDebounced(key, value));
  });
  return { ...store, ready };
}
