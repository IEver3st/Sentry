import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BackupService, type Host } from "../src/engine/service";
import {
  planSchema,
  type Job,
  type Snapshot,
  type Plan,
  type Settings,
} from "../src/shared/contracts";
import { snapshotPath } from "../src/engine/paths";

// Run the compiled artifact with Node, not bun:test: the service owns node:sqlite.
async function main(): Promise<void> {
  const fixtureBase = path.resolve("outputs/service-fixture");
  await mkdir(fixtureBase, { recursive: true });
  const fixture = await mkdtemp(path.join(fixtureBase, "run-"));
  const secrets: Record<string, string> = {};
  const host: Host = {
    saveSecret: async (key, value) => {
      if (value === undefined) delete secrets[key];
      else secrets[key] = value;
    },
    authorize: async () => {
      throw new Error("A service fixture must not open the browser.");
    },
    publish: () => {},
  };
  const engines = path.resolve("vendor/bin");
  const data = path.join(fixture, "application-data");
  let service = new BackupService({
    data,
    engines,
    secrets,
    clientId: "",
    host,
  });
  const results: Array<{ scenario: string; passed: boolean; detail?: string }> =
    [];
  const password = "fixture-only-recovery-password-9127";
  const terminal = new Set<Job["status"]>([
    "success",
    "partial",
    "failed",
    "cancelled",
    "interrupted",
  ]);

  async function idle(instance = service): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (instance.state().busy) {
      if (Date.now() >= deadline)
        throw new Error("Timed out waiting for service idle");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  async function jobs(ids: string[], instance = service): Promise<Job[]> {
    const deadline = Date.now() + 120_000;
    while (true) {
      const rows = ids.map((id) => instance.store.getJob(id));
      if (rows.every((job) => terminal.has(job.status))) {
        await idle(instance);
        return rows;
      }
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out waiting for jobs: ${rows.map((job) => `${job.kind}:${job.status}:${job.phase}`).join(", ")}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function scenario(
    name: string,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
      results.push({ scenario: name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ scenario: name, passed: false, detail });
      console.error(`FAIL ${name}: ${detail}`);
    }
  }
  async function snapshotList(
    destinationId: string,
    instance = service,
  ): Promise<Snapshot[]> {
    return (await instance.request({
      type: "snapshots",
      destinationId,
    })) as Snapshot[];
  }
  async function settings(changes: Partial<Settings>): Promise<void> {
    await service.request({
      type: "settings",
      settings: { ...service.state().settings, ...changes },
    });
  }
  async function run(
    destinationId?: string,
    extra: { name?: string; pin?: boolean } = {},
  ): Promise<Job[]> {
    return jobs(
      (await service.request({
        type: "run",
        planId: "fixture-plan",
        destinationId,
        ...extra,
      })) as string[],
    );
  }
  function assertSuccess(rows: Job[]) {
    assert(rows.length > 0);
    for (const job of rows) assert.equal(job.status, "success", job.error);
  }

  let firstSnapshot = "";
  let latestSnapshot = "";
  let failedJob = "";
  let plan: Plan;
  const a = path.join(fixture, "sources", "A");
  const b = path.join(fixture, "sources", "B");
  const repositoryA = path.join(fixture, "repository-a");
  const repositoryB = path.join(fixture, "repository-b");
  const restored = path.join(fixture, "restored");
  try {
    await service.start();
    await mkdir(path.join(a, "empty-folder"), { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(path.join(a, "same.txt"), "A original");
    await writeFile(path.join(b, "same.txt"), "B independent");
    await writeFile(path.join(a, "empty.txt"), "");
    await writeFile(path.join(a, "日本語.txt"), "学校の課題");
    await writeFile(path.join(a, "deleted.txt"), "old content");
    await service.request({
      type: "add-destination",
      id: "local-a",
      name: "Local A",
      kind: "local",
      location: repositoryA,
      password,
      existing: false,
    });
    await service.request({
      type: "add-destination",
      id: "local-b",
      name: "Local B",
      kind: "local",
      location: repositoryB,
      password,
      existing: false,
    });
    plan = planSchema.parse({
      id: "fixture-plan",
      name: "Fixture private plan",
      sources: [a, b],
      destinationIds: ["local-a", "local-b"],
      enabled: true,
      includes: [],
      excludes: [],
      schedule: { kind: "manual" },
      retention: { daily: 1, weekly: 0, monthly: 0 },
    });
    await service.request({ type: "save-plan", plan });

    await scenario(
      "local backup commits independently to both repositories",
      async () => {
        const completed = await run(undefined, {
          name: "Before fixture changes",
          pin: true,
        });
        assertSuccess(completed);
        assert.equal(completed.length, 2);
        const destinations = service.state().destinations;
        assert(
          destinations.every(
            (destination) =>
              destination.lastSuccess && destination.lastVerified,
          ),
        );
        firstSnapshot = completed.find(
          (job) => job.destinationId === "local-a",
        )!.snapshotId!;
        assert(firstSnapshot);
      },
    );
    if (!firstSnapshot)
      throw new Error("Initial backup prerequisite did not complete.");

    await scenario(
      "incremental modifications/deletions with second destination unavailable",
      async () => {
        await writeFile(
          path.join(a, "same.txt"),
          "A changed with a different size",
        );
        await unlink(path.join(a, "deleted.txt"));
        await writeFile(path.join(b, "added.txt"), "new content");
        await rename(repositoryB, repositoryB + "-offline");
        const completed = await run();
        assert.equal(completed.length, 2);
        const local = completed.find((job) => job.destinationId === "local-a")!;
        const failed = completed.find(
          (job) => job.destinationId === "local-b",
        )!;
        assert.equal(local.status, "success", local.error);
        assert.equal(failed.status, "failed");
        assert.equal(local.deleted, 1);
        assert(local.changed >= 1);
        assert(local.added >= 1);
        assert(
          service
            .state()
            .destinations.find((destination) => destination.id === "local-a")
            ?.lastSuccess,
        );
        assert.equal(
          service
            .state()
            .destinations.find((destination) => destination.id === "local-b")
            ?.status,
          "attention",
        );
        latestSnapshot = local.snapshotId!;
        failedJob = failed.id;
      },
    );

    await scenario(
      "reconnection and retry run only the failed destination",
      async () => {
        await rename(repositoryB + "-offline", repositoryB);
        await service.request({
          type: "reconnect-destination",
          id: "local-b",
          location: repositoryB,
        });
        assert(failedJob);
        const before = (await snapshotList("local-a")).length;
        const retry = (await service.request({
          type: "retry",
          id: failedJob,
        })) as string;
        const completed = await jobs([retry]);
        assertSuccess(completed);
        assert.equal(completed[0].destinationId, "local-b");
        assert.equal(completed[0].retryOf, failedJob);
        assert.equal((await snapshotList("local-a")).length, before);
      },
    );

    await scenario(
      "full restore is byte-for-byte with identical relative paths, Unicode and empty files",
      async () => {
        assert(latestSnapshot);
        const id = (await service.request({
          type: "restore",
          destinationId: "local-a",
          snapshotId: latestSnapshot,
          target: restored,
          paths: [],
          overwrite: "never",
        })) as string;
        assertSuccess(await jobs([id]));
        for (const source of [
          path.join(a, "same.txt"),
          path.join(b, "same.txt"),
          path.join(a, "empty.txt"),
          path.join(a, "日本語.txt"),
          path.join(b, "added.txt"),
        ])
          assert.deepEqual(
            await readFile(path.join(restored, snapshotPath(source))),
            await readFile(source),
          );
        assert(
          (
            await stat(
              path.join(restored, snapshotPath(path.join(a, "empty-folder"))),
            )
          ).isDirectory(),
        );
        await assert.rejects(
          stat(path.join(restored, snapshotPath(path.join(a, "deleted.txt")))),
        );
      },
    );

    await scenario(
      "restore collisions never report skipped files as complete success",
      async () => {
        const targetFile = path.join(
          restored,
          snapshotPath(path.join(a, "same.txt")),
        );
        await writeFile(targetFile, "user-owned existing content");
        const id = (await service.request({
          type: "restore",
          destinationId: "local-a",
          snapshotId: latestSnapshot,
          target: restored,
          paths: [snapshotPath(path.join(a, "same.txt"))],
          overwrite: "never",
        })) as string;
        const [job] = await jobs([id]);
        assert.notEqual(job.status, "success");
        assert.equal(
          await readFile(targetFile, "utf8"),
          "user-owned existing content",
        );
      },
    );

    await scenario(
      "retention preserves pinned versions and a retained snapshot still restores",
      async () => {
        const saved = service
          .state()
          .plans.find((item) => item.id === plan.id)!;
        await service.request({
          type: "save-plan",
          plan: { ...saved, pruningSuspended: false },
        });
        assertSuccess(await run("local-a"));
        const before = await snapshotList("local-a");
        assert(
          before.some(
            (snapshot) => snapshot.id === firstSnapshot && snapshot.pinned,
          ),
        );
        const id = (await service.request({
          type: "retention",
          planId: plan.id,
          destinationId: "local-a",
          preview: false,
        })) as string;
        assertSuccess(await jobs([id]));
        const after = await snapshotList("local-a");
        assert(after.some((snapshot) => snapshot.id === firstSnapshot));
        assert(after.length < before.length);
        const target = path.join(fixture, "retained-original");
        const restoreId = (await service.request({
          type: "restore",
          destinationId: "local-a",
          snapshotId: firstSnapshot,
          target,
          paths: [],
          overwrite: "never",
        })) as string;
        assertSuccess(await jobs([restoreId]));
        assert.equal(
          await readFile(
            path.join(target, snapshotPath(path.join(a, "same.txt"))),
            "utf8",
          ),
          "A original",
        );
        assert.equal(
          await readFile(
            path.join(target, snapshotPath(path.join(a, "deleted.txt"))),
            "utf8",
          ),
          "old content",
        );
      },
    );

    await scenario(
      "wrong recovery password is rejected without altering connection",
      async () => {
        await assert.rejects(
          service.request({
            type: "verify-password",
            destinationId: "local-a",
            password: "wrong-fixture-password",
          }),
          /password/i,
        );
        assert.equal(
          await service.request({
            type: "verify-password",
            destinationId: "local-a",
            password,
          }),
          true,
        );
      },
    );

    await scenario(
      "diagnostics exclude source paths, plan names and credentials",
      async () => {
        const diagnostic = (await service.request({
          type: "diagnostics",
        })) as string;
        for (const sensitive of [
          password,
          a,
          b,
          repositoryA,
          plan.name,
          "学校の課題",
        ])
          assert(!diagnostic.includes(sensitive));
        assert.equal(
          (JSON.parse(diagnostic) as { platform: string }).platform,
          "win32",
        );
      },
    );

    await scenario(
      "paused queued jobs cancel durably, resume after restart and preserve history",
      async () => {
        await settings({ paused: true });
        const queued = (await service.request({
          type: "run",
          planId: plan.id,
        })) as string[];
        assert.equal(queued.length, 2);
        await service.request({ type: "cancel", id: queued[0] });
        assert.equal(service.store.getJob(queued[0]).status, "cancelled");
        const historyBefore = service.store.jobs().total;
        await service.close();
        service = new BackupService({
          data,
          engines,
          secrets,
          clientId: "",
          host,
        });
        await service.start();
        assert.equal(service.store.getJob(queued[0]).status, "cancelled");
        assert.equal(service.store.getJob(queued[1]).status, "queued");
        assert.equal(service.store.jobs().total, historyBefore);
        await settings({ paused: false });
        assertSuccess(await jobs([queued[1]]));
      },
    );

    await scenario(
      "interrupted durable state is surfaced after worker restart",
      async () => {
        const model = service.store
          .jobs()
          .jobs.find((job) => job.status === "success")!;
        const interrupted: Job = {
          ...model,
          id: randomUUID(),
          status: "running",
          finishedAt: undefined,
          phase: "Backing up",
        };
        service.store.job(interrupted);
        await service.close();
        service = new BackupService({
          data,
          engines,
          secrets,
          clientId: "",
          host,
        });
        await service.start();
        assert.equal(
          service.store.getJob(interrupted.id).status,
          "interrupted",
        );
        assert.match(
          service.store.getJob(interrupted.id).error ?? "",
          /stopped during/,
        );
      },
    );

    await scenario(
      "overdue schedule catches up once after resume and advances its durable due time",
      async () => {
        const saved = service
          .state()
          .plans.find((item) => item.id === plan.id)!;
        await service.request({
          type: "save-plan",
          plan: {
            ...saved,
            schedule: { ...saved.schedule, kind: "interval", minutes: 15 },
          },
        });
        service.store.put("due", plan.id, "2020-01-01T00:00:00.000Z");
        const before = service.store.jobs().total;
        await service.tick();
        const scheduled = service.store
          .jobs()
          .jobs.filter((job) => job.trigger === "schedule");
        assert.equal(scheduled.length, 2);
        assertSuccess(await jobs(scheduled.map((job) => job.id)));
        await service.tick();
        assert.equal(service.store.jobs().total, before + 2);
        assert(
          Date.parse(service.store.get<string>("due", plan.id)!) > Date.now(),
        );
      },
    );

    await scenario(
      "missing local catalog reconnect recovers named/pinned snapshots and restores",
      async () => {
        const recoverySecrets: Record<string, string> = {};
        const freshOptions = {
          data: path.join(fixture, "fresh-install"),
          engines,
          secrets: recoverySecrets,
          clientId: "",
          host: {
            ...host,
            saveSecret: async (key: string, value?: string) => {
              if (value === undefined) delete recoverySecrets[key];
              else recoverySecrets[key] = value;
            },
          },
        };
        let fresh = new BackupService(freshOptions);
        try {
          await fresh.start();
          await fresh.request({
            type: "add-destination",
            id: "recovered-repository",
            name: "Recovered",
            kind: "local",
            location: repositoryA,
            password,
            existing: true,
          });
          const snapshots = await snapshotList("recovered-repository", fresh);
          assert(snapshots.length >= 2);
          const first = snapshots.find(
            (snapshot) => snapshot.id === firstSnapshot,
          )!;
          assert(first);
          assert.equal(first.planName, plan.name);
          assert.equal(first.name, "Before fixture changes");
          assert(first.pinned);
          await fresh.close();
          delete recoverySecrets["recovered-repository"];
          fresh = new BackupService(freshOptions);
          await fresh.start();
          assert.equal(
            await fresh.request({
              type: "verify-password",
              destinationId: "recovered-repository",
              password,
            }),
            true,
          );
          await fresh.request({
            type: "reconnect-destination",
            id: "recovered-repository",
            location: repositoryA,
            password,
          });
          const target = path.join(fixture, "fresh-install-restore");
          const id = (await fresh.request({
            type: "restore",
            destinationId: "recovered-repository",
            snapshotId: first.id,
            target,
            paths: [],
            overwrite: "never",
          })) as string;
          assertSuccess(await jobs([id], fresh));
          assert.equal(
            await readFile(
              path.join(target, snapshotPath(path.join(a, "same.txt"))),
              "utf8",
            ),
            "A original",
          );
        } finally {
          await fresh.close();
        }
      },
    );
  } catch (error) {
    results.push({
      scenario: "fixture prerequisites",
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await service.close();
    const evidence = {
      fixture,
      at: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      results,
    };
    await writeFile(
      path.join(fixture, "results.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence, null, 2));
    if (results.some((result) => !result.passed)) process.exitCode = 1;
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
