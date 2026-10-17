import type { HttpResponse, Tab } from '$shared/model';
import { withInheritedAuth } from '$entities/workspace';
import { executeRequest } from './execute';
import { currentRequestSettings } from './executionState';
import { withOverrides } from './requestSettings';

/**
 * Send a tab's request with `query` as the GraphQL body, the same engine as Send but silent: no
 * scripts (so no variable writes), and nothing lands in the tab, history, console or test results.
 * `inputMode: 'fail'` makes needed «ask on send» input an error instead of a form.
 */
export async function introspectHttp(tab: Tab, query: string, inputMode: 'wait' | 'fail'): Promise<HttpResponse> {
  const request = {
    ...withInheritedAuth(tab, tab.savedPath).request,
    method: 'POST',
    bodyMode: 'graphql' as const,
    body: query,
    graphqlVariables: undefined,
    preRequestScript: undefined,
    testScript: undefined,
  };
  const { row, details } = await executeRequest(
    {
      kind: 'request',
      id: tab.savedPath ?? '',
      name: tab.title,
      protocol: 'http',
      request,
      params: tab.params,
    },
    crypto.randomUUID(),
    withOverrides(currentRequestSettings(), tab.settings),
    undefined,
    undefined,
    undefined,
    inputMode,
  );
  if (!details.response) throw new Error(row.error ?? 'no response');
  return details.response;
}
