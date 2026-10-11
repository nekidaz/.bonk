// Public API of entities/cookies (like the exported names of a Go package).
// Code outside src/entities/cookies/ imports only from here; files inside use relative paths.

export {
  changeCounts,
  cookiesFor,
  type CookieDraft,
  domainGroups,
  type DomainGroup,
  draftOf,
  emptyDraft,
  type DayCell,
  expiryLabel,
  monthGrid,
  spanParts,
  zoneLabel,
  isLocalDomain,
  pastedDomain,
  sameCookie,
  type SameSite,
  setCookieOf,
} from './cookies';
export { cookieJar, cookieJarKey, watchCookieJar } from './store.svelte';
