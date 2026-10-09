import type { Environment, TreeNode, VarRow } from './types';

/** Bonk JSON export: the collection tree plus environments; secret values only on request. */
export function buildWorkspaceExport(
  name: string,
  collections: TreeNode[],
  globals: VarRow[],
  envs: Environment[],
  includeSecrets: boolean,
): string {
  const scrub = (r: VarRow): VarRow => (r.secret && !includeSecrets ? { ...r, value: '' } : r);
  return JSON.stringify({
    format: 'bonk-workspace',
    version: 1,
    name,
    collections,
    globals: globals.map(scrub),
    environments: envs.map((e) => ({ ...e, vars: e.vars.map(scrub) })),
  }, null, 2);
}
