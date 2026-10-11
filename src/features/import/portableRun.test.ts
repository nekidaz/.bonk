/** Cross-language/process contract: the real importer, Rust storage, Git and headless frontends. */
import { beforeAll, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { buildWorkspaceExport } from '$entities/workspace';
import { scenarioVariables, type Scenario, type TreeNode } from '$shared/model';
import { loadSource } from './source';
import { collectionPlan, type PlanItem } from './plan';

const exec = promisify(execFile);
const target = resolve(process.env.CARGO_TARGET_DIR ?? 'target', 'debug');
const binary = (name: string) => join(target, name + (process.platform === 'win32' ? '.exe' : ''));

beforeAll(async () => {
  await exec('cargo', ['build', '-p', 'bonk-cli', '-p', 'bonk-mcp'], { maxBuffer: 8 * 1024 * 1024 });
}, 600_000);

function mcp(binary: string, workspace: string, env: NodeJS.ProcessEnv, extra: string[] = []) {
  const child = spawn(
    binary,
    ['--workspace', workspace, '--target-host', '127.0.0.1', '--mutating-methods', 'allow', ...extra, 'stdio'],
    { env },
  );
  // Windows keeps the executable locked until the process and its pipes close.
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let id = 0;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  child.on('exit', () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`MCP exited: ${stderr}`));
    }
    pending.clear();
  });
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(new Error(`MCP timeout: ${method}`));
      }, 15_000);
      pending.set(next, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
    });
  return {
    request,
    initialized: () =>
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'),
    close: async () => {
      for (const waiter of pending.values()) clearTimeout(waiter.timer);
      pending.clear();
      lines.close();
      child.kill();
      await closed;
    },
  };
}

it('imports, configures auth, runs, commits and repeats the same scenario from a clean CI clone via CLI and MCP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bonk-portable-'));
  const workspace = join(dir, 'workspace'),
    clone = join(dir, 'ci');
  const secret = 'ci-only-secret';
  const seen: { path: string; auth?: string; cookie?: string; case?: string; guid?: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const upload = Buffer.concat(chunks).toString();
    seen.push({
      path: req.url ?? '',
      auth: req.headers.authorization,
      cookie: req.headers.cookie,
      case: req.headers['x-case'] as string,
      guid: req.headers['x-guid'] as string,
    });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (req.url?.startsWith('/seed/')) {
      res.setHeader('set-cookie', 'session=local-session; Path=/; HttpOnly');
      res.end(JSON.stringify({ id: '123' }));
    } else if (req.url === '/me/123') {
      res.end(
        JSON.stringify({
          auth: req.headers.authorization,
          cookie: req.headers.cookie,
          case: req.headers['x-case'],
          upload,
        }),
      );
    } else {
      res.writeHead(404);
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no address');
  const base = `http://127.0.0.1:${address.port}`;
  let client: ReturnType<typeof mcp> | undefined;
  try {
    await mkdir(workspace);
    const cli = join(dir, 'bonk-cli' + (process.platform === 'win32' ? '.exe' : ''));
    const mcpBin = join(dir, 'bonk-mcp' + (process.platform === 'win32' ? '.exe' : ''));
    await copyFile(binary('bonk-cli'), cli);
    await copyFile(binary('bonk-mcp'), mcpBin);
    const source = loadSource(
      JSON.stringify({
        info: { name: 'Imported', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'z-seed',
            request: { method: 'GET', url: '{{base}}/seed', auth: { type: 'inherit' } },
            event: [
              { listen: 'prerequest', script: { exec: ["pm.request.url = '{{base}}/seed/{{case}}';"] } },
              {
                listen: 'test',
                script: {
                  exec: [
                    "pm.environment.set('id', pm.response.json().id); pm.test('seed', function(){ pm.expect(pm.response.code).to.equal(200); });",
                  ],
                },
              },
            ],
          },
          {
            name: 'a-me',
            request: { method: 'POST', url: '{{base}}/me/{{id}}', auth: { type: 'inherit' } },
            event: [
              {
                listen: 'prerequest',
                script: {
                  exec: [
                    "pm.request.headers.add('x-case', pm.iterationData.get('case')); pm.request.headers.add('x-guid', '{{$guid}}'); pm.test('cookie in script', function(){ pm.expect(pm.cookies.has('session')).to.equal(true); });",
                  ],
                },
              },
              {
                listen: 'test',
                script: {
                  exec: [
                    "console.log(pm.response.json().auth); pm.test('authenticated session', function(){ pm.expect(pm.response.json().cookie).to.equal('session=local-session'); pm.expect(pm.response.json().case).to.equal(pm.iterationData.get('case')); pm.expect(pm.response.json().upload).to.equal('portable upload'); });",
                  ],
                },
              },
            ],
          },
        ],
      }),
      { kind: 'paste', location: '', name: '', size: 0 },
    );
    if (source.format !== 'postman') throw new Error('wrong importer');
    const plan = collectionPlan(source.collection);
    const nodes = (items: PlanItem[]): TreeNode[] =>
      items.map((item) =>
        item.kind === 'folder'
          ? { kind: 'folder', id: '', name: item.name, expanded: false, children: nodes(item.items) }
          : item.node,
      );
    const exported = join(dir, 'import.json');
    await writeFile(exported, buildWorkspaceExport(plan.title, nodes(plan.items), [], [], false));
    await exec(cli, ['import', exported, '--workspace', workspace]);
    // Folder auth is configured after import and committed as placeholders.
    const settingsFile = join(workspace, 'Imported', '.folder.bonk.json');
    const folder = JSON.parse(await readFile(settingsFile, 'utf8'));
    folder.auth = { type: 'bearer', bearerToken: '{{TOKEN}}' };
    await writeFile(settingsFile, JSON.stringify(folder, null, 2));
    await writeFile(join(workspace, 'payload.bin'), 'portable upload');
    const meFile = join(workspace, 'Imported', 'a-me.bonk.json');
    const me = JSON.parse(await readFile(meFile, 'utf8'));
    me.request.bodyMode = 'binary';
    me.request.binaryFilePath = 'payload.bin';
    await writeFile(meFile, JSON.stringify(me, null, 2));
    const scenario: Scenario = {
      name: 'smoke',
      paths: ['Imported'],
      environmentName: 'Local',
      ...scenarioVariables(
        [],
        [
          { key: 'base', value: base, enabled: true },
          { key: 'TOKEN', value: secret, secret: true, enabled: true },
        ],
      ),
      iterations: 1,
      dynamic: { locale: 'ru', perRequest: true, seed: 42 },
      dataRows: [{ case: 'first' }, { case: 'second' }],
      delayMs: 0,
      stopOnFailure: true,
    };
    await mkdir(join(workspace, '.bonk'));
    const setup = JSON.stringify({ version: 1, scenarios: [scenario] }, null, 2);
    expect(setup).not.toContain(secret);
    await writeFile(join(workspace, '.bonk', 'scenarios.json'), setup);
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BONK_VAR_'))),
      BONK_VAR_TOKEN: secret,
    };
    const run = async (root: string, name: string) => {
      const report = join(dir, `${name}.json`),
        junit = join(dir, `${name}.xml`);
      const output = await exec(
        cli,
        ['run', '--workspace', root, '--scenario', 'smoke', '--json', report, '--junit', junit],
        { cwd: dir, env },
      );
      const reportText = await readFile(report, 'utf8');
      expect(reportText + output.stdout + (await readFile(junit, 'utf8'))).not.toContain(secret);
      const result = JSON.parse(reportText);
      expect(result.results ?? result.rows).toHaveLength(4);
      expect(await readFile(junit, 'utf8')).toContain('failures="0"');
      return result;
    };
    const local = await run(workspace, 'local');
    await exec('git', ['init', '--quiet', workspace]);
    await exec('git', ['-C', workspace, 'add', '.']);
    await exec('git', [
      '-C',
      workspace,
      '-c',
      'user.name=Bonk test',
      '-c',
      'user.email=bonk-test@localhost',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'test: portable workspace',
    ]);
    await exec('git', ['clone', '--quiet', '--no-local', workspace, clone]);
    const ci = await run(clone, 'ci');
    const stable = (report: any) =>
      (report.results ?? report.rows).map((row: any) => ({
        name: row.requestName,
        ok: row.ok,
        status: row.status,
        tests: row.tests,
      }));
    expect(stable(ci)).toEqual(stable(local));
    // Required secret failures are exit 2 and send nothing; auth/test failures are exit 1.
    const before = seen.length;
    const missingEnv: NodeJS.ProcessEnv = { ...env };
    delete missingEnv.BONK_VAR_TOKEN;
    await expect(
      exec(cli, ['run', '--workspace', clone, '--scenario', 'smoke'], { env: missingEnv, cwd: dir }),
    ).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('TOKEN') });
    expect(seen).toHaveLength(before);
    await expect(
      exec(cli, ['run', '--workspace', clone, '--scenario', 'smoke'], {
        env: { ...env, BONK_VAR_TOKEN: 'wrong' },
        cwd: dir,
      }),
    ).rejects.toMatchObject({ code: 1 });
    client = mcp(mcpBin, clone, env);
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'portable-run-test', version: '1' },
    });
    client.initialized();
    const tool = await client.request('tools/call', { name: 'run_scenario', arguments: { name: 'smoke' } });
    expect(tool.isError).not.toBe(true);
    const mcpResult = tool.structuredContent.result;
    expect(mcpResult.ok).toBe(true);
    expect(stable(mcpResult)).toEqual(stable(ci));
    expect(JSON.stringify(tool)).not.toContain(secret);
    await client.close();
    const callsBeforeDenial = seen.length;
    client = mcp(mcpBin, clone, env, ['--no-network']);
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'portable-run-test', version: '1' },
    });
    client.initialized();
    const denied = await client.request('tools/call', { name: 'run_scenario', arguments: { name: 'smoke' } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('network calls are disabled by --no-network');
    expect(seen).toHaveLength(callsBeforeDenial);
    expect((await exec('git', ['-C', clone, 'status', '--porcelain'])).stdout).toBe('');
    const guids = seen.filter((r) => r.path === '/me/123').map((r) => r.guid);
    expect(guids).toHaveLength(6);
    expect(guids.slice(2, 4)).toEqual(guids.slice(0, 2));
    expect(guids.slice(4, 6)).toEqual(guids.slice(0, 2));
    expect(guids[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(guids[0]).not.toBe(guids[1]);
    expect(seen.find((r) => r.path === '/seed/first')?.auth).toBe(`Bearer ${secret}`);
  } finally {
    await client?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
