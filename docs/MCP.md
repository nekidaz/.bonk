# Connect an AI assistant to Bonk

Bonk bundles a native `bonk-mcp` server. It gives compatible Model Context
Protocol clients access to a selected API workspace, including HTTP and gRPC
requests. The desktop app does not need to stay open after configuration.

## Desktop setup

1. Open the Bonk workspace the assistant should use.
2. Open **Settings → AI / MCP**.
3. Choose the environment for variable resolution.
4. Select whether to **Allow workspace edits** and **Allow API calls**.
5. Optionally enter a target-host allowlist.
6. Click **Install for all clients**, then restart the configured apps.

The setup panel lists the local clients Bonk detects. It copies the bundled
server into a stable per-user application-data location and configures the
workspace and permissions. Running setup again updates the integration.

Unrelated configuration entries are preserved. Before the first configuration
edit, Bonk creates a sibling `*.bonk-backup`. **Remove from clients** removes
only Bonk's integration entry.

## What an assistant can do

| Capability | Examples |
| --- | --- |
| Inspect | List folders and requests; read the workspace index and request resources. |
| Edit, when allowed | Create, update, rename, move, duplicate, or delete requests and folders. |
| HTTP, when allowed | Validate an inline request, send it, or execute a saved request. |
| gRPC, when allowed | Explore reflected services, compile local `.proto` schemas, generate message templates, and run unary calls. |
| Scripts & variables | Resolve `{{variables}}`, apply the selected environment, and run Bonk pre-request and response scripts. |

Example prompts:

> List the saved requests in this workspace and explain which environment variables they need.

> Inspect the gRPC service and create a request for its health-check method.

> Add a response-status assertion to the existing health request.

File edits and network calls depend on the configured permissions.

## Standalone server

The [latest release](https://github.com/nekidaz/.bonk/releases/latest) includes
standalone executables for Apple Silicon macOS, x86-64 Linux, and Windows x64.
Download the `bonk-mcp` asset for your platform, and make it executable where
required. Use the actual file path in your client's server configuration.

The server requires an existing workspace directory:

```sh
bonk-mcp --workspace /absolute/path/to/my-api-workspace
```

STDIO is the default transport. A client that accepts an `mcpServers` JSON
configuration can use a shape like this:

```json
{
  "mcpServers": {
    "bonk": {
      "command": "/absolute/path/to/bonk-mcp",
      "args": [
        "--workspace", "/absolute/path/to/my-api-workspace",
        "--read-only",
        "--no-network"
      ]
    }
  }
}
```

Use your client's documented configuration format. Some clients use TOML or
other formats instead of the example above.

## Permissions

A standalone launch enables edits and API calls by default. For inspection only:

```sh
bonk-mcp --workspace /path/to/workspace --read-only --no-network
```

To limit network targets:

```sh
bonk-mcp --workspace /path/to/workspace \
  --target-host api.example.com \
  --target-host '*.internal.example.com'
```

Read-only mode blocks workspace mutation; disabling network access blocks API
execution. Stored credentials are redacted from inspection by default, and
workspace file operations are restricted to the selected workspace.

## Remote clients

The server also supports Streamable HTTP at `/mcp`. This allows compatible
remote clients to connect without reading desktop configuration files.
Use the binary's `--help` output for the current transport and authentication
options. Remote deployment requires its own reachable endpoint and access
configuration; installing a local integration does not publish your workspace.
