import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BackupService } from "../src/engine/service";
import { planSchema, type Snapshot, type ResponseMap } from "../src/shared/contracts";
import { snapshotPath } from "../src/engine/paths";

async function main() {
  await mkdir("outputs/recovery-fixture", { recursive: true });
  const root = await mkdtemp(resolve("outputs/recovery-fixture/run-"));
  const source = join(root, "project");
  await mkdir(source);
  for (let i = 0; i < 16; i++) await writeFile(join(source, `file-${i}.txt`), `original-${i}`);
  const secrets: Record<string, string> = {};
  const password = "disposable-recovery-fixture-password";
  const service = new BackupService({ data: join(root, "profile"), engines: resolve("vendor/bin"), secrets, clientId: "", host: { saveSecret: async (id, value) => { if (value) secrets[id] = value; else delete secrets[id]; }, authorize: async () => { throw new Error("No browser in fixture"); }, publish: () => {} } });
  const results: string[] = [];
  async function wait(ids: string[]) {
    const deadline = Date.now() + 180_000;
    while (ids.some(id => ["running", "queued"].includes(service.store.getJob(id).status)) || service.state().busy) {
      if (Date.now() > deadline) throw new Error("Recovery fixture timed out: " + JSON.stringify(ids.map(id => service.store.getJob(id))));
      await new Promise(r => setTimeout(r, 40));
    }
    const jobs = ids.map(id => service.store.getJob(id));
    for (const job of jobs) assert.equal(job.status, "success", `${job.kind}: ${job.error}`);
    return jobs;
  }
  const snapshots = async (id: string) => await service.request({ type: "snapshots", destinationId: id }) as Snapshot[];
  try {
    await service.start();
    for (const id of ["a", "b"]) await service.request({ type: "add-destination", id, name: `Repository ${id}`, kind: "local", location: join(root, id), existing: false, password });
    const plan = planSchema.parse({ id: "project", name: "Project", sources: [source], destinationIds: ["a", "b"], enabled: true, includes: [], excludes: [], schedule: { kind: "manual" }, retention: { daily: 1, weekly: 0, monthly: 0 }, replicateFrom: "a", recoveryDrillDays: 7 });
    await service.request({ type: "save-plan", plan });
    const jobs = await wait(await service.request({ type: "run", planId: plan.id, name: "Before upgrade", checkpointDays: 7 }) as string[]);
    assert.equal(jobs.length, 2); assert.equal(jobs[1].kind, "copy");
    const first = (await snapshots("a"))[0];
    const copied = (await snapshots("b"))[0];
    assert.equal(copied.time, first.time); assert.equal(copied.name, first.name); assert(first.checkpointUntil);
    results.push("One capture copied to an independent repository with original time and checkpoint metadata");
    await writeFile(join(source, "file-0.txt"), "modified-0");
    await rm(join(source, "file-1.txt"));
    await writeFile(join(source, "new.txt"), "new file");
    const manualCopy = await service.request({ type: "copy-snapshot", sourceDestinationId: "a", destinationId: "b", snapshotId: first.id }) as string;
    await wait([manualCopy]);
    const oldPreview = await service.request({ type: "file-preview", destinationId: "b", snapshotId: (await snapshots("b"))[0].id, path: snapshotPath(join(source, "file-0.txt")) }) as ResponseMap["file-preview"];
    assert.equal(oldPreview.content, "original-0");
    results.push("Snapshot copy never rescans changed live sources; preview restores verified captured bytes");
    await wait(await service.request({ type: "run", planId: plan.id, destinationId: "a" }) as string[]);
    const latest = (await snapshots("a"))[0];
    const diff = await service.request({ type: "snapshot-diff", destinationId: "a", before: first.id, after: latest.id, offset: 0, limit: 100 }) as ResponseMap["snapshot-diff"];
    assert(diff.changes.some(c => c.path.endsWith("file-0.txt") && c.change === "changed"), JSON.stringify(diff));
    assert(diff.changes.some(c => c.path.endsWith("file-1.txt") && c.change === "deleted"), JSON.stringify(diff));
    assert(diff.changes.some(c => c.path.endsWith("new.txt") && c.change === "added"), JSON.stringify(diff));
    const history = await service.request({ type: "file-history", destinationId: "a", path: join(source, "file-1.txt"), offset: 0, limit: 10 }) as ResponseMap["file-history"];
    assert(history.versions.some(v => !v.file)); assert(history.versions.some(v => v.file));
    results.push("Content comparison reports modified, deleted and added files; deleted-file history retains older versions");
    const drillId = await service.request({ type: "test-recovery", destinationId: "a", snapshotId: latest.id }) as string;
    const drill = (await wait([drillId]))[0];
    assert.equal(drill.recoveredFiles, 12);
    assert.equal(service.state().recoveryDrills?.find(d => d.destinationId === "a")?.totalFiles, 16);
    assert.equal(await stat(join(root, "profile", "test-recovery", drillId)).catch(() => null), null);
    results.push("Recovery drill verifies a diverse 12-file sample and removes plaintext scratch files");
    service.store.db.exec("DELETE FROM files; DELETE FROM indexed; DELETE FROM snapshots;");
    const practice = await service.request({ type: "practice-recovery", destinationId: "a", password, target: join(root, "practice") }) as ResponseMap["practice-recovery"];
    assert.equal(practice.files, 1);
    await assert.rejects(service.request({ type: "practice-recovery", destinationId: "a", password: "wrong-password", target: join(root, "wrong-password") }));
    await assert.rejects(service.request({ type: "practice-recovery", destinationId: "a", password, target: source }));
    const kit = await service.request({ type: "recovery-kit" }) as string;
    assert(kit.includes(join(root, "a"))); assert(!kit.includes(password));
    results.push("Fresh-catalog recovery works with explicitly entered credentials, rejects wrong passwords and source collisions; kit contains no secrets");
    const databasePath = join(root, "live.sqlite");
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE work(value TEXT); INSERT INTO work VALUES('committed WAL data');");
      const databasePlan = planSchema.parse({ ...plan, id: "database", name: "Live database", sources: [databasePath], destinationIds: ["a"], replicateFrom: undefined, capture: "sqlite", recoveryDrillDays: 0 });
      await service.request({ type: "save-plan", plan: databasePlan });
      const captured = (await wait(await service.request({ type: "run", planId: "database" }) as string[]))[0];
      const files = await service.request({ type: "files", destinationId: "a", snapshotId: captured.snapshotId, search: "", offset: 0, limit: 100 }) as ResponseMap["files"];
      assert.equal(files.total, 1); assert.equal(files.entries[0].path, snapshotPath(databasePath));
      const restored = join(root, "database-restore");
      await wait([await service.request({ type: "restore", destinationId: "a", snapshotId: captured.snapshotId, target: restored, paths: [], overwrite: "never" }) as string]);
      const check = new DatabaseSync(join(restored, "." + snapshotPath(databasePath)), { readOnly: true });
      try { assert.equal(check.prepare("SELECT value FROM work").get()!.value, "committed WAL data"); } finally { check.close(); }
      results.push("Live SQLite WAL capture restores a consistent database at its original logical path");
    } finally { db.close(); }
    await service.request({ type: "settings", settings: { ...service.state().settings, discoveryRoots: [join(root, "unprotected")], paused: true } });
    await mkdir(join(root, "unprotected"));
    const gaps = await service.request({ type: "scan-gaps" }) as ResponseMap["scan-gaps"];
    assert(gaps.gaps.some(g => g.path === join(root, "unprotected")));
    assert.equal(service.state().plans.length, 2);
    results.push("Opt-in discovery reports an unprotected folder without altering plans");
    console.log(results.map(r => "PASS " + r).join("\n"));
    await writeFile(join(root, "results.json"), JSON.stringify({ passed: true, results }, null, 2));
    console.log("Evidence: " + root);
  } finally { await service.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
