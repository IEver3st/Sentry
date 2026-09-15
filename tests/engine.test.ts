import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { ResticEngine, type Repository } from "../src/engine/restic";
import {
  previewSources,
  snapshotPath,
  validateSources,
  safeSnapshotPath,
} from "../src/engine/paths";

test("real encrypted snapshots, incrementals, independent catalog recovery, and safe retention restore", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sentry-adapter-proof-"));
  const a = path.join(dir, "A");
  const b = path.join(dir, "B");
  await mkdir(path.join(a, "empty-dir"), { recursive: true });
  await mkdir(b);
  await writeFile(path.join(a, "same.txt"), "A");
  await writeFile(path.join(b, "same.txt"), "B");
  await writeFile(path.join(a, "日本語.txt"), "日本語");
  await writeFile(path.join(a, "zero.txt"), "");
  await writeFile(path.join(a, "deleted.txt"), "old");
  const repo: Repository = {
    location: path.join(dir, "repo"),
    password: "test-recovery-password",
  };
  const engine = new ResticEngine({
    executable: path.resolve("vendor/bin/restic.exe"),
    cacheDir: path.join(dir, "cache"),
  });
  expect(await engine.init(repo)).toHaveLength(64);
  const options = {
    sources: [a, b],
    planId: "fixture",
    planName: "Fixture",
    includes: [],
    excludes: [],
    pin: true,
  };
  const first = await engine.backup(repo, options);
  expect(first.code).toBe(0);
  await writeFile(path.join(a, "same.txt"), "changed A");
  await unlink(path.join(a, "deleted.txt"));
  const second = await engine.backup(repo, { ...options, pin: false });
  expect(second.summary.files_changed).toBe(1);
  expect(second.summary.files_unmodified).toBe(3);
  const fresh = new ResticEngine({
    executable: path.resolve("vendor/bin/restic.exe"),
  });
  const snapshots = await fresh.snapshots(repo);
  expect(snapshots.length).toBe(2);
  const target = path.join(dir, "restore");
  await fresh.restore(repo, {
    snapshotId: String(second.summary.snapshot_id),
    target,
    overwrite: "never",
  });
  expect(
    await readFile(
      path.join(target, snapshotPath(path.join(a, "same.txt"))),
      "utf8",
    ),
  ).toBe("changed A");
  expect(
    await readFile(
      path.join(target, snapshotPath(path.join(b, "same.txt"))),
      "utf8",
    ),
  ).toBe("B");
  await expect(
    fresh.identity({ ...repo, password: "wrong-password" }),
  ).rejects.toThrow("password");
  await fresh.retain(repo, {
    planId: "fixture",
    daily: 1,
    weekly: 0,
    monthly: 0,
    dryRun: false,
  });
  const retained = await fresh.snapshots(repo);
  expect(retained.length).toBe(2);
  await fresh.restore(repo, {
    snapshotId: String(first.summary.snapshot_id),
    target: path.join(dir, "old-restore"),
    overwrite: "never",
  });
  expect((await fresh.check(repo, true)).code).toBe(0);
  const included = await fresh.backup(
    repo,
    { ...options, includes: ["**/*.txt"], excludes: ["deleted.txt"] },
    async (event) => {
      if (event.message_type === "scan_summary") {
        await writeFile(
          path.join(a, "same.txt"),
          "Changed after scanning; captured by the engine",
        );
        await writeFile(
          path.join(a, "late-unmatched.bin"),
          "Must stay outside include selection",
        );
        await writeFile(
          path.join(a, "empty-dir", "late-unmatched.bin"),
          "Must not sneak in through an empty directory",
        );
      }
    },
  );
  expect(included.code).toBe(0);
  const includeTarget = path.join(dir, "include-restore");
  await fresh.restore(repo, {
    snapshotId: String(included.summary.snapshot_id),
    target: includeTarget,
    overwrite: "never",
  });
  expect(
    await readFile(
      path.join(includeTarget, snapshotPath(path.join(a, "same.txt"))),
      "utf8",
    ),
  ).toBe("Changed after scanning; captured by the engine");
  await expect(
    readFile(
      path.join(
        includeTarget,
        snapshotPath(path.join(a, "late-unmatched.bin")),
      ),
    ),
  ).rejects.toThrow();
  await expect(
    readFile(
      path.join(
        includeTarget,
        snapshotPath(path.join(a, "empty-dir", "late-unmatched.bin")),
      ),
    ),
  ).rejects.toThrow();
  await expect(
    validateSources([a], path.join(a, "nested-repo")),
  ).rejects.toThrow("separate");
  const preview = await previewSources([a, b], ["**/*.txt"], []);
  expect(preview.included).toBe(4);
  expect(() => safeSnapshotPath("/C/../escape")).toThrow();
  console.log(`Engine adapter evidence: ${dir}`);
}, 120_000);

test("locked files stay incomplete; interrupted jobs and disconnected repositories recover safely", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sentry-failure-proof-"));
  const source = path.join(dir, "source");
  await mkdir(source);
  await writeFile(path.join(source, "valuable.txt"), "preserve me");
  const engine = new ResticEngine({
    executable: path.resolve("vendor/bin/restic.exe"),
    rcloneExecutable: path.resolve("vendor/bin/rclone.exe"),
  });
  const repo: Repository = {
    location: path.join(dir, "repository"),
    password: "fixture-recovery-password",
  };
  await engine.init(repo);
  const good = await engine.backup(repo, {
    sources: [source],
    planId: "failure-proof",
  });
  await writeFile(
    path.join(source, "valuable.txt"),
    "modified while application owns a lock",
  );
  const lock = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$stream=[System.IO.File]::Open($env:SENTRY_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $stream.Dispose()",
    ],
    {
      env: {
        ...process.env,
        SENTRY_LOCK_FILE: path.join(source, "valuable.txt"),
      },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  try {
    await once(lock.stdout, "data");
    const partial = await engine.backup(repo, {
      sources: [source],
      planId: "failure-proof",
    });
    expect(partial.code).toBe(3);
    expect(
      (await engine.snapshots(repo)).find(
        (s) => s.id === partial.summary.snapshot_id,
      )?.tags,
    ).toContain("sentry:incomplete");
  } finally {
    lock.stdin.end("\n");
    await once(lock, "close");
  }
  await writeFile(
    path.join(source, "large.bin"),
    randomBytes(32 * 1024 * 1024),
  );
  const controller = new AbortController();
  await expect(
    engine.backup(
      repo,
      { sources: [source], planId: "failure-proof" },
      (event) => {
        if (event.message_type === "status") controller.abort();
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  await engine.unlockStale(repo);
  expect((await engine.check(repo, true)).code).toBe(0);
  const { rename } = await import("node:fs/promises");
  const disconnected = path.join(dir, "disconnected");
  await rename(repo.location, disconnected);
  await expect(engine.identity(repo)).rejects.toThrow("unavailable");
  await rename(disconnected, repo.location);
  expect(await engine.identity(repo)).toHaveLength(64);
  await engine.restore(repo, {
    snapshotId: String(good.summary.snapshot_id),
    target: path.join(dir, "recovered"),
    overwrite: "never",
  });
  const cloudFailure: Repository = {
    location: "rclone:sentry:fixture",
    password: repo.password,
    env: { RCLONE_CONFIG_SENTRY_TYPE: "not-a-real-backend" },
  };
  await expect(engine.identity(cloudFailure)).rejects.toThrow();
  expect(
    (await engine.snapshots(repo)).some(
      (s) => s.id === good.summary.snapshot_id,
    ),
  ).toBe(true);
  console.log(`Engine failure evidence: ${dir}`);
}, 120_000);
