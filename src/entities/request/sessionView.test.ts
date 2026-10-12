import { describe, expect, it } from 'vitest';
import type { RequestNode, Scenario, SessionPrompt, TreeNode } from '$shared/model';
import {
  askedSteps,
  joinNames,
  nodeLabel,
  nodeOptions,
  promptLines,
  scenarioRequests,
  sessionMissing,
  timelineLines,
} from './sessionView';

const req = (id: string, name: string, method = 'POST', body = ''): RequestNode => ({
  kind: 'request',
  id,
  name,
  protocol: 'http',
  request: { method, url: '{{baseUrl}}/x', headers: {}, body },
});
const tree: TreeNode[] = [
  {
    kind: 'folder',
    id: 'fs:otp',
    name: 'Auth · OTP',
    expanded: true,
    children: [
      req('fs:otp/login', 'Login'),
      req('fs:otp/send', 'Send OTP'),
      req('fs:otp/verify', 'Verify OTP', 'POST', '{"code":"{{otp}}"}'),
    ],
  },
  { kind: 'folder', id: 'fs:auth', name: 'Auth', expanded: true, children: [req('fs:auth/refresh', 'Refresh token')] },
];
const scenario = { name: 'Auth · OTP', paths: ['otp', 'auth/refresh', 'otp/login'] } as Scenario;

describe('sessionView', () => {
  it('lists a scenario’s requests once, folders expanded in tree order', () => {
    expect(scenarioRequests(scenario, tree).map((r) => r.name)).toEqual([
      'Login',
      'Send OTP',
      'Verify OTP',
      'Refresh token',
    ]);
    expect(scenarioRequests(undefined, tree)).toEqual([]);
  });

  it('counts the steps that ask for typed input', () => {
    expect(askedSteps(scenarioRequests(scenario, tree), ['otp'])).toBe(1);
    expect(askedSteps(scenarioRequests(scenario, tree), [])).toBe(0);
  });

  it('names nodes from the tree, else from the id', () => {
    expect(nodeLabel(tree, 'fs:auth/refresh')).toBe('Refresh token');
    expect(nodeLabel(tree, 'fs:gone/Old.bonk.json')).toBe('Old');
    expect(nodeOptions(tree).slice(0, 2)).toEqual([
      { rel: 'otp', label: 'Auth · OTP' },
      { rel: 'otp/login', label: 'Auth · OTP / Login' },
    ]);
  });

  it('says what is missing to sign in', () => {
    expect(sessionMissing(undefined)).toEqual([
      'session.s.m.login',
      'session.s.m.accessRequest',
      'session.s.m.accessPath',
    ]);
    expect(sessionMissing({ login: 'Auth · OTP', access: { request: 'fs:otp/verify', path: 'body.t' } })).toEqual([]);
  });

  it('turns a renewal trace and the send into timeline lines', () => {
    const at = new Date(2026, 9, 12, 13, 6, 2, 114).getTime();
    const exp = Math.floor(at / 1000) - 120;
    const lines = timelineLines(
      [
        { kind: 'expired', at: at - 4, exp, why: 'expired' },
        { kind: 'renew', at, request: 'Refresh token', status: '200', ms: 140, ok: true },
      ],
      { sent: { text: 'GET {{baseUrl}}/v1/payments', status: 200, ms: 128 }, at: at + 187 },
      'POST',
    );
    expect(lines.map((l) => [l.at, l.icon, l.meta])).toEqual([
      ['13:06:02.110', 'schedule', expect.stringMatching(/^exp \d\d:\d\d:\d\d$/)],
      ['13:06:02.114', 'autorenew', '200 · 140 ms'],
      ['13:06:02.301', 'send', '200 · 128 ms'],
    ]);
    expect(lines[1].what).toBe('POST Refresh token  ·  {{session.refresh}}');
  });

  it('marks a dead refresh and the send that waits for the sign-in', () => {
    const prompt: SessionPrompt = {
      scenario: 'Auth · OTP',
      environment: 'Staging',
      steps: [
        { name: 'Login', state: 'done' },
        { name: 'Send OTP', state: 'done' },
        { name: 'Verify OTP', state: 'now' },
      ],
      trace: [{ kind: 'renew', at: 0, request: 'Refresh token', status: '401', ms: 61, ok: false }],
    };
    const lines = promptLines(prompt, 'GET {{baseUrl}}/v1/payments');
    expect(lines.map((l) => [l.icon, l.metaTone])).toEqual([
      ['autorenew', 'danger'],
      ['play_circle', 'ask'],
      ['hourglass_empty', 'ask'],
    ]);
    expect(lines[1].what).toBe('Auth · OTP:  Login → Send OTP');
    expect(lines[2].at).toBe('—');
  });

  it('joins step names for a sentence', () => {
    expect(joinNames(['Login'])).toBe('Login');
    expect(joinNames(['Login', 'Send OTP', 'Verify OTP'])).toMatch(/^Login, Send OTP \S+ Verify OTP$/);
  });
});
