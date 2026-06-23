# Security

Bonk is an API client, so saved requests can contain sensitive URLs, headers,
tokens, and request bodies.

## Reporting Vulnerabilities

Please report security issues privately through the repository maintainer's
preferred private channel or GitHub private vulnerability reporting when it is
enabled. Do not include secrets, tokens, or private endpoints in public issues.

## Handling Secrets

- Do not commit real API keys, bearer tokens, cookies, or production endpoints.
- Prefer environment variables or placeholder values in shared workspaces.
- Review saved `*.bonk.json` request files before committing them.

## Supported Versions

Security fixes are currently applied to the latest development version.
