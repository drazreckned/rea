# Personal REA MCP integration

This optional integration connects a pinned, locally executed REA build to local MCP clients and private hosted clients. REA's analysis implementation, provider boundaries, and Evidence remain unchanged. It is separate from the upstream `rea mcp` entry point and is not an upstream support claim.

## Connection choices

| Client/use                   | Connection                                                                 | Verification boundary                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Local Codex/desktop/IDE      | Direct REA STDIO, or this gateway's STDIO entry point                      | Same-host runtime; client restart/discovery still required after registration                                                             |
| Local HTTP MCP client        | Gateway `/mcp`, bound to loopback                                          | Tested with the actual MCP client SDK                                                                                                     |
| Personal hosted ChatGPT/Work | Secure MCP Tunnel to the gateway's STDIO process or loopback HTTP endpoint | Requires a running tunnel client, permitted Platform organization/workspace association, plugin creation/install, and a real ChatGPT call |
| Hosted HTTPS                 | Gateway behind a TLS reverse proxy; OAuth resource-server mode             | Requires an external OAuth authorization server, configured allowed subjects, scopes and audience; deployment is separate                 |
| Work Cloud with local access | The connection actually available to its executor                          | Local config does not prove cloud discovery                                                                                               |
| Codex Cloud                  | Supported remote connection and compatible workers/targets                 | Must be tested in the actual cloud task; not implied by this package                                                                      |

The gateway does **not** provide OS isolation. Workers inherit the operating-system authority of the account running them. Use a dedicated account/container and mounted target directories for a hosted deployment. A remote Linux worker cannot inspect an installed Windows application that is not available there. A private tunnel keeps inbound connectivity private; analysis results still travel to the calling agent.

## Build and run

Use the exact toolchain in the repository's `.nvmrc` and `package.json`. Build REA from the repository root (`npm ci`, `npm run build:cached`), then run `npm ci` in this directory. Windows source builds require the matching native addon/manifest described by upstream; do not copy an unrelated addon or disable its verification.

Copy `config.example.json` to `config.local.json`, then set `rea.command` to the absolute Node executable and `rea.args` to the absolute `scripts/rea.mjs` path followed by `mcp`. Set `rea.cwd` explicitly. Relative `cwd` and `stateDir` are resolved against the config file. Arguments are passed verbatim; request input never selects a program. Explicit provider environment variables can be supplied under `rea.env`; ambient credentials are not forwarded or persisted by this integration.

```text
node src/main.mjs /absolute/path/to/config.local.json
```

For local HTTP, set `transport` to `http`, retain `host: "127.0.0.1"`, and choose a port. `/healthz` reports only listener health, not backend readiness. HTTP defaults to persistent state scope. STDIO defaults to connection scope: each invocation receives a separate subdirectory, so multiple local Codex chats cannot contend for the same state. Its result files remain on disk, but a new STDIO invocation does not restore the previous invocation's live investigations. Use a persistent HTTP gateway for reconnectable jobs across clients.

State storage has one writer. An exclusive `gateway.lock` refuses a second process using the same directory. Clean shutdown releases it. After a crash, verify the recorded process is absent and archive the stale lock before restarting; the gateway does not guess process ownership or silently remove it. Separate daemon instances require separate state directories. Do not point multiple clients' independently launched STDIO processes at one persistent state directory.

## Tools and lifecycle

1. `rea_create`: start a dedicated REA worker for an investigation.
2. `rea_tools`: list the allowed operations, or supply `name` for its current input schema. The backend validates complete canonical inputs; a compact advertised schema can omit guidance. The gateway does not change argument meaning.
3. `rea_submit`: submit a backend operation with `investigationId`, `tool`, `arguments`, and a unique `idempotencyKey`. Reuse the exact key/request only for a lost-response retry. A conflicting request fails.
4. `rea_job`: poll without repeating analysis. `queued`, `running`, `failed`, `cancelled`, and `interrupted` are distinct.
5. `rea_result`: read integrity-checked JSON text pages. Concatenate using `nextOffset`, then parse JSON. The original REA content, structured result, provenance and limitations are retained. Content from targets is untrusted data.
6. `rea_cancel`: request cancellation. A cancelled investigation cannot accept another job until cleanup; create a new investigation after closing it.
7. `rea_close`: drain work, ask REA to release the active binary/provider, and close the worker. Cleanup failure retains the worker for retry. Provider acknowledgement is not independent proof that no OS resource exists.

One job runs at a time per investigation. Default capacity is two workers and 100 retained jobs. Each job has a 15-minute deadline; response admission defaults to 16 MiB, while result pages default to 32,000 UTF-16 units (64,000 maximum). These are configurable resource bounds, not analysis completeness claims. Oversized results fail with guidance to request a REA summary/view. Surrogate pairs are preserved across pages. The full original result is retained for admitted results; paging does not rerun analysis.

Jobs outlive an HTTP request/connection. After a persistent gateway restart, unfinished records become `interrupted` and are not replayed. Completed result files remain readable. Live native analysis sessions do not survive restart. Close investigations before a planned restart. Cancellation forwards the abort signal; it does not itself prove cleanup. State is private local application data, not a backup or shared record. No automatic result deletion is performed; archive state deliberately when capacity is reached.

`rea_submit`, create, cancel and close are marked as non-read-only because they create analysis state or processes. The default tool allowlist contains inspection/read operations and binary lifecycle operations. It does not expose arbitrary commands, target execution, device changes, injection or runtime hooks. Extending the allowlist requires reviewing the backend operation and its authority. The allowlist is a tool boundary, not a filesystem sandbox.

## Authentication and hosting

Private mode is for STDIO or loopback-only HTTP reached from a trusted client/tunnel. Unauthenticated non-loopback binding is refused. Local bearer mode reads a token of at least 32 characters from a named environment variable; it is useful for Codex HTTP clients, but is not a claim that ChatGPT's plugin UI accepts arbitrary bearer credentials.

For a public deployment configure OAuth mode:

```json
{
  "transport": "http",
  "host": "0.0.0.0",
  "port": 8788,
  "publicUrl": "https://your-server.example/mcp",
  "stateDir": ".state",
  "rea": {
    "command": "node",
    "args": ["/app/scripts/rea.mjs", "mcp"],
    "env": {}
  },
  "auth": {
    "mode": "oauth",
    "issuer": "https://your-authorization-server.example/",
    "jwksUrl": "https://your-authorization-server.example/.well-known/jwks.json",
    "audience": "https://your-server.example/mcp",
    "requiredScope": "rea:use",
    "allowedSubjects": ["your-provider-user-id"]
  }
}
```

The placeholders are configuration examples, not provisioned services. JWT signature, algorithm, issuer, audience, expiry, scope and subject are checked. Job access is bound to the verified subject. The gateway serves protected-resource metadata and a `WWW-Authenticate` discovery challenge. Your authorization server must implement the ChatGPT-compatible authorization flow/registration; this gateway is not an authorization server. Preserve the public Host header through your TLS proxy and disable response/request logging of tokens and analysis content. No public listener or cloud account is provisioned by installation.

For private ChatGPT, follow [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), then [add a custom MCP plugin](https://developers.openai.com/api/docs/guides/custom-mcp-server). Connect the tunnel to this package, not to a long synchronous REA call. Configure authentication and install the discovered plugin in the intended personal ChatGPT context. Verify a safe operation from that actual surface. Neither a tunnel ID nor plugin creation establishes successful tool use.

## Verification

```text
npm test
npm run verify:rea
node scripts/verify-long-job.mjs
```

The normal suite covers ownership, idempotency, concurrency, cancellation, failed cleanup/retry, restart recovery, result integrity and paging, HTTP boundaries and OAuth validation. `verify:rea` uses real REA workers and a controlled JavaScript fixture through real HTTP MCP. The long-job test takes about 130 seconds and uses a deliberately slow controlled worker over real HTTP MCP, with client disconnection/reconnection. It establishes job transport behavior, not Ghidra performance or a live OpenAI tunnel.

See [VERIFICATION.md](VERIFICATION.md) for the executed evidence and remaining acceptance gates.
