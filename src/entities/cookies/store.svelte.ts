import { untrack } from 'svelte';
import { cookiesAdd, cookiesClear, cookiesJarPath, cookiesKeepSession, cookiesList, cookiesRemove } from '$shared/ipc';
import type { CookieInfo, ResponseCookie } from '$shared/model';
import { cookieJarScope, cookiesKeepSession as keepSession } from '$shared/settings';
import { tabs } from '$entities/tab';
import { workspace } from '$entities/workspace';
import { cookiesFor, cookieUrl, type CookieDraft, isLocalDomain, sameCookie, setCookieOf } from './cookies';

/** Which jar requests use: the open workspace's, or the app-wide one ('') — Settings → Cookies. */
export const cookieJarKey = (): string => (cookieJarScope.current === 'app' ? '' : workspace.path);

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
    const ws = cookieJarKey();
    try {
      const [list, path] = await Promise.all([cookiesList(ws), cookiesJarPath(ws)]);
      // Another jar (workspace / scope) took over meanwhile: its own refresh is on the way.
      if (ws !== cookieJarKey()) return;
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
    const ws = cookieJarKey();
    if (original && !sameCookie(original, { ...draft, name: draft.name.trim(), domain: draft.domain.trim() }))
      await cookiesRemove(ws, original.domain, original.path, original.name);
    await cookiesAdd(ws, cookieUrl(draft.domain, draft.path), setCookieOf(draft));
    await this.refresh();
  };

  /** A Set-Cookie pasted from a browser, stored as if `domain` had sent it. */
  paste = async (setCookie: string, domain: string): Promise<void> => {
    await cookiesAdd(cookieJarKey(), cookieUrl(domain), setCookie.replace(/^set-cookie:\s*/i, '').trim());
    await this.refresh();
  };

  remove = async (c: CookieInfo): Promise<void> => {
    await cookiesRemove(cookieJarKey(), c.domain, c.path, c.name);
    await this.refresh();
  };

  removeDomain = async (domain: string): Promise<void> => {
    await cookiesClear(cookieJarKey(), domain);
    await this.refresh();
  };

  /** `pm.cookies.jar().clear(url)`: delete every cookie a request to `url` would carry. */
  clearFor = async (url: string): Promise<void> => {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return;
    }
    const ws = cookieJarKey();
    const domains = new Set(
      untrack(() => this.list)
        .filter((c) => host === c.domain || (!c.hostOnly && host.endsWith(`.${c.domain}`)))
        .map((c) => c.domain),
    );
    for (const d of domains) await cookiesClear(ws, d);
    await this.refresh();
  };

  /** `pm.cookies` for a script of a request to `url` (after `response`, in a test script). */
  scriptCookies = (url: string, response?: ResponseCookie[]): { name: string; value: string }[] =>
    cookiesFor(
      untrack(() => this.list),
      url,
      response,
    );

  /** Empty the jar (optionally sparing localhost / IP domains); returns how many cookies went. */
  clear = async (keepLocal: boolean): Promise<number> => {
    const ws = cookieJarKey();
    const before = untrack(() => this.list);
    const doomed = keepLocal ? before.filter((c) => !isLocalDomain(c.domain)) : before;
    if (keepLocal) for (const d of new Set(doomed.map((c) => c.domain))) await cookiesClear(ws, d);
    else await cookiesClear(ws, null);
    await this.refresh();
    return doomed.length;
  };
}
export const cookieJar = new CookieJarStore();

/** Re-read the jar when the workspace or scope changes and after each response (it may have set cookies). */
export function watchCookieJar(): () => void {
  return $effect.root(() => {
    $effect(() => {
      void cookieJarKey();
      void tabs.active?.response;
      void untrack(cookieJar.refresh);
    });
    // Tell the jar about «Хранить между запусками» as soon as it (or the jar) changes, so the
    // file gains or drops session cookies now rather than on the next request.
    $effect(() => {
      const ws = cookieJarKey();
      const keep = keepSession.current;
      cookiesKeepSession(ws, keep).catch((err) => console.error('cookies: keep-session failed', err));
    });
  });
}
