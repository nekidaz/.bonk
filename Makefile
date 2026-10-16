# bonk — one entry point for everything. `make` (no args) lists targets.
# Mirrors .github/workflows/ci.yml: if `make check` is green, CI is green.

.DEFAULT_GOAL := help
.PHONY: help setup dev ui mcp cli check lint fe-check test test-ts test-rs build visual visual-baseline css-oracle css-oracle-baseline fmt sidecar bump demo

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-16s %s\n", $$1, $$2}'

setup: ## install deps (npm ci) and fetch Rust crates
	npm ci
	cargo fetch

dev: ## run the desktop app with hot reload (tauri dev)
	npm run app

ui: ## frontend only in a browser, no Rust backend (http://localhost:1420)
	npm run dev

mcp: ## run the headless MCP server (pass args: make mcp ARGS="--help")
	cargo run -p bonk-mcp -- $(ARGS)

cli: ## run the CLI (pass args: make cli ARGS="run ./api --env Staging")
	cargo run -p bonk-cli -- $(ARGS)

sidecar: # stage the MCP sidecar binary — src-tauri's build.rs refuses to build without it
	node scripts/prepare-mcp-sidecar.mjs

check: lint test build ## everything CI runs

lint: sidecar ## svelte-check (TS types) + prettier/rustfmt check + clippy (warnings = errors)
	npm run check
	npx prettier --check .
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings

fe-check: ## quick frontend check after a UI edit: types (svelte-check) + formatting of src/; no UI tests
	npm run check
	npx prettier --check src

test: test-ts test-rs ## all tests

test-ts: ## vitest (UTC like CI — some tests format dates)
	TZ=UTC npx vitest run --exclude '.claude/**'

test-rs: sidecar ## cargo test for the whole workspace
	cargo test --workspace

build: ## production frontend bundle (dist/)
	npm run build

visual-baseline: build ## capture screenshots of the current UI as the baseline
	rm -rf visual/__screenshots__
	npx playwright test --update-snapshots

visual: build ## compare the UI against the baseline; diff report in visual/report
	npx playwright test

css-oracle-baseline: build ## dump computed styles of every scenario (+hover/focus/active) as the baseline
	rm -rf visual/css-oracle/baseline
	CSS_ORACLE=visual/css-oracle/baseline npx playwright test --workers=2 --reporter=dot

css-oracle: build ## compare computed styles against the css-oracle baseline (stricter than make visual)
	rm -rf visual/css-oracle/current
	CSS_ORACLE=visual/css-oracle/current npx playwright test --workers=2 --reporter=dot
	node visual/css-oracle-diff.mjs visual/css-oracle/baseline visual/css-oracle/current

demo: build ## landing: rebuild the live demo (docs/landing/demo) and its screenshots
	node scripts/build-demo.mjs
	node scripts/capture-screenshots.mjs --demo

fmt: ## format everything: Rust (rustfmt) + TS/Svelte/CSS (prettier)
	cargo fmt --all
	npx prettier --write .

bump: ## set version everywhere: make bump V=0.1.9
	@test -n "$(V)" || { echo "usage: make bump V=x.y.z"; exit 1; }
	npm version $(V) --no-git-tag-version --allow-same-version >/dev/null
	sed -i '' -E '1,/"version"/s/"version": "[^"]+"/"version": "$(V)"/' src-tauri/tauri.conf.json
	sed -i '' -E '1,/^version = /s/^version = ".*"/version = "$(V)"/' src-tauri/Cargo.toml crates/bonk-core/Cargo.toml crates/bonk-mcp/Cargo.toml crates/bonk-cli/Cargo.toml
	cargo update --workspace --offline -q
	@git diff --stat
	@echo "now: add a '## [$(V)]' section to CHANGELOG.md, then see RELEASING.md"
