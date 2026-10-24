import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { z } from "zod";

export const DEFAULT_TOOLS = [
  "binary_session",
  "open_binary",
  "close_binary",
  "analyze_function",
  "get_navigation_context",
  "inspect_artifact",
  "analyze_javascript_application",
  "inspect_analysis_view",
  "inspect_model_artifact",
  "inspect_go_binary",
  "inspect_rust_binary",
  "inspect_pe_certificates",
  "inspect_elf_notes",
  "inspect_native_exports",
  "inspect_native_load_image",
  "read_bytes",
  "search_strings",
  "list_procedures",
  "get_procedure",
  "list_segments",
];

const integer = (fallback, maximum) =>
  z.number().int().min(1).max(maximum).default(fallback);
const schema = z
  .object({
    transport: z.enum(["stdio", "http"]).default("stdio"),
    host: z.enum(["127.0.0.1", "::1", "0.0.0.0"]).default("127.0.0.1"),
    port: z.number().int().min(0).max(65535).default(8788),
    publicUrl: z.string().url().optional(),
    stateDir: z.string().default(".state"),
    stateScope: z.enum(["connection", "persistent"]).optional(),
    maxInvestigations: integer(2, 32),
    maxJobs: integer(100, 10000),
    jobTimeoutMs: integer(900000, 2147483647),
    startupTimeoutMs: integer(60000, 2147483647),
    maxResultBytes: integer(16 * 1024 * 1024, 128 * 1024 * 1024),
    allowedTools: z.array(z.string().min(1)).min(1).default(DEFAULT_TOOLS),
    rea: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).min(1),
        cwd: z.string().optional(),
        env: z.record(z.string(), z.string()).default({}),
      })
      .strict(),
    auth: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("private") }).strict(),
        z
          .object({ mode: z.literal("bearer"), tokenEnv: z.string().min(1) })
          .strict(),
        z
          .object({
            mode: z.literal("oauth"),
            issuer: z.string().url(),
            jwksUrl: z.string().url(),
            audience: z.string().min(1),
            requiredScope: z.string().min(1).default("rea:use"),
            allowedSubjects: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      ])
      .default({ mode: "private" }),
  })
  .strict();

export function parseConfig(value, base = process.cwd()) {
  const config = schema.parse(value);
  config.stateScope ??=
    config.transport === "stdio" ? "connection" : "persistent";
  if (config.transport === "http" && config.stateScope === "connection")
    throw new Error("HTTP requires persistent state scope.");
  config.stateDir = resolve(base, config.stateDir);
  if (config.rea.cwd) config.rea.cwd = resolve(base, config.rea.cwd);
  if (config.transport === "http") {
    if (config.auth.mode === "private" && config.host === "0.0.0.0")
      throw new Error(
        "Private HTTP must bind to loopback. Use authenticated HTTP for remote binding.",
      );
    if (config.auth.mode === "oauth") {
      for (const url of [
        config.publicUrl,
        config.auth.issuer,
        config.auth.jwksUrl,
      ]) {
        if (!url || new URL(url).protocol !== "https:")
          throw new Error(
            "OAuth requires HTTPS publicUrl, issuer and jwksUrl.",
          );
      }
    }
    if (
      config.host === "0.0.0.0" &&
      (!config.publicUrl || new URL(config.publicUrl).protocol !== "https:")
    )
      throw new Error(
        "Non-loopback HTTP requires an HTTPS publicUrl and TLS reverse proxy.",
      );
  }
  return config;
}

export async function loadConfig(path) {
  const absolute = resolve(path);
  return parseConfig(
    JSON.parse(await readFile(absolute, "utf8")),
    dirname(absolute),
  );
}
