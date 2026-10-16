import { untrack } from 'svelte';
import { cancelRequest, sessionForget, sessionRun, sessionStatus } from '$shared/ipc';
import { mergeScope, type AuthConfig, type EnvSession, type SessionUse, type TreeNode } from '$shared/model';
import { dynamicOptions, withGlobalImports } from '$shared/settings';
import { environments } from '$entities/environment';
import { closePrompt, inputs, openPrompt } from '$entities/input';
import { workspace } from '$entities/workspace';
import { applyScriptVars, currentRequestSettings } from './executionState';

/** A send that went through a session (or renewed / signed in on the way), kept per tab for the Authorization tab. */
export interface SessionSend extends SessionUse {
  /** Unix ms of the send. */
  at: number;
  /** The request that went out with the token. */
  sent?: { text: string; status: number; ms: number };
}

/** A sign-in / renewal started by a button, until it ends (its form is `inputPrompts.byRequest[requestId]`). */
export interface SessionRunning {
  mode: 'signIn' | 'refresh';
  environment: string;
  /** `sessionCardKey` of the card it belongs to. */
  key: string;
}

/**
 * Session state the cards share. Tokens live in the keychain; `version` is bumped whenever one
 * changes so cards re-read their status. Sends report through `uses`, buttons through `running`.
 */
class SessionRuntime {
  version = $state(0);
  /** By tab id: how the last send of that tab got its token. */
  uses = $state.raw<Record<string, SessionSend>>({});
  /** By request id (cancel with `cancelSessionRun`). */
  running = $state.raw<Record<string, SessionRunning>>({});
  /** Why the last button run failed, for the card that started it. */
  failure = $state.raw<{ key: string; message: string } | null>(null);
  /** The Sessions dialog (Flow · Session SE6): the collection auth it lists, and where it is set. */
  dialog = $state.raw<{ auth: AuthConfig; where: string } | null>(null);

  changed(): void {
    this.version = untrack(() => this.version) + 1;
  }

  setUse(tabId: string, use: SessionSend | undefined): void {
    const { [tabId]: _old, ...rest } = untrack(() => this.uses);
    this.uses = use ? { ...rest, [tabId]: use } : rest;
  }
}

export const sessionRuntime = new SessionRuntime();

/** Which card a run / failure belongs to: the settings as written, in an environment. */
export function sessionCardKey(auth: AuthConfig, environment: string): string {
  return `${environment}|${JSON.stringify(auth.session ?? {})}`;
}

/** The selected environment's name ('' = none): a session is kept per environment. */
export const activeEnvName = (): string => environments.active?.name ?? '';

export function openSessions(auth: AuthConfig, where: string): void {
  sessionRuntime.dialog = { auth, where };
}

export function closeSessions(): void {
  sessionRuntime.dialog = null;
}

/** Names of the workspace's environments, for the Sessions dialog. */
export const environmentNames = (): string[] => environments.list.map((e) => e.name);

/** What is stored for each environment (expired too). */
export function sessionStatuses(auth: AuthConfig, names: string[]): Promise<EnvSession[]> {
  return sessionStatus(workspace.path ?? '', names, auth.session ?? {});
}

/** “Sign in” / “Refresh” now, in `environment` (default: the selected one). Never throws: a failure lands in `sessionRuntime.failure`. */
export async function runSession(
  mode: 'signIn' | 'refresh',
  auth: AuthConfig,
  environment = activeEnvName(),
): Promise<SessionUse | null> {
  const requestId = crypto.randomUUID();
  const key = sessionCardKey(auth, environment);
  const env = environments.list.find((e) => e.name === environment);
  sessionRuntime.failure = null;
  sessionRuntime.running = { ...untrack(() => sessionRuntime.running), [requestId]: { mode, environment, key } };
  try {
    return await sessionRun(
      requestId,
      mode,
      auth.session ?? {},
      {
        requests: [],
        iterations: 1,
        dataRows: [],
        delayMs: 0,
        stopOnFailure: false,
        workspaceRoot: workspace.path ?? '',
        globalImportPaths: withGlobalImports([]),
        dynamic: dynamicOptions(),
        inputs: inputs.defs,
        // A rejected code shows its error in the form, not as a second form.
        inputAttempts: 1,
        environmentName: environment,
      },
      { environment: mergeScope([], env), globals: mergeScope(environments.globals, undefined) },
      currentRequestSettings(),
      (event) => {
        if (event.kind === 'vars') applyScriptVars(event, env?.id ?? null, false);
        else if (event.kind === 'input') openPrompt(requestId, event);
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/cancelled/.test(message)) sessionRuntime.failure = { key, message };
    return null;
  } finally {
    closePrompt(requestId);
    const { [requestId]: _done, ...rest } = untrack(() => sessionRuntime.running);
    sessionRuntime.running = rest;
    sessionRuntime.changed();
  }
}

/** Stop a button's sign-in that waits for the code. */
export const cancelSessionRun = (requestId: string): Promise<void> => cancelRequest(requestId);

/** “Sign out”: forget the session of these environments. */
export async function signOutSessions(auth: AuthConfig, names: string[]): Promise<void> {
  await sessionForget(workspace.path ?? '', names, auth.session ?? {});
  sessionRuntime.changed();
}

/** Collection folders whose session signs in through scenario `name` (the Runner offers to keep that sign-in). */
export function sessionAuthsFor(
  name: string,
  tree: TreeNode[] = workspace.tree,
): { folder: string; auth: AuthConfig }[] {
  const out: { folder: string; auth: AuthConfig }[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      if (node.auth?.type === 'session' && node.auth.session?.login === name)
        out.push({ folder: node.name, auth: node.auth });
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}
