import { beforeEach, expect, it, vi } from 'vitest';
import type { Scenario } from '$shared/model';

vi.mock('$entities/request', () => ({
  runRequests: vi.fn(async () => 'done'),
  runOne: vi.fn(),
  captureExecutionContext: () => ({ environmentId: null, variables: { environment: {}, globals: {} } }),
}));
vi.mock('$shared/persist', async (original) => ({
  ...(await original<typeof import('$shared/persist')>()),
  loadState: vi.fn(async (_key: string, fallback: unknown) => fallback),
  saveState: vi.fn(),
  saveStateDebounced: vi.fn(),
}));

import { runRequests } from '$entities/request';
import { workspace } from '$entities/workspace';
import { runner, runCollection } from './store.svelte';
import { DEFAULT_CONFIG, DEFAULT_RUN } from './runnerPlan';

const scenario: Scenario = {
  name: 'smoke',
  paths: ['gone.bonk.json', 'present.bonk.json'],
  variables: { environment: {}, globals: {} },
  requiredVariables: [],
  environmentName: null,
  iterations: 1,
  dataRows: [],
  delayMs: 0,
  stopOnFailure: true,
};

beforeEach(() => {
  vi.mocked(runRequests).mockClear();
  workspace.path = '/workspace';
  workspace.tree = [
    {
      kind: 'request',
      id: 'fs:present.bonk.json',
      name: 'present',
      protocol: 'http',
      request: { method: 'GET', url: 'https://api.test', headers: {} },
    },
  ];
  runner.config = { ...DEFAULT_CONFIG, folderIds: scenario.paths.map((p) => `fs:${p}`) };
  runner.run = { ...DEFAULT_RUN };
  runner.activeScenario = scenario;
});

it('refuses a partly missing committed scenario before dispatching the remaining requests', async () => {
  await runCollection();
  expect(runRequests).not.toHaveBeenCalled();
  expect(runner.error).toContain('gone.bonk.json');
  expect(runner.stage).toBe('setup');
});
