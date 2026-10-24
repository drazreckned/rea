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
- No-API-key rerun: removed API-key and common access/auth-token variables from the verifier environment and confirmed the installed local REA configuration has no explicit provider environment overrides. Real JavaScript analysis through HTTP/STDIO workers passed (20,857 result bytes), followed by seven-tool STDIO discovery and independently observed worker exit. This establishes the exercised local operation without those credentials; it does not establish every optional provider or mobile-session acceptance.
- Installed-configuration test: an MCP client launched the actual local gateway with `config.local.json`, discovered all seven tools, analyzed a second controlled JavaScript fixture, retrieved its 20,761-byte result and closed the investigation. No API credentials were supplied. This tests the installed STDIO configuration, not a phone UI or every optional provider.
- Final local automated suite: 13 tests passed, including cancellation while the initial job write is still pending. `npm run check:fast` passed both typecheck and lint tasks. A repeat real HTTP/REA check and STDIO worker-exit check also passed after the lifecycle changes.
- GitHub Actions run [40044300282](https://github.com/drazreckned/rea/actions/runs/40044300282): Windows and Linux suites passed; the deployment Docker image built successfully and both real-REA HTTP and STDIO/worker-cleanup verification scripts passed inside it. This establishes that container workflow, not a live OpenAI cloud executor.
- Broader upstream CI is not green. In fork run [40044509703](https://github.com/drazreckned/rea/actions/runs/40044509703), the source suite reported 193 failed tests and 16,889 passed. All 195 failed test/suite headings also occur in upstream baseline run [40041198149](https://github.com/morluto/rea/actions/runs/40041198149), which tested the exact unchanged baseline commit above and failed independently. Its log has two additional failed headings. No upstream source or test file was changed by this integration. This comparison identifies observed baseline failures; it does not establish that the entire upstream suite passes or that every failure has been diagnosed.

## Not yet established

- Phone-directed tool discovery and analysis in a receiving Android/iOS Remote session. The current official [Remote connections guide](https://learn.chatgpt.com/docs/remote-connections) states that the connected desktop host supplies MCP servers, but documentation is not an executed device test.
- Live hosted personal ChatGPT/Work discovery and analysis through Secure MCP Tunnel. Tunnel creation alone is not runtime readiness. Runtime credential approval, the running client, plugin installation and an actual receiving-surface call are separate gates.
- Zero additional price for Secure MCP Tunnel traffic: no explicit tunnel price/waiver was found in the retrieved official guide. Do not infer tunnel pricing from Responses API MCP token pricing.
- Real native decompilation on this machine. The preflight found no configured Ghidra, Hopper or IDA provider; static JavaScript analysis succeeded independently. General Windows provider parity is not claimed.
- Docker was unavailable on the local Windows host; the image build and its real analysis/cleanup checks were instead executed successfully in Linux CI as recorded above.
- Public HTTPS/OAuth provider deployment: signature/claim enforcement is tested locally, but a production authorization server, TLS proxy and deployment are not provisioned.
- Work Cloud local-executor discovery and Codex Cloud execution: actual runtime support and target/engine access still require separate tests.

Private runtime configuration, tunnel identities, credentials, machine paths, analysis results, backups and raw personal documents are excluded from this repository change. Consult the running package's current test output for the exact final check count.
