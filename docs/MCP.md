# Bonk MCP server

`bonk-mcp` lets any Model Context Protocol client use a Bonk workspace as an API
collection and execution engine. The desktop app does not need to be running.

## One-click desktop setup

Released Bonk desktop builds bundle the native MCP server. To connect every
supported local client in one action:

1. Open the workspace the AI should use.
2. Open **Settings → AI / MCP**.
3. Choose **Allow workspace edits**, **Allow API calls**, and an optional target
   host allowlist.
4. Click **Install for all clients**, then restart the configured AI apps.

Bonk detects and configures Claude Desktop, Claude Code, and ChatGPT/Codex. It
copies the bundled server to a versioned, stable path in Bonk's per-user app data
directory, so clients do not depend on the desktop app's launch path. Clicking
the button again updates the binary, workspace, and permissions.

Existing client configuration is preserved. Before Bonk first changes a JSON or
TOML config, it creates a sibling `*.bonk-backup`; writes are atomic and private
to the current OS user. **Remove from clients** removes only the `bonk` MCP entry.

This local setup covers the ChatGPT desktop app and Codex clients, which share
the same local MCP configuration. ChatGPT web does not read local configuration;
use a hosted plugin or the remote setup below for web chats.

## Capabilities

The server exposes:

- Resources: a redacted workspace index and every saved request as
  `bonk://...` JSON resources.
- Workspace tools: list, read, create/update, create folder, rename, move,
  duplicate, and delete.
- HTTP tools: validate an inline request, send one, or run a saved request.
- gRPC tools: reflection, local `.proto` compilation, example generation, unary
  calls, and saved-request execution.
- Runtime parity: query/body modes, bearer/basic/API-key auth,
  `{{VARIABLES}}`, multipart files, pre-request scripts, and test scripts.

Tool definitions include MCP `readOnlyHint`, `destructiveHint`,
`idempotentHint`, and `openWorldHint` annotations so compatible clients can make
better approval decisions.

## Manual build and install

From the Bonk repository:

```sh
cargo build --release -p bonk-mcp
```

The executable is:

```text
/absolute/path/to/bonk/target/release/bonk-mcp
```

Convenience scripts are also available as `npm run build:mcp` and
`npm run mcp -- --workspace /absolute/path/to/workspace`.

You can also install it into Cargo's binary directory:

```sh
cargo install --path crates/bonk-mcp --locked
```

Tagged Bonk releases also publish standalone `bonk-mcp` executables for Apple
Silicon macOS, x86-64 Linux, and x86-64 Windows.

Every launch requires one existing workspace:

```sh
bonk-mcp --workspace /absolute/path/to/my-api-workspace
```

STDIO is the default. Writing requests and network calls are enabled because
those are the core API-client operations. Restrict them when appropriate:

```sh
# Inspect only; no file changes and no network
bonk-mcp --workspace /path/to/workspace --read-only --no-network

# Permit calls only to selected API hosts
bonk-mcp --workspace /path/to/workspace \
  --target-host api.example.com \
  --target-host '*.internal.example.com'
```

## Variables and secrets

Use placeholders in request files:

```json
{
  "headers": {
    "Authorization": "Bearer {{TOKEN}}"
  }
}
```

Process variables beginning with `BONK_VAR_` are available without their values
being listed to the model:

```sh
BONK_VAR_TOKEN='secret' bonk-mcp --workspace /path/to/workspace
```

`BONK_VAR_TOKEN` resolves `{{TOKEN}}`. Change the prefix with
`--variable-prefix`. A tool call can also pass a `variables` object; those
values are necessarily visible to the model/client and are better suited to
non-secret values.

`get_request` and MCP resources redact stored Authorization, cookies, API keys,
passwords, and tokens. Returning `includeSecrets=true` additionally requires the
server operator to launch with `--expose-secrets`; it is disabled by default.
Responses, script logs, and test errors are scrubbed for process-supplied secret
values. Do not hard-code credentials in `.bonk.json`; placeholders remain the
safer design.

Multipart files and `.proto` files are restricted to the configured workspace,
including after symlink resolution.

## ChatGPT desktop and Codex

If you are not using Bonk's one-click installer, build the release binary and
then either use **Settings → MCP servers → Add server** in the ChatGPT desktop
app or run:

```sh
codex mcp add bonk \
  --env BONK_VAR_TOKEN=replace-me \
  -- /absolute/path/to/bonk-mcp \
  --workspace /absolute/path/to/workspace \
  --target-host api.example.com
```

The equivalent project-scoped `.codex/config.toml` is:

```toml
[mcp_servers.bonk]
command = "/absolute/path/to/bonk-mcp"
args = [
  "--workspace", "/absolute/path/to/workspace",
  "--target-host", "api.example.com",
]
env = { BONK_VAR_TOKEN = "replace-me" }
```

A copyable version lives at
[`examples/mcp/codex.config.toml`](../examples/mcp/codex.config.toml).

The ChatGPT desktop app, Codex CLI, and Codex IDE extension share MCP
configuration on the same Codex host. Restart the client after adding a server,
then use `/mcp` where available to verify the tools.

## Claude Desktop

Add a local STDIO server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bonk": {
      "command": "/absolute/path/to/bonk-mcp",
      "args": [
        "--workspace", "/absolute/path/to/workspace",
        "--target-host", "api.example.com"
      ],
      "env": {
        "BONK_VAR_TOKEN": "replace-me"
      }
    }
  }
}
```

Restart Claude Desktop after editing the configuration. Newer Claude Desktop
versions can also package a native binary such as `bonk-mcp` as an MCPB desktop
extension; the direct STDIO configuration is useful for development.

A copyable version lives at
[`examples/mcp/claude_desktop_config.json`](../examples/mcp/claude_desktop_config.json).

## Claude Code

```sh
claude mcp add bonk \
  --env BONK_VAR_TOKEN=replace-me \
  -- /absolute/path/to/bonk-mcp \
  --workspace /absolute/path/to/workspace \
  --target-host api.example.com

claude mcp get bonk
```

## Other local MCP clients

Most STDIO clients accept the same shape:

```json
{
  "command": "/absolute/path/to/bonk-mcp",
  "args": ["--workspace", "/absolute/path/to/workspace"],
  "env": {"BONK_VAR_TOKEN": "replace-me"}
}
```

## Streamable HTTP

For a local HTTP endpoint:

```sh
BONK_MCP_TOKEN='long-random-token' \
bonk-mcp --workspace /path/to/workspace \
  --target-host api.example.com \
  http --bind 127.0.0.1:8000
```

Endpoints:

```text
GET  /health
POST /mcp
```

When `BONK_MCP_TOKEN` is set, every endpoint requires:

```http
Authorization: Bearer long-random-token
```

The server refuses a non-loopback bind unless:

- the configured token environment variable is present;
- at least one inbound `--mcp-host` is supplied for DNS-rebinding protection;
- outbound APIs are constrained by `--target-host`, or the operator explicitly
  passes `--allow-all-targets`.

Example behind an HTTPS reverse proxy:

```sh
BONK_MCP_TOKEN='long-random-token' \
bonk-mcp --workspace /srv/bonk/workspace \
  --target-host api.example.com \
  http --bind 0.0.0.0:8000 \
  --mcp-host mcp.example.com \
  --origin https://chatgpt.com
```

Terminate TLS at the reverse proxy and expose
`https://mcp.example.com/mcp`. Do not expose the plain HTTP listener directly to
the internet.

### OpenAI Responses API

The Responses API accepts remote Streamable HTTP MCP servers. A minimal tool
entry is:

```json
{
  "type": "mcp",
  "server_label": "bonk",
  "server_description": "Build and run API requests stored in Bonk",
  "server_url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  },
  "require_approval": "always"
}
```

Keep approval enabled for `send_http`, `run_saved_request`, `grpc_call`, and
workspace mutations. Use `allowed_tools` when a workflow needs only a subset.
The tool object is also available at
[`examples/mcp/openai-responses.json`](../examples/mcp/openai-responses.json).

### ChatGPT web and Claude.ai

Web clients do not start a binary on your laptop. They require a remotely
reachable HTTPS MCP server supplied through their plugin/custom-connector flow.
For a shared or production connector, put Bonk behind an OAuth-capable gateway;
a fixed bearer token is intended for private API integration and testing. The
workspace administrator may also need to approve the plugin/connector.

## CLI reference

```sh
bonk-mcp --help
bonk-mcp http --help
```

Important options:

| Option | Effect |
| --- | --- |
| `--workspace DIR` | Canonical workspace boundary; required |
| `--read-only` | Disable every filesystem mutation tool |
| `--expose-secrets` | Allow explicit reads of literal stored credentials; disabled by default |
| `--no-network` | Disable HTTP calls, gRPC calls, and reflection |
| `--target-host HOST` | Outbound host/port allowlist; repeatable; supports `*.domain` |
| `--allow-all-targets` | Explicitly permit any outbound target |
| `--variable-prefix PREFIX` | Process-secret prefix; default `BONK_VAR_` |
| `--max-response-body-bytes N` | Response ceiling, 1 MiB to 250 MiB |
| `http --bind ADDRESS` | Enable Streamable HTTP instead of STDIO |
| `http --mcp-host HOST` | Accepted inbound Host header |
| `http --origin URL` | Accepted browser Origin |
| `http --auth-token-env NAME` | Bearer-token environment variable |

## Suggested agent workflow

1. Call `workspace_info` and `list_workspace` or `list_requests`.
2. Read a relevant request with `get_request`.
3. Build an inline request or save a new one with placeholders.
4. Call `validate_http` before the first HTTP execution.
5. Ask for user approval before network or destructive tools.
6. Call `send_http`/`run_saved_request`, inspect tests, then save corrections.

## Client documentation

- [OpenAI: MCP setup for ChatGPT desktop and Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [OpenAI: remote MCP tools in the Responses API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Anthropic: local MCP servers in Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Anthropic: remote MCP custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
