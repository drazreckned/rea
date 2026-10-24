import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createGatewayServer } from "./mcp.mjs";
import { createAuth, protectedResource } from "./auth.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
export async function serveHttp(manager, config, environment = process.env) {
  const authenticate = createAuth(config, environment);
  let boundOrigin;
  const server = createServer(async (incoming, outgoing) => {
    const reply = (status, value, headers = {}) => {
      outgoing.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...headers,
      });
      outgoing.end(JSON.stringify(value));
    };
    let handler;
    try {
      if (
        !incoming.url?.startsWith("/") ||
        incoming.url.startsWith("//") ||
        incoming.url.includes("#")
      )
        return reply(400, { error: "Invalid request path" });
      const url = new URL(boundOrigin + incoming.url);
      if (url.pathname !== incoming.url.split("?")[0])
        return reply(400, { error: "Noncanonical request path" });
      const allowedOrigins = new Set([
        boundOrigin,
        config.publicUrl ? new URL(config.publicUrl).origin : boundOrigin,
      ]);
      const allowedHosts = new Set(
        [...allowedOrigins].map((origin) => new URL(origin).host),
      );
      if (!allowedHosts.has(incoming.headers.host))
        return reply(403, { error: "Host not allowed" });
      if (
        incoming.headers.origin &&
        !allowedOrigins.has(incoming.headers.origin)
      )
        return reply(403, { error: "Origin not allowed" });
      if (url.pathname === "/healthz" && incoming.method === "GET")
        return reply(200, { status: "listening", version: "0.1.0" });
      if (
        url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp"
      ) {
        if (config.auth.mode !== "oauth" || incoming.method !== "GET")
          return reply(404, { error: "Not found" });
        return reply(200, protectedResource(config));
      }
      if (url.pathname !== "/mcp") return reply(404, { error: "Not found" });
      if (incoming.method !== "POST")
        return reply(
          405,
          { error: "Stateless MCP supports POST only" },
          { Allow: "POST" },
        );
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(", "));
      }
      const authRequest = new Request(url, { headers });
      let owner;
      try {
        owner = await authenticate(authRequest);
      } catch {
        const challenge =
          config.auth.mode === "oauth"
            ? `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", config.publicUrl)}"`
            : "Bearer";
        return reply(
          401,
          { error: "Unauthorized" },
          { "WWW-Authenticate": challenge },
        );
      }
      if (
        !/^application\/json(?:;|$)/iu.test(headers.get("content-type") ?? "")
      )
        return reply(415, { error: "JSON required" });
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
          return reply(413, {
            error: `Request exceeds ${MAX_BODY_BYTES} bytes`,
          });
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: "POST",
        headers,
        body: Buffer.concat(chunks),
      });
      handler = createMcpHandler(() => createGatewayServer(manager, owner), {
        maxRequestBodySize: MAX_BODY_BYTES,
      });
      const response = await handler.fetch(request);
      const body = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(body);
    } catch {
      if (!outgoing.headersSent)
        reply(500, { error: "Gateway request failed" });
      else outgoing.destroy();
    } finally {
      await handler?.close();
    }
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const address = server.address();
  const host =
    config.host === "::1"
      ? "[::1]"
      : config.host === "0.0.0.0"
        ? "127.0.0.1"
        : config.host;
  boundOrigin = `http://${host}:${address.port}`;
  return {
    url: `${boundOrigin}/mcp`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
