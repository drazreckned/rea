import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";

// One SDK-owned child per investigation. No request can choose an executable.
export async function startWorker(config) {
  const client = new Client({ name: "rea-personal-worker", version: "0.1.0" });
  const transport = new StdioClientTransport({
    ...config.rea,
    env: { ...getDefaultEnvironment(), ...config.rea.env },
    stderr: "pipe",
    maxBufferSize: 16 * 1024 * 1024,
  });
  // Consume bounded diagnostics without forwarding target content into server logs.
  let diagnosticBytes = 0;
  transport.stderr?.on("data", (chunk) => {
    diagnosticBytes += chunk.length;
  });
  try {
    await client.connect(transport, { timeout: config.startupTimeoutMs });
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const pid = transport.pid;
    let closed = false;
    return {
      pid,
      tools,
      call: (name, args, signal) =>
        client.callTool(
          { name, arguments: args },
          {
            signal,
            timeout: config.jobTimeoutMs,
            resetTimeoutOnProgress: false,
          },
        ),
      async close() {
        if (closed) return;
        // Drain provider ownership before the SDK's bounded process teardown.
        if (tools.some((tool) => tool.name === "close_binary")) {
          const result = await client.callTool(
            { name: "close_binary", arguments: {} },
            { timeout: config.jobTimeoutMs },
          );
          if (result.isError)
            throw new Error(
              "REA close_binary failed; worker retained for cleanup retry.",
            );
        }
        await client.close();
        closed = true;
      },
      diagnosticBytes: () => diagnosticBytes,
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
