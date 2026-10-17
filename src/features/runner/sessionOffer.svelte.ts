import { untrack } from 'svelte';
import { sessionPeek, sessionSaveCaught } from '$shared/ipc';
import type { AuthConfig, RunResultRow, SessionInfo } from '$shared/model';
import { activeEnvName, sessionAuthsFor, sessionRuntime } from '$entities/request';
import { workspace } from '$entities/workspace';

/** One collection folder whose session signs in through the scenario that just ran, with what the run caught for it. */
export interface OfferTarget {
  folder: string;
  auth: AuthConfig;
  info: SessionInfo;
}

/** The Runner's “Remember this sign-in?” (Flow · Session SE1): a finished sign-in scenario offers to keep its tokens. */
export interface SessionOffer {
  /** Run number, so a card never outlives its run. */
  run: number;
  /** Environment the run used; the tokens are kept for it. */
  environment: string;
  rows: [string, string][];
  targets: OfferTarget[];
  /** Index in `targets` of the “For” select. */
  pick: number;
  /** The folder it was saved for ('' until saved). */
  saved: string;
  error: string;
}

class Offers {
  current = $state.raw<SessionOffer | null>(null);

  update(patch: Partial<SessionOffer>): void {
    const cur = untrack(() => this.current);
    if (cur) this.current = { ...cur, ...patch };
  }
}
export const sessionOffer = new Offers();

/**
 * After a finished run: if every call passed and some folder's session signs in through `scenario`,
 * peek (without keeping) what the run caught and open the card. Nothing caught → no card.
 */
export async function offerSession(scenario: string | undefined, run: number, results: RunResultRow[]): Promise<void> {
  sessionOffer.current = null;
  if (!scenario || results.length === 0 || !results.every((r) => r.ok)) return;
  const matches = sessionAuthsFor(scenario);
  if (matches.length === 0) return;
  const rows = results.flatMap((r): [string, string][] =>
    r.nodeId && r.responseBody ? [[r.nodeId, r.responseBody]] : [],
  );
  const targets: OfferTarget[] = [];
  for (const m of matches) {
    const info = await sessionPeek(m.auth.session ?? {}, rows).catch(() => null);
    if (info) targets.push({ ...m, info });
  }
  if (targets.length > 0)
    sessionOffer.current = { run, environment: activeEnvName(), rows, targets, pick: 0, saved: '', error: '' };
}

/** “Save session”: keep the caught tokens in the keychain for the chosen folder's settings. */
export async function saveOffer(): Promise<void> {
  const o = sessionOffer.current;
  const target = o?.targets[o.pick];
  if (!o || !target || o.saved) return;
  try {
    await sessionSaveCaught(workspace.path ?? '', o.environment, target.auth.session ?? {}, o.rows);
    sessionRuntime.changed();
    sessionOffer.update({ saved: target.folder, error: '' });
  } catch (e) {
    sessionOffer.update({ error: e instanceof Error ? e.message : String(e) });
  }
}
