import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvestigationManager } from "../src/manager.mjs";
import { parseConfig } from "../src/config.mjs";

async function fixture(t, overrides = {}, factory) {
  const root = await mkdtemp(join(tmpdir(), "rea-personal-test-"));
  const config = parseConfig({
    stateDir: root,
    rea: { command: process.execPath, args: ["unused"] },
    allowedTools: ["inspect"],
    ...overrides,
  });
  const manager = new InvestigationManager(
    config,
    factory ??
      (async () => ({
        pid: 1,
        tools: [{ name: "inspect", inputSchema: { type: "object" } }],
        call: async (_name, args) => ({
          content: [{ type: "text", text: args.text ?? "ok" }],
        }),
        close: async () => {},
      })),
  );
  await manager.initialize();
  t.after(async () => {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  return manager;
}

async function settle(manager, owner, id) {
  await manager.tasks.get(id)?.promise;
  return manager.status(owner, id);
}

test("retains complete JSON with lossless Unicode paging; rejects another owner", async (t) => {
  const manager = await fixture(t);
  const { investigationId } = await manager.create("alice");
  const job = await manager.submit(
    "alice",
    investigationId,
    "inspect",
    { text: "A😀B".repeat(20) },
    "one",
  );
  assert.equal((await settle(manager, "alice", job.id)).state, "succeeded");
  let offset = 0;
  let full = "";
  do {
    const page = await manager.result("alice", job.id, offset, 5);
    full += page.text;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(JSON.parse(full).content[0].text, "A😀B".repeat(20));
  assert.throws(() => manager.status("bob", job.id), /not found/u);
  assert.throws(() => manager.catalog("bob", investigationId), /not found/u);
  await assert.rejects(
    manager.submit("bob", investigationId, "inspect", {}, "one"),
    /not found/u,
  );
});

test("idempotent retries never execute twice; conflicting keys and overlapping jobs rejected", async (t) => {
  let release;
  let calls = 0;
  const manager = await fixture(t, {}, async () => ({
    tools: [{ name: "inspect" }],
    call: async () => {
      calls++;
      await new Promise((resolve) => {
        release = resolve;
      });
      return { content: [] };
    },
    close: async () => {},
  }));
  const { investigationId } = await manager.create("owner");
  const job = await manager.submit(
    "owner",
    investigationId,
    "inspect",
    {},
    "key",
  );
  const duplicate = await manager.submit(
    "owner",
    investigationId,
    "inspect",
    {},
    "key",
  );
  assert.equal(duplicate.id, job.id);
  await assert.rejects(
    manager.submit(
      "owner",
      investigationId,
      "inspect",
      { changed: true },
      "key",
    ),
    /different request/u,
  );
  await assert.rejects(
    manager.submit("owner", investigationId, "inspect", {}, "second"),
    /active job/u,
  );
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  await settle(manager, "owner", job.id);
  assert.equal(calls, 1);
});

test("concurrent creation respects capacity; investigations use distinct workers", async (t) => {
  let count = 0;
  const manager = await fixture(t, {}, async () => ({
    pid: ++count,
    tools: [{ name: "inspect" }],
    call: async () => ({ content: [] }),
    close: async () => {},
  }));
  const [one, two] = await Promise.all([
    manager.create("owner"),
    manager.create("owner"),
  ]);
  assert.notEqual(one.workerPid, two.workerPid);
  await assert.rejects(manager.create("owner"), /limit reached/u);
});

test("cancellation propagates and blocks reuse until cleanup", async (t) => {
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const manager = await fixture(t, {}, async () => ({
    tools: [{ name: "inspect" }],
    close: async () => {},
    call: async (_name, _args, signal) => {
      entered();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  }));
  const { investigationId } = await manager.create("owner");
  const job = await manager.submit(
    "owner",
    investigationId,
    "inspect",
    {},
    "cancel",
  );
  await started;
  assert.equal(manager.cancel("owner", job.id).cancellationRequested, true);
  assert.equal((await settle(manager, "owner", job.id)).state, "cancelled");
  await assert.rejects(
    manager.submit("owner", investigationId, "inspect", {}, "new"),
    /not accepting/u,
  );
  assert.equal((await manager.close("owner", investigationId)).state, "closed");
});

test("retains ownership after cleanup failure and retries it", async (t) => {
  let first = true;
  const manager = await fixture(t, {}, async () => ({
    tools: [],
    close: async () => {
      if (first) {
        first = false;
        throw new Error("fixture cleanup");
      }
    },
  }));
  const { investigationId } = await manager.create("owner");
  await assert.rejects(
    manager.close("owner", investigationId),
    /retained for retry/u,
  );
  assert.equal(
    manager.investigation("owner", investigationId).state,
    "cleanup_failed",
  );
  assert.equal((await manager.close("owner", investigationId)).state, "closed");
});

test("restart labels unfinished work interrupted and preserves completed results", async (t) => {
  const manager = await fixture(t);
  const { investigationId } = await manager.create("owner");
  const complete = await manager.submit(
    "owner",
    investigationId,
    "inspect",
    {},
    "done",
  );
  await settle(manager, "owner", complete.id);
  const unfinished = {
    id: "00000000-0000-4000-8000-000000000001",
    owner: "owner",
    state: "running",
  };
  await manager.store.save(unfinished);
  await manager.shutdown();
  const recovered = new InvestigationManager(manager.config);
  await recovered.initialize();
  assert.equal(recovered.status("owner", unfinished.id).state, "interrupted");
  assert.equal(recovered.status("owner", complete.id).state, "succeeded");
  assert.ok((await recovered.result("owner", complete.id)).text.includes("ok"));
  await recovered.shutdown();
});

test("refuses a second writer to a persistent state directory", async (t) => {
  const manager = await fixture(t);
  const second = new InvestigationManager(manager.config);
  await assert.rejects(second.initialize(), /State directory is locked/u);
});

test("closing during initial persistence cannot start a backend call afterward", async (t) => {
  let calls = 0;
  const manager = await fixture(t, {}, async () => ({
    tools: [{ name: "inspect" }],
    call: async () => {
      calls++;
      return { content: [] };
    },
    close: async () => {},
  }));
  const { investigationId } = await manager.create("owner");
  const save = manager.store.save.bind(manager.store);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let initial = true;
  manager.store.save = async (job) => {
    if (initial) {
      initial = false;
      await gate;
    }
    return save(job);
  };
  const submitted = manager.submit(
    "owner",
    investigationId,
    "inspect",
    {},
    "closing",
  );
  const closed = manager.close("owner", investigationId);
  release();
  const job = await submitted;
  await closed;
  assert.equal(manager.status("owner", job.id).state, "cancelled");
  assert.equal(calls, 0);
});

test("rejects disallowed tools, oversized results and modified result files", async (t) => {
  const manager = await fixture(t, { maxResultBytes: 256 });
  const { investigationId } = await manager.create("owner");
  await assert.rejects(
    manager.submit("owner", investigationId, "run_shell", {}, "bad"),
    /not available/u,
  );
  const large = await manager.submit(
    "owner",
    investigationId,
    "inspect",
    { text: "x".repeat(300) },
    "large",
  );
  assert.equal((await settle(manager, "owner", large.id)).state, "failed");
  const small = await manager.submit(
    "owner",
    investigationId,
    "inspect",
    {},
    "small",
  );
  await settle(manager, "owner", small.id);
  await writeFile(manager.store.path(small.id, "result.json"), "{}");
  await assert.rejects(
    manager.result("owner", small.id),
    /integrity mismatch/u,
  );
});

test("invalid configuration fails closed", () => {
  const rea = { command: "node", args: ["rea"] };
  assert.throws(
    () => parseConfig({ rea, transport: "http", host: "0.0.0.0" }),
    /loopback/u,
  );
  assert.throws(() => parseConfig({ rea, jobTimeoutMs: 0 }));
  assert.throws(() => parseConfig({ rea, unexpected: true }));
});
