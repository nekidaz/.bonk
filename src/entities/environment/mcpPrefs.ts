import { persisted } from '$shared/persist';
import type { McpMethodPolicy } from '$shared/ipc';
import type { McpEnvScope } from './mcpEnvs';

export interface McpPrefs {
  /** Allow create/update/move/delete of workspace requests (inverse of readOnly). */
  allowWrites: boolean;
  /** Allow HTTP/gRPC sends (inverse of noNetwork). */
  allowNetwork: boolean;
  exposeSecrets: boolean;
  mutatingMethods: McpMethodPolicy;
  targetHosts: string[];
  /** `all-but-prod` (default) or `selected` (only `environments`). Absent in prefs from older builds. */
  envScope?: McpEnvScope;
  /** Environment names AI may use when scope is `selected`; null = legacy default (all except production-like). */
  environments: string[] | null;
  /** Scope `selected`: allow environments created later right away (never production-like ones). */
  autoAllowNew?: boolean;
}

export const defaultMcpPrefs: McpPrefs = {
  allowWrites: true,
  allowNetwork: true,
  exposeSecrets: false,
  mutatingMethods: 'ask',
  targetHosts: [],
  envScope: 'all-but-prod',
  environments: null,
  autoAllowNew: false,
};

const isPrefs = (v: unknown): v is McpPrefs =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as McpPrefs).allowWrites === 'boolean' &&
  Array.isArray((v as McpPrefs).targetHosts);

export const mcpPrefs = persisted<McpPrefs>('mcp.prefs', defaultMcpPrefs, isPrefs);
