/** A saved Runner setup (R2 «Сохранить как пресет»): scope, selection, order and run settings. */
export interface RunnerPreset {
  /** Display name; also the identity (saving the same name again updates it). */
  name: string;
  folderIds: string[];
  excludedIds: string[];
  orderIds: string[];
  iterations: number;
  delayMs: number;
  stopOnFailure: boolean;
  saveResponses: boolean;
  /** Environment to activate; null = none. Ignored if it no longer exists. */
  envId: string | null;
}

export const PRESET_LIMIT = 20;

export const isPreset = (v: unknown): v is RunnerPreset => {
  const p = v as RunnerPreset;
  return typeof p === 'object' && p !== null && typeof p.name === 'string' && Array.isArray(p.folderIds)
    && Array.isArray(p.excludedIds) && Array.isArray(p.orderIds) && typeof p.iterations === 'number';
};

/** Insert or replace by name (newest last), keeping at most `limit`. */
export function upsertPreset(list: RunnerPreset[], p: RunnerPreset, limit = PRESET_LIMIT): RunnerPreset[] {
  return [...list.filter((x) => x.name !== p.name), p].slice(-limit);
}
