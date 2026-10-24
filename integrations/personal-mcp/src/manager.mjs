import { createHash, randomUUID } from "node:crypto";
import { JobStore } from "./store.mjs";
import { startWorker } from "./worker.mjs";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const publicJob = (job) => {
  const { owner: _owner, fingerprint: _fingerprint, ...result } = job;
  return result;
};

export class InvestigationManager {
  constructor(config, workerFactory = startWorker) {
    this.config = config;
    this.workerFactory = workerFactory;
    this.store = new JobStore(config.stateDir);
    this.investigations = new Map();
    this.jobs = new Map();
    this.tasks = new Map();
    this.closing = false;
  }
  async initialize() {
    await this.store.initialize();
    for (const job of await this.store.load()) {
      if (!TERMINAL.has(job.state)) {
        job.state = "interrupted";
        job.error =
          "Gateway restarted. Work was not replayed; inspect target state before resubmitting.";
        job.finishedAt = new Date().toISOString();
        await this.store.save(job);
      }
      this.jobs.set(job.id, job);
    }
  }
  investigation(owner, id) {
    const item = this.investigations.get(id);
    if (!item || item.owner !== owner)
      throw new Error("Investigation not found.");
    return item;
  }
  job(owner, id) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) throw new Error("Job not found.");
    return job;
  }
  async create(owner) {
    if (this.closing) throw new Error("Gateway is shutting down.");
    if (this.investigations.size >= this.config.maxInvestigations)
      throw new Error(
        "Investigation limit reached. Close an investigation before creating another.",
      );
    const id = randomUUID();
    // Reserve before awaiting startup so concurrent calls cannot exceed capacity.
    const item = { id, owner, state: "starting", worker: null, busy: null };
    this.investigations.set(id, item);
    try {
      item.startup = this.workerFactory(this.config);
      item.worker = await item.startup;
      item.state = "ready";
      return {
        investigationId: id,
        state: "ready",
        workerPid: item.worker.pid,
      };
    } catch (error) {
      this.investigations.delete(id);
      throw error;
    }
  }
  catalog(owner, id, name, offset = 0, limit = 30) {
    const item = this.investigation(owner, id);
    if (item.state !== "ready")
      throw new Error(`Investigation is ${item.state}.`);
    const tools = item.worker.tools.filter((tool) =>
      this.config.allowedTools.includes(tool.name),
    );
    if (name) {
      const tool = tools.find((tool) => tool.name === name);
      if (!tool) throw new Error("Tool not available in this profile.");
      const { outputSchema: _outputSchema, ...inputContract } = tool;
      return { tool: inputContract };
    }
    return {
      tools: tools
        .slice(offset, offset + limit)
        .map(({ name, description, annotations }) => ({
          name,
          description,
          annotations,
        })),
      total: tools.length,
      offset,
      nextOffset: offset + limit < tools.length ? offset + limit : null,
    };
  }
  async submit(owner, id, name, args, key) {
    const item = this.investigation(owner, id);
    const fingerprint = digest(JSON.stringify({ id, name, args }));
    const existing = [...this.jobs.values()].find(
      (job) => job.owner === owner && job.idempotencyKey === key,
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error("Idempotency key already names a different request.");
      return publicJob(existing);
    }
    if (this.closing || item.state !== "ready")
      throw new Error("Investigation is not accepting work.");
    if (item.busy)
      throw new Error(
        "Investigation already has an active job. Use another investigation for independent work.",
      );
    if (
      !this.config.allowedTools.includes(name) ||
      !item.worker.tools.some((tool) => tool.name === name)
    )
      throw new Error("Tool not available in this profile.");
    if (this.jobs.size >= this.config.maxJobs)
      throw new Error(
        "Stored job limit reached. Archive state and restart with a reviewed capacity change.",
      );
    const job = {
      id: randomUUID(),
      owner,
      investigationId: id,
      tool: name,
      idempotencyKey: key,
      fingerprint,
      state: "queued",
      createdAt: new Date().toISOString(),
    };
    const control = { abort: new AbortController(), promise: null };
    item.busy = job.id;
    this.jobs.set(job.id, job);
    this.tasks.set(job.id, control);
    const saved = this.store.save(job);
    // Close/cancel owns this promise even while the initial durable write is pending.
    control.promise = saved.then(
      () => this.run(item, job, args, control),
      () => {
        item.busy = null;
        this.jobs.delete(job.id);
        this.tasks.delete(job.id);
      },
    );
    await saved;
    // Detached job ownership is retained in tasks until settlement; never tied to the HTTP request.
    return publicJob(job);
  }
  async run(item, job, args, control) {
    const timer = setTimeout(
      () => control.abort.abort(new Error("Configured job deadline exceeded.")),
      this.config.jobTimeoutMs,
    );
    timer.unref();
    try {
      job.state = "running";
      await this.store.save(job);
      if (control.abort.signal.aborted) throw control.abort.signal.reason;
      const result = await item.worker.call(
        job.tool,
        args,
        control.abort.signal,
      );
      if (control.abort.signal.aborted) throw control.abort.signal.reason;
      const text = JSON.stringify(result);
      const bytes = Buffer.byteLength(text);
      if (bytes > this.config.maxResultBytes)
        throw new Error(
          `Result exceeds configured maxResultBytes (${this.config.maxResultBytes}); request a REA summary or paged view.`,
        );
      await this.store.saveResult(job.id, text);
      job.resultBytes = bytes;
      job.resultCharacters = text.length;
      job.resultSha256 = digest(text);
      job.state = result.isError ? "failed" : "succeeded";
      if (result.isError)
        job.error =
          "REA returned a tool error; retrieve the retained result for exact evidence.";
    } catch (error) {
      job.state = control.abort.signal.aborted ? "cancelled" : "failed";
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
      job.finishedAt = new Date().toISOString();
      try {
        await this.store.save(job);
      } catch (error) {
        job.persistenceError = error.message;
      }
      item.busy = null;
      if (control.abort.signal.aborted && item.state === "ready")
        item.state = "needs_cleanup";
      this.tasks.delete(job.id);
    }
  }
  status(owner, id) {
    return publicJob(this.job(owner, id));
  }
  async result(owner, id, offset = 0, limit = 32000) {
    const job = this.job(owner, id);
    if (!job.resultSha256)
      throw new Error(`No retained result; job is ${job.state}.`);
    const text = await this.store.result(id);
    if (digest(text) !== job.resultSha256)
      throw new Error("Result integrity mismatch.");
    if (offset > text.length)
      throw new Error("Result offset exceeds result length.");
    // Offsets count UTF-16 units. Do not cut a supplementary character in half.
    if (offset > 0 && /[\uDC00-\uDFFF]/u.test(text[offset] ?? ""))
      throw new Error(
        "Offset splits a UTF-16 surrogate pair; use nextOffset from the prior page.",
      );
    let end = Math.min(offset + limit, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1] ?? ""))
      end--;
    return {
      jobId: id,
      encoding: "json-text",
      text: text.slice(offset, end),
      offset,
      nextOffset: end < text.length ? end : null,
      totalCharacters: text.length,
      sha256: job.resultSha256,
      untrustedTargetContent: true,
    };
  }
  cancel(owner, id) {
    const job = this.job(owner, id);
    const control = this.tasks.get(id);
    if (control) control.abort.abort(new Error("Cancelled by the caller."));
    return {
      jobId: id,
      cancellationRequested: Boolean(control),
      state: job.state,
    };
  }
  async close(owner, id) {
    const item = this.investigation(owner, id);
    if (item.state === "closing")
      throw new Error("Investigation cleanup already in progress.");
    item.state = "closing";
    if (item.startup) await item.startup;
    if (item.busy) {
      const control = this.tasks.get(item.busy);
      control?.abort.abort(new Error("Investigation is closing."));
      await control?.promise;
    }
    try {
      await item.worker.close();
      this.investigations.delete(id);
      return {
        investigationId: id,
        state: "closed",
        providerCleanup: "acknowledged",
      };
    } catch (error) {
      item.state = "cleanup_failed";
      throw new Error(
        `Cleanup failed; worker retained for retry: ${error.message}`,
      );
    }
  }
  async shutdown() {
    this.closing = true;
    const results = await Promise.allSettled(
      [...this.investigations.values()].map((item) =>
        this.close(item.owner, item.id),
      ),
    );
    const failures = results.filter((item) => item.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((item) => item.reason),
        "Some REA workers remain owned; cleanup must be retried.",
      );
    await this.store.close();
  }
}
