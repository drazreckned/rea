// Real HTTP/MCP transport with a deliberately slow controlled worker, not an analysis-engine benchmark.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { parseConfig } from "../src/config.mjs";
import { InvestigationManager } from "../src/manager.mjs";
import { serveHttp } from "../src/http.mjs";

const root = await mkdtemp(join(tmpdir(), "rea-long-job-"));
const config = parseConfig({
  transport: "http",
  port: 0,
  stateDir: root,
  allowedTools: ["controlled_slow_call"],
  rea: { command: "unused", args: ["unused"] },
});
const manager = new InvestigationManager(config, async () => ({
  pid: null,
  tools: [{ name: "controlled_slow_call", inputSchema: { type: "object" } }],
  close: async () => {},
  call: async (_name, _args, signal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 125000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
    return {
      content: [{ type: "text", text: "controlled 125-second call completed" }],
    };
  },
}));
await manager.initialize();
const http = await serveHttp(manager, config);
let client;
const connect = async () => {
  client = new Client({ name: "long-job-verifier", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
};
try {
  await connect();
  const created = await client.callTool({ name: "rea_create", arguments: {} });
  const investigationId = created.structuredContent.investigationId;
  const started = performance.now();
  const submitted = await client.callTool({
    name: "rea_submit",
    arguments: {
      investigationId,
      tool: "controlled_slow_call",
      arguments: {},
      idempotencyKey: "125-second-proof",
    },
  });
  const submitMs = performance.now() - started;
  assert.ok(submitMs < 10000, `Submission took ${submitMs} ms`);
  const jobId = submitted.structuredContent.id;
  await client.close(); // Simulate the hosted client disconnecting after submission.
  await connect();
  let status;
  do {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    status = (await client.callTool({ name: "rea_job", arguments: { jobId } }))
      .structuredContent;
    console.log(
      JSON.stringify({
        event: "progress",
        elapsedSeconds: Math.round((performance.now() - started) / 1000),
        state: status.state,
      }),
    );
  } while (status.state === "queued" || status.state === "running");
  assert.equal(status.state, "succeeded");
  const result = await client.callTool({
    name: "rea_result",
    arguments: { jobId },
  });
  assert.ok(result.structuredContent.text.includes("125-second"));
  console.log(
    JSON.stringify({
      status: "passed",
      transport: "real HTTP MCP",
      worker: "controlled delay fixture",
      elapsedMs: Math.round(performance.now() - started),
      submitMs: Math.round(submitMs),
      reconnect: "passed",
    }),
  );
} finally {
  await client?.close();
  await manager.shutdown();
  await http.close();
  await rm(root, { recursive: true, force: true });
}
