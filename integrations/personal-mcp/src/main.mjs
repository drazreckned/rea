import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.mjs";
import { InvestigationManager } from "./manager.mjs";
import { createGatewayServer } from "./mcp.mjs";
import { serveHttp } from "./http.mjs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const path = process.argv[2] ?? process.env.REA_GATEWAY_CONFIG;
if (!path)
  throw new Error(
    "Provide a config JSON path or REA_GATEWAY_CONFIG. No credentials belong in arguments.",
  );
const config = await loadConfig(path);
if (config.stateScope === "connection")
  config.stateDir = join(config.stateDir, randomUUID());
const manager = new InvestigationManager(config);
await manager.initialize();
let transport;
if (config.transport === "stdio") {
  const server = createGatewayServer(manager, "private-local");
  transport = new StdioServerTransport();
  await server.connect(transport);
  const protocolClose = transport.onclose;
  transport.onclose = () => {
    protocolClose?.();
    shutdown().catch(report);
  };
} else {
  transport = await serveHttp(manager, config);
  process.stderr.write(
    JSON.stringify({
      event: "listening",
      url: transport.url,
      auth: config.auth.mode,
    }) + "\n",
  );
}
let stopping;
function report(error) {
  process.stderr.write(
    JSON.stringify({ event: "shutdown_failed", message: error.message }) + "\n",
  );
  process.exitCode = 1;
}
function shutdown() {
  if (stopping) return stopping;
  stopping = (async () => {
    // Stop accepting new investigations, then drain workers before transport exit.
    manager.closing = true;
    await manager.shutdown();
    await transport?.close();
  })();
  stopping.catch(() => {
    stopping = undefined;
  });
  return stopping;
}
process.on("SIGINT", () => shutdown().catch(report));
process.on("SIGTERM", () => shutdown().catch(report));
