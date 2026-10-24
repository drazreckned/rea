import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  lstat,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class JobStore {
  constructor(root) {
    this.root = root;
  }
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink())
      throw new Error("State directory must not be a symbolic link.");
    this.lockPath = join(this.root, "gateway.lock");
    try {
      this.lock = await open(this.lockPath, "wx", 0o600);
      await this.lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          `State directory is locked: ${this.lockPath}. Stop its owning gateway first. After a crash, verify that the recorded process is absent before archiving the lock; never start a second writer.`,
        );
      throw error;
    }
  }
  async close() {
    if (!this.lock) return;
    await this.lock.close();
    await unlink(this.lockPath);
    this.lock = undefined;
  }
  path(id, suffix) {
    if (!/^[0-9a-f-]{36}$/u.test(id))
      throw new Error("Invalid job identifier.");
    return join(this.root, `${id}.${suffix}`);
  }
  async atomic(path, text) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  }
  save(job) {
    return this.atomic(this.path(job.id, "json"), JSON.stringify(job));
  }
  saveResult(id, text) {
    return this.atomic(this.path(id, "result.json"), text);
  }
  result(id) {
    return readFile(this.path(id, "result.json"), "utf8");
  }
  async load() {
    const jobs = [];
    for (const name of await readdir(this.root)) {
      if (!/^[0-9a-f-]{36}\.json$/u.test(name)) continue;
      jobs.push(JSON.parse(await readFile(join(this.root, name), "utf8")));
    }
    return jobs;
  }
}
