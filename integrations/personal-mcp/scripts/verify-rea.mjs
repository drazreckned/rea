import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InvestigationManager } from "../src/manager.mjs";
import { parseConfig } from "../src/config.mjs";
import { serveHttp } from "../src/http.mjs";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const root = await mkdtemp(join(tmpdir(), "rea-live-verification-"));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const config = parseConfig({
  transport: "http",
  port: 0,
  stateDir: join(root, "state"),
  rea: {
    command: process.execPath,
    args: [resolve(packageRoot, "../../scripts/rea.mjs"), "mcp"],
    cwd: packageRoot,
  },
});
const manager = new InvestigationManager(config);
await manager.initialize();
const started = performance.now();
const http = await serveHttp(manager, config);
const client = new Client({ name: "rea-live-verifier", version: "1" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
  const fixture = join(root, "application");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(fixture);
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ name: "rea-verification-fixture", type: "module" }),
  );
  await writeFile(
    join(fixture, "index.js"),
    "export function add(a, b) { return a + b; }\n",
  );
  const created = await client.callTool({ name: "rea_create", arguments: {} });
  assert.ok(!created.isError, JSON.stringify(created));
  const investigationId = created.structuredContent.investigationId;
  const second = await client.callTool({ name: "rea_create", arguments: {} });
  assert.ok(!second.isError, JSON.stringify(second));
  assert.notEqual(
    created.structuredContent.workerPid,
    second.structuredContent.workerPid,
  );
  const schema = await client.callTool({
    name: "rea_tools",
    arguments: { investigationId, name: "analyze_javascript_application" },
  });
  assert.ok(schema.structuredContent.tool.inputSchema.properties.input_path);
  const args = {
    investigationId,
    tool: "analyze_javascript_application",
    arguments: { input_path: fixture, detail: "summary" },
    idempotencyKey: "real-javascript",
  };
  const submitted = await client.callTool({
    name: "rea_submit",
    arguments: args,
  });
  assert.ok(!submitted.isError, JSON.stringify(submitted));
  const id = submitted.structuredContent.id;
  assert.equal(
    (await client.callTool({ name: "rea_submit", arguments: args }))
      .structuredContent.id,
    id,
  );
  // Poll through HTTP, as a disconnected hosted client would.
  let status;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = (
      await client.callTool({ name: "rea_job", arguments: { jobId: id } })
    ).structuredContent;
  } while (status.state === "queued" || status.state === "running");
  assert.equal(status.state, "succeeded", JSON.stringify(status));
  let offset = 0;
  let text = "";
  do {
    const result = await client.callTool({
      name: "rea_result",
      arguments: { jobId: id, offset, limit: 2000 },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    text += result.structuredContent.text;
    offset = result.structuredContent.nextOffset;
  } while (offset !== null);
  const original = JSON.parse(text);
  assert.ok(original.structuredContent || original.content?.length);
  for (const investigation of [
    investigationId,
    second.structuredContent.investigationId,
  ]) {
    const closed = await client.callTool({
      name: "rea_close",
      arguments: { investigationId: investigation },
    });
    assert.ok(!closed.isError, JSON.stringify(closed));
  }
  assert.equal(manager.investigations.size, 0);
  console.log(
    JSON.stringify({
      status: "passed",
      backend: "real REA",
      transport: "HTTP gateway to STDIO workers",
      operation: "analyze_javascript_application",
      independentWorkerPids: true,
      idempotency: "passed",
      resultPaging: "passed",
      providerCleanup: "acknowledged",
      elapsedMs: Math.round(performance.now() - started),
      resultBytes: status.resultBytes,
    }),
  );
} finally {
  await client.close();
  await manager.shutdown();
  await http.close();
  await rm(root, { recursive: true, force: true });
}
