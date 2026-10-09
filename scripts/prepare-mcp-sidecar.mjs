import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const explicitTarget = process.argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repository, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const host =
  explicitTarget ??
  output('rustc', ['-vV'])
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice(6)
    .trim();
if (!host) throw new Error('Could not determine the Rust target triple');

const cargoArgs = ['build', '-p', 'bonk-mcp'];
if (release) cargoArgs.push('--release');
if (explicitTarget) cargoArgs.push('--target', explicitTarget);
run('cargo', cargoArgs);

const extension = host.includes('windows') ? '.exe' : '';
const profile = release ? 'release' : 'debug';
const source = explicitTarget
  ? join(repository, 'target', explicitTarget, profile, `bonk-mcp${extension}`)
  : join(repository, 'target', profile, `bonk-mcp${extension}`);
const destination = join(repository, 'src-tauri', 'binaries', `bonk-mcp-${host}${extension}`);
if (!existsSync(source)) throw new Error(`MCP binary was not built at ${source}`);

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
if (!extension) chmodSync(destination, 0o755);
console.log(`Prepared MCP sidecar: ${destination}`);
