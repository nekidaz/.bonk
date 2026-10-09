import { persisted } from '../persist';
import type { McpMethodPolicy } from '../api';

export interface McpPrefs {
  /** Allow create/update/move/delete of workspace requests (inverse of readOnly). */
  allowWrites: boolean;
  /** Allow HTTP/gRPC sends (inverse of noNetwork). */
  allowNetwork: boolean;
  exposeSecrets: boolean;
  mutatingMethods: McpMethodPolicy;
  targetHosts: string[];
  /** Environment names AI may use; null = default (all except production-like). */
  environments: string[] | null;
}

export const defaultMcpPrefs: McpPrefs = {
  allowWrites: true,
  allowNetwork: true,
  exposeSecrets: false,
  mutatingMethods: 'ask',
  targetHosts: [],
  environments: null,
};

const isPrefs = (v: unknown): v is McpPrefs =>
  typeof v === 'object' && v !== null && typeof (v as McpPrefs).allowWrites === 'boolean'
  && Array.isArray((v as McpPrefs).targetHosts);

export const mcpPrefs = persisted<McpPrefs>('mcp.prefs', defaultMcpPrefs, isPrefs);
