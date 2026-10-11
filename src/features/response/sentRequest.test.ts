import { describe, expect, it } from 'vitest';
import { markDynamic, sentCurl } from './sentRequest';
import type { Tab } from '$shared/model';

describe('request as sent', () => {
  it('marks every occurrence of a dynamic value', () => {
    const values = [
      { name: '$randomInt', value: '41' },
      { name: '$guid', value: 'ab-41-cd' },
    ];
    expect(markDynamic('{"id":"ab-41-cd","n":41}', values)).toEqual([
      { text: '{"id":"', dyn: false },
      { text: 'ab-41-cd', dyn: true },
      { text: '","n":', dyn: false },
      { text: '41', dyn: true },
      { text: '}', dyn: false },
    ]);
    expect(markDynamic('a.b', [])).toEqual([{ text: 'a.b', dyn: false }]);
  });

  it('copies the sent GraphQL body as is, without re-wrapping or re-adding auth', () => {
    const tab = { id: 't', protocol: 'http', title: 'x', request: { method: 'GET', url: '', headers: {} } } as Tab;
    const curl = sentCurl(tab, {
      method: 'POST',
      url: 'https://api.test/graphql',
      headers: { Authorization: 'Bearer t' },
      body: '{"query":"{ a }","variables":{}}',
      bodyMode: 'graphql',
      auth: { type: 'bearer', bearerToken: 't' },
    });
    expect(curl).toContain(`--data '{"query":"{ a }","variables":{}}'`);
    expect(curl.match(/Authorization/g)).toHaveLength(1);
  });
});
