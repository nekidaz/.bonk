# bonk-cli: Bonk from the terminal and CI

Runs Bonk collections from a terminal or CI on the same engine as the app's Send, unary Invoke and Runner
(bonk-core's runner): the same pre-request/test scripts, `{{vars}}`, folder auth and
tests. No login, no cloud: it reads the workspace folder directly.

## Install

```bash
brew install nekidaz/tap/bonk   # macOS arm64, Linux x64 (the app is `--cask nekidaz/tap/bonk`)
```

Or from a release ([nekidaz/.bonk](https://github.com/nekidaz/.bonk/releases)): an archive
per platform with a single `bonk` binary (`bonk.exe` on Windows):

```bash
curl -L https://github.com/nekidaz/.bonk/releases/latest/download/bonk-aarch64-apple-darwin.tar.gz | tar -xz
sudo mv bonk /usr/local/bin/
```

Linux: `bonk-x86_64-unknown-linux-gnu.tar.gz`; Windows: `bonk-x86_64-pc-windows-msvc.zip`. In
this repo the binary is `bonk-cli` (`make cli ARGS="run ./api"`): the desktop app already
builds as `bonk`. The examples below say `bonk`.

## Use

```bash
# the whole workspace (run from its root)
bonk run

# a folder and one request, with an environment saved in the Bonk app
bonk run api/users api/health.bonk.json --env Staging

# CI: variables from the pipeline, stop at the first failure, a JUnit report
BONK_VAR_TOKEN=$TOKEN bonk run api --var base=https://staging.example.com --bail --junit report.xml

# data-driven: one iteration per CSV/JSON row (pm.iterationData)
bonk run checkout --data users.csv
```

Exit code: `0` every request passed, `1` something failed (status, test or script),
`2` the run couldn't start (bad path, unknown environment, invalid data file).

Variables, later wins: the app's globals → scenario globals → scenario environment
→ the `--env` environment → `BONK_VAR_<NAME>` → `--var NAME=VALUE` → the data row. The app's globals and environments come from its
state.json (`--app-state` to point elsewhere); secret values from the OS keychain.

Secrets: put them in `BONK_VAR_<NAME>`, not `--var`. Their values, and the app's secret
variables, are replaced by `<redacted>` in everything bonk-cli prints and in the
`--junit` / `--json` reports (CI logs and artifacts are widely readable).

Not yet: the app's proxy / CA / client-certificate settings (the system proxy is used;
`-k` skips TLS checks).


## Portable workspace scenarios

In Runner, configure the request selection/order, data rows and environment, then
choose **Save to workspace**. The setup goes to `.bonk/scenarios.json` (version 1),
with relative request paths, public variable defaults, dynamic-variable locale/seed, iterations, delay and bail
settings. Secret rows contribute required variable names; their values are omitted.
Secret-named data columns are omitted too. Existing local presets remain readable;
open one and save it to move its setup into the workspace.

Commit the request files, `.folder.bonk.json` auth placeholders, the scenario file,
and any workspace-local proto or upload files. Their references are relative to
the workspace. CLI paths with `--workspace` resolve from that root, not the shell's
current directory.

```bash
# Repeat the exact committed setup from any directory, with CI supplying the secret.
BONK_VAR_TOKEN="$TOKEN" bonk run --workspace ./api --scenario 'Payments · Staging' \
  --junit report.xml --json report.json

# Explicit overrides: environment, iteration data, delay, iteration count or bail.
bonk run --workspace ./api --scenario smoke --env Staging --data cases.csv --delay 100
```

A scenario run does **not** read the desktop state automatically. `--env` or
`--app-state` explicitly enables it; without those flags, the clone and CI variables
are enough. Missing required variables refuse the run before any request (exit 2).
HTTP 2xx/3xx succeeds when scripts/tests pass; auth, transport or script failures
exit 1. Each run has an isolated in-memory cookie jar, including `pm.cookies` and
script cookie clears; no desktop cookie file is changed.

MCP clients can call `run_scenario` with the same name, optional `variables` and an
allowed `environment`. The existing network, host and mutating-method policies
still apply. MCP uses a run-local copy of desktop cookies when configured and
redacts required variables from results, including later script writes.

`bonk import export.json --workspace ./api` imports request definitions from a
version-1 **Bonk JSON workspace export**, through the same Rust persistence use case
as the desktop importer. It preserves collection order and folder auth, chooses a
new folder if the name exists, and removes a partial import on error. Environment
values from the export stay local; put public defaults in a scenario. Postman,
OpenAPI, HAR and cURL parsing remains in the desktop import window.

The scenario format stores execution intent, not machine-specific proxy, CA or
client-certificate settings. Desktop streaming gRPC retains its interactive
session controls; CLI and MCP execute unary calls.

## Verified import-to-CI journey

`src/features/import/portableRun.test.ts`, included in `make check` and CI, runs
the real Postman parser and import plan, persists through the production CLI/core
importer, configures inherited auth, and runs against a localhost API. It commits
the workspace in a temporary Git repository, clones it, and repeats the scenario
through the real CLI and MCP binaries from another working directory. It checks
request order, script patches/writes, cookies, data rows, relative uploads, equal
tests/statuses, fixed-seed dynamic values, exit codes, secret redaction and the MCP no-network policy.
