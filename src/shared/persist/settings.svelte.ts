import { invoke } from '@tauri-apps/api/core';
import { untrack } from 'svelte';
import { loadAppState, saveStateDebounced } from './persist';

/**
 * ~/.bonk/settings.json (issue #2), like VS Code's: the user's settings under dotted keys, only the
 * ones that differ from the default. The file is the truth: the Settings window writes into it, and
 * an edit of the file (in the settings.json tab, or in another editor, picked up on window focus)
 * changes the app. Every value is also mirrored into state.json under its old key, so bonk-cli /
 * bonk-mcp (which read state.json) and an older build still see it.
 */

/** One key of the file: its default, its check, its old state.json key. */
export interface SettingSpec {
  key: string;
  fallback: unknown;
  valid: (v: unknown) => boolean;
  legacy: string;
  /** The value until the file is read (theme: localStorage, so the first paint has no flash). */
  early?: unknown;
}

const specs = new Map<string, SettingSpec>();
/** Every known key, for the settings.json editor's completion and checks. */
export const settingSpecs = (): SettingSpec[] => [...specs.values()];

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

function parse(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const v: unknown = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('settings.json must be a JSON object');
  return v as Record<string, unknown>;
}

class SettingsFile {
  /** What the file says: explicit keys only; keys bonk doesn't know are kept as they are. */
  values = $state.raw<Record<string, unknown>>({});
  loaded = $state(false);
  /** Why the file on disk can't be used (bad JSON). Until it's fixed the last good values stay and
   *  nothing is written over it. */
  error = $state('');
  /** A change made in the app was not written because of `error`. */
  unsaved = $state(false);
  /** The file's text as last read or written. */
  text = $state('');
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** state.json key → JSON of the value last mirrored there. */
  #mirrored = new Map<string, string>();
  #loading: Promise<void> | undefined;
  #loaded!: () => void;
  /** Resolves once the file has been read (every setting's `ready`). */
  readonly ready = new Promise<void>((resolve) => (this.#loaded = resolve));

  get(key: string): unknown {
    const s = specs.get(key);
    if (!s) return undefined;
    // Before the file is read: what was assigned since start, else the early value.
    const v = this.values[key] ?? (this.loaded ? undefined : s.early);
    return v !== undefined && v !== null && s.valid(v) ? v : s.fallback;
  }

  set(key: string, v: unknown): void {
    const values = untrack(() => this.values);
    if (!untrack(() => this.loaded)) {
      this.values = { ...values, [key]: v }; // read back until the file's values replace it
      return;
    }
    const { [key]: _, ...rest } = values;
    this.values = same(v, specs.get(key)?.fallback) ? rest : { ...values, [key]: v };
    this.#mirror();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#write(), 350);
  }

  /**
   * Read the file; called once by startApp(), after every module (so every setting) is loaded.
   * No file yet: it is made from the settings' values in state.json.
   */
  load(): Promise<void> {
    this.#loading ??= this.#load()
      .catch((e) => console.error('settings.json: load failed', e))
      .finally(() => {
        this.loaded = true;
        this.#loaded();
      });
    return this.#loading;
  }

  async #load(): Promise<void> {
    const state = await loadAppState();
    for (const s of specs.values()) this.#mirrored.set(s.legacy, JSON.stringify(state[s.legacy]));
    const legacy: Record<string, unknown> = {};
    for (const s of specs.values()) {
      const v = state[s.legacy] ?? s.early;
      if (v !== undefined && v !== null && s.valid(v) && !same(v, s.fallback)) legacy[s.key] = v;
    }
    let text: string | null;
    try {
      text = (await invoke<string | null>('settings_file_read')) ?? null;
    } catch (e) {
      text = null;
      this.error = String(e);
    }
    // A broken (or no) file: run on the last values the app saw, not on the defaults.
    this.values = legacy;
    if (text === null) {
      if (!this.error) await this.#write();
      return;
    }
    this.#apply(text);
    this.#mirror();
  }

  /** Pick up an edit made outside the app (called on window focus). */
  async reload(): Promise<void> {
    if (!this.loaded || this.#timer !== undefined) return;
    try {
      const text = (await invoke<string | null>('settings_file_read')) ?? '';
      if (text === this.text) return;
      this.#apply(text);
      this.#mirror();
    } catch (e) {
      console.error('settings.json: read failed', e);
    }
  }

  /** Write the file as typed (the settings.json tab) and apply it. Throws when the write fails. */
  async saveText(text: string): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await invoke('settings_file_write', { text });
    this.#apply(text);
    this.#mirror();
  }

  /** Write a pending change now (the window is closing or hidden). */
  flush(): Promise<void> {
    if (this.#timer === undefined) return Promise.resolve();
    clearTimeout(this.#timer);
    return this.#write();
  }

  #apply(text: string): void {
    this.text = text;
    try {
      this.values = parse(text);
      this.error = '';
      this.unsaved = false;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async #write(): Promise<void> {
    this.#timer = undefined;
    if (this.error) {
      this.unsaved = true;
      return;
    }
    const text = JSON.stringify(this.values, null, 2) + '\n';
    try {
      await invoke('settings_file_write', { text });
      this.text = text;
    } catch (e) {
      console.error('settings.json: write failed', e);
    }
  }

  #mirror(): void {
    for (const s of specs.values()) {
      const v = untrack(() => this.get(s.key));
      const json = JSON.stringify(v);
      if (this.#mirrored.get(s.legacy) === json) continue;
      this.#mirrored.set(s.legacy, json);
      saveStateDebounced(s.legacy, v);
    }
  }
}

export const settingsFile = new SettingsFile();

/**
 * One user setting, kept in settings.json. Same use as `persisted`: read and write `.current`
 * (Go: a struct field behind a setter). `legacy` is its state.json key from before settings.json.
 * Without `validate`, a value of another type than `fallback` reads as `fallback`.
 */
export class Setting<T> {
  readonly ready: Promise<void>;

  constructor(
    readonly key: string,
    legacy: string,
    fallback: T,
    validate?: (v: unknown) => v is T,
    early?: T,
  ) {
    const valid =
      validate ?? ((v: unknown) => typeof v === typeof fallback && Array.isArray(v) === Array.isArray(fallback));
    specs.set(key, { key, fallback, valid, legacy, early });
    this.ready = settingsFile.ready;
  }

  /** True once the file has been read (reactive). */
  get loaded(): boolean {
    return settingsFile.loaded;
  }

  get current(): T {
    return settingsFile.get(this.key) as T;
  }

  set current(v: T) {
    if (
      same(
        v,
        untrack(() => this.current),
      )
    )
      return;
    settingsFile.set(this.key, v);
  }
}

export const setting = <T>(
  key: string,
  legacy: string,
  fallback: T,
  validate?: (v: unknown) => v is T,
  early?: T,
): Setting<T> => new Setting(key, legacy, fallback, validate, early);
