import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = await mkdtemp(join(tmpdir(), "rea-stdio-verification-"));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const config = join(root, "config.json");
await writeFile(
  config,
  JSON.stringify({
    stateDir: join(root, "state"),
    rea: {
      command: process.execPath,
      args: [resolve(packageRoot, "../../scripts/rea.mjs"), "mcp"],
      cwd: packageRoot,
    },
  }),
);
const client = new Client({ name: "stdio-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(packageRoot, "src/main.mjs"), config],
  stderr: "pipe",
});
transport.stderr?.on("data", () => {});
let workerPid;
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 7);
  const created = await client.callTool({ name: "rea_create", arguments: {} });
  assert.ok(!created.isError, JSON.stringify(created));
  workerPid = created.structuredContent.workerPid;
  const closed = await client.callTool({
    name: "rea_close",
    arguments: { investigationId: created.structuredContent.investigationId },
  });
  assert.ok(!closed.isError, JSON.stringify(closed));
  await client.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  let alive = true;
  try {
    process.kill(workerPid, 0);
  } catch (error) {
    if (error.code === "ESRCH") alive = false;
    else throw error;
  }
  assert.equal(alive, false, "REA worker remains after acknowledged close");
  console.log(
    JSON.stringify({
      status: "passed",
      transport: "gateway STDIO to real REA STDIO",
      tools: 7,
      workerExitObserved: true,
    }),
  );
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
