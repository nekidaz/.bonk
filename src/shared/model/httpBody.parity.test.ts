// What the app previews (cURL, code snippets) vs what it sends: sending goes through bonk-core
// (crates/bonk-core/src/domain/request_prep.rs, shared with bonk-mcp), previews through this TS.
// `requestPrep.cases.json` is the shared spec; Rust runs it in `shared_cases_match_the_app`.
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
