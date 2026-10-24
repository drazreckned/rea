import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as nodeRequest } from "node:http";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { InvestigationManager } from "../src/manager.mjs";
import { parseConfig } from "../src/config.mjs";
import { serveHttp } from "../src/http.mjs";

test("real HTTP MCP rejects unauthorized, host and origin requests; accepts authenticated discovery/jobs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rea-http-test-"));
  const config = parseConfig({
    transport: "http",
    port: 0,
    stateDir: root,
    auth: { mode: "bearer", tokenEnv: "TEST_TOKEN" },
    rea: { command: "unused", args: ["unused"] },
    allowedTools: ["inspect"],
  });
  const manager = new InvestigationManager(config, async () => ({
    pid: 1,
    tools: [{ name: "inspect", inputSchema: { type: "object" } }],
    call: async () => ({ content: [{ type: "text", text: "fixture" }] }),
    close: async () => {},
  }));
  await manager.initialize();
  const token = "test-only-token-never-valid-outside-this-test";
  const http = await serveHttp(manager, config, { TEST_TOKEN: token });
  const client = new Client({ name: "http-verifier", version: "1" });
  t.after(async () => {
    await client.close();
    await manager.shutdown();
    await http.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal((await fetch(http.url, { method: "POST" })).status, 401);
  assert.equal(
    (
      await fetch(http.url, {
        method: "POST",
        headers: { Authorization: "Bearer incorrect" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(http.url, {
        method: "POST",
        headers: { Origin: "https://untrusted.invalid" },
      })
    ).status,
    403,
  );
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = nodeRequest(
      http.url,
      { method: "POST", headers: { Host: "untrusted.invalid" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(hostileHostStatus, 403);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(http.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  assert.equal((await client.listTools()).tools.length, 7);
  const created = await client.callTool({ name: "rea_create", arguments: {} });
  assert.equal(created.isError, undefined);
  const investigationId = created.structuredContent.investigationId;
  const submitted = await client.callTool({
    name: "rea_submit",
    arguments: {
      investigationId,
      tool: "inspect",
      arguments: {},
      idempotencyKey: "http",
    },
  });
  const jobId = submitted.structuredContent.id;
  await manager.tasks.get(jobId)?.promise;
  const result = await client.callTool({
    name: "rea_result",
    arguments: { jobId },
  });
  assert.ok(result.structuredContent.text.includes("fixture"));
});
