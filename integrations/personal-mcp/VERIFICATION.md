# Verification record

Recorded 2026-10-23. Source baseline: `a062529bb2aa064be37e82df39c59c4fa798fe50` from `morluto/rea`, package identity 6.7.0. These are bounded results, not a general security audit or a claim of all-provider compatibility.

## Executed on Windows x64

- Portable Node 24.22.1 archive checked against the vendor's SHA-256 manifest. No system Node installation or PATH was changed.
- Locked REA dependencies installed; Windows native addon and manifest obtained from the matching published 6.7.0 npm package. REA's own validation admitted them.
- `npm run build:cached`: passed, three build tasks. Upstream bundler emitted existing ineffective-dynamic-import warnings.
- Actual REA STDIO initialization and `tools/list`: 221 tools discovered. Discovery does not prove every provider is usable.
- Gateway tests: authentication (including OAuth claims/signatures), HTTP Host/Origin boundaries, job ownership, idempotency, concurrent capacity, cancellation, cleanup failure/retry, durable restart recovery, single-writer state admission, size/integrity checks and lossless result paging.
- Real REA through gateway HTTP: `analyze_javascript_application` on a controlled application fixture passed, with complete original result retained and retrieved in pages. Independent investigations used distinct worker PIDs. The first run took about 16.7 seconds and retained 20,857 result bytes; these are observations for that fixture, not performance guarantees.
- Gateway STDIO through real REA STDIO: seven gateway tools discovered, investigation created/closed, and backend worker exit independently observed after acknowledged cleanup.
- Long-job transport: real HTTP MCP with a deliberately slow controlled worker. Submission returned in 9 ms; client disconnected/reconnected; the 125-second operation completed and was retrieved after about 130 seconds. This does not establish a real Ghidra or OpenAI tunnel result.
- Local MCP registration added with an independently stored, hash-verified pre-change config backup. Existing configuration values were compared and preserved. Active pre-existing chats may require MCP reload before the new tools appear.
- Fresh Codex app-server `mcpServerStatus/list`: discovered all seven `rea-personal` gateway tools from the installed host configuration, without starting a model turn.
- Final local automated suite: 13 tests passed, including cancellation while the initial job write is still pending. `npm run check:fast` passed both typecheck and lint tasks. A repeat real HTTP/REA check and STDIO worker-exit check also passed after the lifecycle changes.

## Not yet established

- Live hosted personal ChatGPT/Work discovery and analysis through Secure MCP Tunnel. Tunnel creation alone is not runtime readiness. Runtime credential approval, the running client, plugin installation and an actual receiving-surface call are separate gates.
- Zero additional price for Secure MCP Tunnel traffic: no explicit tunnel price/waiver was found in the retrieved official guide. Do not infer tunnel pricing from Responses API MCP token pricing.
- Real native decompilation on this machine. The preflight found no configured Ghidra, Hopper or IDA provider; static JavaScript analysis succeeded independently. General Windows provider parity is not claimed.
- Docker image execution: no Docker executable was available on the validation host. The deployment recipe is prepared, not runtime verified.
- Public HTTPS/OAuth provider deployment: signature/claim enforcement is tested locally, but a production authorization server, TLS proxy and deployment are not provisioned.
- Work Cloud local-executor discovery and Codex Cloud execution: actual runtime support and target/engine access still require separate tests.

Private runtime configuration, tunnel identities, credentials, machine paths, analysis results, backups and raw personal documents are excluded from this repository change. Consult the running package's current test output for the exact final check count.
