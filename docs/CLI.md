# bonk-cli: Bonk from the terminal and CI

Runs Bonk collections from a terminal or CI on the same engine as the app's Runner
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

Variables, later wins: the app's globals → `BONK_VAR_<NAME>` → the `--env` environment
→ `--var NAME=VALUE` → the data row. The app's globals and environments come from its
state.json (`--app-state` to point elsewhere); secret values from the OS keychain.

Secrets: put them in `BONK_VAR_<NAME>`, not `--var`. Their values, and the app's secret
variables, are replaced by `<redacted>` in everything bonk-cli prints and in the
`--junit` / `--json` reports (CI logs and artifacts are widely readable).

Not yet: the app's proxy / CA / client-certificate settings (the system proxy is used;
`-k` skips TLS checks).
