import { expect, it } from 'vitest';
import { scenarioVariables } from './scenario';

it('publishes public defaults and only required names for active secrets, respecting scope shadowing', () => {
  const saved = scenarioVariables(
    [
      { key: 'base', value: 'https://api.test', enabled: true },
      { key: 'token', value: 'global-value', enabled: true },
      { key: 'password', value: 'local-only', enabled: true, secret: true },
    ],
    [
      { key: 'token', value: 'actual-secret', enabled: true, secret: true },
      { key: 'password', value: 'public-override', enabled: true },
      { key: 'disabled', value: 'must-not-export', enabled: false, secret: true },
    ],
  );
  expect(saved).toEqual({
    variables: { globals: { base: 'https://api.test' }, environment: { password: 'public-override' } },
    requiredVariables: ['token'],
  });
  expect(JSON.stringify(saved)).not.toContain('actual-secret');
  expect(JSON.stringify(saved)).not.toContain('local-only');
});
