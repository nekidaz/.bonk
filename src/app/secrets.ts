import type { Environment, VarRow } from '$shared/model';

/** Keychain account for a secret var: `globals:<key>` or `env:<envId>:<key>`. */
export const globalAccount = (key: string) => `globals:${key}`;
export const envAccount = (envId: string, key: string) => `env:${envId}:${key}`;

/** Every (account, row) pair of a secret var with a non-empty key. */
function secretRows(globals: VarRow[], envs: Environment[]): Array<[string, VarRow]> {
  const out: Array<[string, VarRow]> = [];
  for (const r of globals) if (r.secret && r.key) out.push([globalAccount(r.key), r]);
  for (const e of envs) for (const r of e.vars) if (r.secret && r.key) out.push([envAccount(e.id, r.key), r]);
  return out;
}

/** account -> value for secrets that have a value (empty ones need no keychain entry). */
export function collectSecrets(globals: VarRow[], envs: Environment[]): Map<string, string> {
  return new Map(
    secretRows(globals, envs)
      .filter(([, r]) => r.value !== '')
      .map(([a, r]) => [a, r.value]),
  );
}

/**
 * Copies for state.json: secret rows whose account is in `stored` (safely in the
 * keychain) lose their value; everything else is kept verbatim.
 */
export function stripSecrets(globals: VarRow[], envs: Environment[], stored: Set<string>) {
  const strip = (account: string, r: VarRow): VarRow => (r.secret && stored.has(account) ? { ...r, value: '' } : r);
  return {
    globals: globals.map((r) => strip(globalAccount(r.key), r)),
    envs: envs.map((e) => ({ ...e, vars: e.vars.map((r) => strip(envAccount(e.id, r.key), r)) })),
  };
}

/** Fill empty secret values from keychain lookups; rows with a value (legacy plain) are kept. */
export function mergeSecrets(globals: VarRow[], envs: Environment[], found: Map<string, string>) {
  const fill = (account: string, r: VarRow): VarRow =>
    r.secret && r.value === '' && found.has(account) ? { ...r, value: found.get(account)! } : r;
  return {
    globals: globals.map((r) => fill(globalAccount(r.key), r)),
    envs: envs.map((e) => ({ ...e, vars: e.vars.map((r) => fill(envAccount(e.id, r.key), r)) })),
  };
}

export const secretAccountsOf = (globals: VarRow[], envs: Environment[]): string[] =>
  secretRows(globals, envs).map(([a]) => a);
