import { describe, it, expect } from 'vitest';
import { requestVariableNames } from './flowNode';
import type { HttpRequest } from '$shared/model';

function req(patch: Partial<HttpRequest>): HttpRequest {
  return { method: 'GET', url: '', headers: {}, ...patch };
}

describe('requestVariableNames', () => {
  it('collects distinct names across url, headers, body params and body', () => {
    const names = requestVariableNames(
      req({
        method: 'POST',
        url: '{{base_url}}/sso/v1/authenticate?lang={{user_language}}',
        headers: { 'Device-ID': '{{device_id}}', Authorization: 'Bearer {{access_token}}' },
        bodyParams: [{ key: 'iin', value: '{{user_iin}}', description: '', enabled: true }],
        body: '{"phoneNumber":"{{user_phone}}","iin":"{{user_iin}}"}',
      }),
    );

    // First-seen order, no duplicates (user_iin appears in both params and body).
    expect(names).toEqual(['base_url', 'user_language', 'device_id', 'access_token', 'user_iin', 'user_phone']);
  });

  it('returns an empty list for a request with no placeholders', () => {
    expect(requestVariableNames(req({ url: 'https://api.example.com/ping' }))).toEqual([]);
  });

  it('trims names the same way variable resolution does', () => {
    expect(requestVariableNames(req({ url: '{{ base_url }}/x' }))).toEqual(['base_url']);
  });
});
