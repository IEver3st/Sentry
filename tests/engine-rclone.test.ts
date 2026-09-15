import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResticEngine } from "../src/engine/restic";
import { snapshotPath } from "../src/engine/paths";

test("bundled rclone transport operates a real repository through environment-only configuration", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sentry-rclone-proof-"));
  const source = path.join(dir, "source");
  await mkdir(source);
  await writeFile(path.join(source, "sample.txt"), "rclone transport fixture");
  const engine = new ResticEngine({
    executable: path.resolve("vendor/bin/restic.exe"),
    rcloneExecutable: path.resolve("vendor/bin/rclone.exe"),
  });
  const repo = {
    location: `rclone:sentry:${path.join(dir, "repository").replaceAll("\\", "/")}`,
    password: "transport-fixture-password",
    env: { RCLONE_CONFIG_SENTRY_TYPE: "local" },
  };
  expect(await engine.init(repo)).toHaveLength(64);
  const backup = await engine.backup(repo, {
    sources: [source],
    planId: "transport",
  });
  const target = path.join(dir, "restore");
  await engine.restore(repo, {
    snapshotId: String(backup.summary.snapshot_id),
    target,
    overwrite: "never",
  });
  expect(
    await readFile(
      path.join(target, snapshotPath(path.join(source, "sample.txt"))),
      "utf8",
    ),
  ).toBe("rclone transport fixture");
  console.log(
    `Transport fixture evidence (local rclone backend, not Google Drive): ${dir}`,
  );
}, 120_000);
