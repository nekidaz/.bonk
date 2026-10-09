import { loadState, saveStateDebounced } from './persist';

/**
 * One app-state value that restores itself on creation and saves on every assignment, so a
 * settings module needs no wiring in app/persistence. Read and write `.current`
 * (Go: a struct field behind a setter that writes through to disk).
 * Holds `fallback` until `ready` resolves; a value assigned before that is not saved and is
 * replaced by the stored one. Without `validate`, a stored value of another type than
 * `fallback` is ignored. Objects are replaced, never mutated in place (`$state.raw`).
 */
export class Persisted<T> {
  #value = $state.raw() as T;
  #loaded = $state(false);
  readonly ready: Promise<void>;

  constructor(
    readonly key: string,
    fallback: T,
    validate?: (v: unknown) => v is T,
  ) {
    this.#value = fallback;
    const sameType = (v: unknown): v is T =>
      typeof v === typeof fallback && Array.isArray(v) === Array.isArray(fallback);
    this.ready = loadState(key, fallback, validate ?? sameType).then((v) => {
      this.#value = v;
      this.#loaded = true;
      saveStateDebounced(key, v);
    });
  }

  /** True once the stored value has been read (reactive: an $effect can wait for it). */
  get loaded(): boolean {
    return this.#loaded;
  }

  get current(): T {
    return this.#value;
  }

  set current(v: T) {
    this.#value = v;
    if (this.#loaded) saveStateDebounced(this.key, v);
  }
}

export const persisted = <T>(key: string, fallback: T, validate?: (v: unknown) => v is T): Persisted<T> =>
  new Persisted(key, fallback, validate);
