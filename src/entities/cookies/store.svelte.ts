import { untrack } from 'svelte';
import { cookiesAdd, cookiesClear, cookiesJarPath, cookiesList, cookiesRemove } from '$shared/ipc';
import type { CookieInfo } from '$shared/model';
import { tabs } from '$entities/tab';
import { workspace } from '$entities/workspace';
import { cookieUrl, type CookieDraft, isLocalDomain, sameCookie, setCookieOf } from './cookies';

/**
 * The open workspace's cookie jar (Flow · Cookies) as the UI sees it: the cookie list (for the
 * footer chip and the jar window) and whether the window is open. The jar itself lives in Rust;
 * every change goes there and the list is re-read.
 */
class CookieJarStore {
  list = $state.raw<CookieInfo[]>([]);
  /** The jar file, shown in the window's footer. */
  path = $state('');
  sheetOpen = $state(false);
  /** Domain the window selects when it opens (from the response's «Открыть банку»). */
  focusDomain = $state<string | null>(null);

  refresh = async (): Promise<void> => {
    const ws = workspace.path;
    try {
      const [list, path] = await Promise.all([cookiesList(ws), cookiesJarPath(ws)]);
      // Another workspace opened meanwhile: its own refresh is on the way.
      if (ws !== workspace.path) return;
      this.list = list;
      this.path = path;
    } catch (err) {
      console.error('cookies: refresh failed', err);
    }
  };

  open = (domain?: string): void => {
    this.focusDomain = domain ?? null;
    this.sheetOpen = true;
    void this.refresh();
  };

  /** Add `draft`, or replace `original` with it (an edit that renames it removes the old entry). */
  save = async (draft: CookieDraft, original?: CookieInfo): Promise<void> => {
    const ws = workspace.path;
    if (original && !sameCookie(original, { ...draft, name: draft.name.trim(), domain: draft.domain.trim() }))
      await cookiesRemove(ws, original.domain, original.path, original.name);
    await cookiesAdd(ws, cookieUrl(draft.domain, draft.path), setCookieOf(draft));
    await this.refresh();
  };

  /** A Set-Cookie pasted from a browser, stored as if `domain` had sent it. */
  paste = async (setCookie: string, domain: string): Promise<void> => {
    await cookiesAdd(workspace.path, cookieUrl(domain), setCookie.replace(/^set-cookie:\s*/i, '').trim());
    await this.refresh();
  };

  remove = async (c: CookieInfo): Promise<void> => {
    await cookiesRemove(workspace.path, c.domain, c.path, c.name);
    await this.refresh();
  };

  removeDomain = async (domain: string): Promise<void> => {
    await cookiesClear(workspace.path, domain);
    await this.refresh();
  };

  /** Empty the jar (optionally sparing localhost / IP domains); returns how many cookies went. */
  clear = async (keepLocal: boolean): Promise<number> => {
    const ws = workspace.path;
    const before = untrack(() => this.list);
    const doomed = keepLocal ? before.filter((c) => !isLocalDomain(c.domain)) : before;
    if (keepLocal) for (const d of new Set(doomed.map((c) => c.domain))) await cookiesClear(ws, d);
    else await cookiesClear(ws, null);
    await this.refresh();
    return doomed.length;
  };
}
export const cookieJar = new CookieJarStore();

/** Re-read the jar when the workspace changes and after each response (it may have set cookies). */
export function watchCookieJar(): () => void {
  return $effect.root(() => {
    $effect(() => {
      void workspace.path;
      void tabs.active?.response;
      void untrack(cookieJar.refresh);
    });
  });
}
