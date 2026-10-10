// The request the app sends vs the one bonk-mcp sends: both prepare it from the same saved
// request, in different languages. `requestPrep.cases.json` is the shared spec; the Rust side
// runs the same file in crates/bonk-mcp/src/request_prep.rs (`shared_cases_match_the_app`).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
import cases from './requestPrep.cases.json';
import { buildUrl } from './http';
import { buildRequestForSend } from './httpBody';
import { resolveRequestVars } from './vars';
import type { HttpRequest, Param } from './types';

describe('request preparation (shared with bonk-mcp)', () => {
  it.each(cases)('$name', (c) => {
    const request = { ...c.request, body: c.request.body ?? undefined } as HttpRequest;
    const params = (c as { params?: Param[] }).params;
    // The runner's order: URL + params, then the body, then {{vars}} and auth.
    const scope = c.scope as Record<string, string>;
    const sent = resolveRequestVars(buildRequestForSend({ request }, buildUrl(request.url, params)), scope);
    expect({ url: sent.url, headers: sent.headers, body: sent.body ?? null }).toEqual(c.expected);
  });
});
