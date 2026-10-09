# bonk — one entry point for everything. `make` (no args) lists targets.
# Mirrors .github/workflows/ci.yml: if `make check` is green, CI is green.

.DEFAULT_GOAL := help
.PHONY: help setup dev ui mcp check lint test test-ts test-rs build fmt sidecar bump

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

setup: ## install deps (npm ci) and fetch Rust crates
	npm ci
	cargo fetch

dev: ## run the desktop app with hot reload (tauri dev)
	npm run app

ui: ## frontend only in a browser, no Rust backend (http://localhost:1420)
	npm run dev

mcp: ## run the headless MCP server (pass args: make mcp ARGS="--help")
	cargo run -p bonk-mcp -- $(ARGS)

sidecar: # stage the MCP sidecar binary — src-tauri's build.rs refuses to build without it
	node scripts/prepare-mcp-sidecar.mjs

check: lint test build ## everything CI runs

lint: sidecar ## svelte-check (TS types) + clippy (warnings = errors)
	npm run check
	cargo clippy --workspace --all-targets -- -D warnings

test: test-ts test-rs ## all tests

test-ts: ## vitest (UTC like CI — some tests format dates)
	TZ=UTC npx vitest run --exclude '.claude/**'

test-rs: sidecar ## cargo test for the whole workspace
	cargo test --workspace

build: ## production frontend bundle (dist/)
	npm run build

fmt: ## format Rust code
	cargo fmt --all

bump: ## set version everywhere: make bump V=0.1.9
	@test -n "$(V)" || { echo "usage: make bump V=x.y.z"; exit 1; }
	npm version $(V) --no-git-tag-version --allow-same-version >/dev/null
	sed -i '' -E '1,/"version"/s/"version": "[^"]+"/"version": "$(V)"/' src-tauri/tauri.conf.json
	sed -i '' -E '1,/^version = /s/^version = ".*"/version = "$(V)"/' src-tauri/Cargo.toml crates/bonk-core/Cargo.toml crates/bonk-mcp/Cargo.toml
	cargo update --workspace --offline -q
	@git diff --stat
	@echo "now: add a '## [$(V)]' section to CHANGELOG.md, then see RELEASING.md"
