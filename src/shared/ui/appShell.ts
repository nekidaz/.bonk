import type { RequestProtocol } from '$shared/model';

export type { RequestProtocol };

export type AppMenuKind = 'create' | 'switch' | 'coll' | 'req' | 'history' | 'tab' | null;
export type UtilityMode = 'terminal' | 'console' | 'issues';

export type AppMenuState = {
  kind: AppMenuKind;
  x: number;
  y: number;
  /** Bottom edge to open upward from when the menu doesn't fit below `y`. */
  flipY?: number;
  nodeId?: string;
  isFolder?: boolean;
};

export function appMenuWidth(kind: Exclude<AppMenuKind, null>): number {
  if (kind === 'create') return 208;
  if (kind === 'history') return 220;
  if (kind === 'switch') return 160;
  if (kind === 'tab') return 232;
  return 260;
}

/** Folder name of a workspace path ('' for an empty path). */
export function workspaceName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? '';
}

/** Two-letter avatar: 'acme-business' → 'fb', 'Sandbox' → 'sa'. */
export function workspaceInitials(name: string): string {
  const words = name.split(/[\s_.-]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  return letters.slice(0, 2).toLowerCase();
}

/** A folder path for one line: the home dir as «~», split so CSS can cut the start and keep the last folder. */
export function pathParts(path: string): { dir: string; leaf: string } {
  const p = path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1;
  return { dir: p.slice(0, cut), leaf: p.slice(cut) };
}

/** Some installed MCP client is configured for this workspace (the «● MCP подключён» chip). */
export function mcpConnected(clients: { installed: boolean; workspace?: string | null }[], workspace: string): boolean {
  return !!workspace && clients.some((c) => c.installed && c.workspace === workspace);
}

/** Recent workspaces offered in the switcher: current one excluded, max 8 (⌥⌘2…⌥⌘9). */
export function recentWorkspaceChoices(paths: string[], current: string): string[] {
  return paths.filter((p) => p && p !== current).slice(0, 8);
}

export type PanelSnap = {
  collapsed: boolean;
  size: number;
};

/** Clamp a panel size, or collapse it completely once it crosses the snap edge. */
export function snapPanelSize(rawSize: number, min: number, max: number, collapseAt: number): PanelSnap {
  if (rawSize <= collapseAt) return { collapsed: true, size: min };
  return { collapsed: false, size: Math.min(max, Math.max(min, rawSize)) };
}
