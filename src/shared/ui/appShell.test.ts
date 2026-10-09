import { describe, expect, it } from 'vitest';
import { mcpConnected, recentWorkspaceChoices, snapPanelSize, workspaceInitials, workspaceName } from './appShell';

describe('snapPanelSize', () => {
  it('collapses after the snap threshold', () => {
    expect(snapPanelSize(90, 200, 600, 120)).toEqual({ collapsed: true, size: 200 });
  });

  it('keeps the normal minimum before the snap threshold', () => {
    expect(snapPanelSize(150, 200, 600, 120)).toEqual({ collapsed: false, size: 200 });
  });

  it('passes through and caps regular sizes', () => {
    expect(snapPanelSize(360, 200, 600, 120)).toEqual({ collapsed: false, size: 360 });
    expect(snapPanelSize(900, 200, 600, 120)).toEqual({ collapsed: false, size: 600 });
  });
});

describe('workspace switcher helpers', () => {
  it('names a workspace by its folder', () => {
    expect(workspaceName('/Users/me/Documents/bonk/acme-business/')).toBe('acme-business');
    expect(workspaceName('')).toBe('');
  });

  it('builds two-letter initials', () => {
    expect(workspaceInitials('acme-business')).toBe('fb');
    expect(workspaceInitials('Bank Core gRPC')).toBe('bc');
    expect(workspaceInitials('Sandbox')).toBe('sa');
  });

  it('offers recents without the current one, capped at 8', () => {
    const paths = ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h', '/i', '/j'];
    expect(recentWorkspaceChoices(paths, '/b')).toEqual(['/a', '/c', '/d', '/e', '/f', '/g', '/h', '/i']);
  });
});

describe('mcpConnected', () => {
  it('needs an installed client pointing at exactly this workspace', () => {
    const clients = [{ installed: true, workspace: '/a' }, { installed: false, workspace: '/b' }, { installed: true }];
    expect([
      mcpConnected(clients, '/a'),
      mcpConnected(clients, '/b'),
      mcpConnected(clients, '/c'),
      mcpConnected(clients, ''),
    ]).toEqual([true, false, false, false]);
  });
});
