import type { VarRow } from './types';
import type { DynamicOptions } from './dynamicVars';

/** A versioned Runner setup in `.bonk/scenarios.json`; paths are relative to the workspace. */
export interface Scenario {
  name: string;
  paths: string[];
  variables: { environment: Record<string, string>; globals: Record<string, string> };
  requiredVariables: string[];
  environmentName: string | null;
  iterations: number;
  dynamic?: DynamicOptions;
  dataRows: Record<string, string>[];
  delayMs: number;
  stopOnFailure: boolean;
}

/** Publish enabled defaults; a secret contributes only its required name. */
export function scenarioVariables(
  globals: VarRow[],
  environment: VarRow[],
): Pick<Scenario, 'variables' | 'requiredVariables'> {
  const required = new Set<string>();
  const scope = (rows: VarRow[]) => {
    const out: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (!row.enabled || !key) continue;
      if (row.secret) {
        required.add(key);
        delete out[key];
      } else {
        out[key] = row.value;
        required.delete(key);
      }
    }
    return out;
  };
  const g = scope(globals);
  const e = scope(environment);
  // An environment secret must shadow a public global with the same name.
  for (const key of required) {
    delete g[key];
    delete e[key];
  }
  return { variables: { globals: g, environment: e }, requiredVariables: [...required] };
}
