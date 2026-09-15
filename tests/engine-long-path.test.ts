import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResticEngine } from "../src/engine/restic";
import { snapshotPath } from "../src/engine/paths";

test("Windows long Unicode paths and renamed files restore from both retained snapshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sentry-long-path-proof-"));
  const source = path.join(root, "source");
  const deep = path.join(
    source,
    ...Array.from(
      { length: 7 },
      (_, i) => `学校の課題-${i}-long-folder-name-0123456789`,
    ),
  );
  await mkdir(deep, { recursive: true });
  const original = path.join(deep, "日本語の研究ノート.txt");
  const renamed = path.join(deep, "変更後の研究ノート.txt");
  expect(original.length).toBeGreaterThan(260);
  const bytes = Buffer.from(
    "Unicode long-path fixture\0\r\n研究資料の保存と復元\n",
    "utf8",
  );
  await writeFile(original, bytes);
  const repo = {
    location: path.join(root, "repository"),
    password: "long-path-fixture-password",
  };
  const engine = new ResticEngine({
    executable: path.resolve("vendor/bin/restic.exe"),
  });
  await engine.init(repo);
  const before = await engine.backup(repo, {
    sources: [source],
    planId: "long-path-fixture",
    pin: true,
  });
  expect(before.code).toBe(0);
  await rename(original, renamed);
  const after = await engine.backup(repo, {
    sources: [source],
    planId: "long-path-fixture",
  });
  expect(after.code).toBe(0);
  await engine.retain(repo, {
    planId: "long-path-fixture",
    daily: 1,
    weekly: 0,
    monthly: 0,
    dryRun: false,
  });
  const retained = await engine.snapshots(repo);
  expect(retained.some((s) => s.id === before.summary.snapshot_id)).toBe(true);
  expect(retained.some((s) => s.id === after.summary.snapshot_id)).toBe(true);
  const oldTarget = path.join(root, "restore-before");
  const newTarget = path.join(root, "restore-after");
  await engine.restore(repo, {
    snapshotId: String(before.summary.snapshot_id),
    target: oldTarget,
    overwrite: "never",
  });
  await engine.restore(repo, {
    snapshotId: String(after.summary.snapshot_id),
    target: newTarget,
    overwrite: "never",
  });
  expect(await readFile(path.join(oldTarget, snapshotPath(original)))).toEqual(
    bytes,
  );
  expect(await readFile(path.join(newTarget, snapshotPath(renamed)))).toEqual(
    bytes,
  );
  await expect(
    stat(path.join(newTarget, snapshotPath(original))),
  ).rejects.toThrow();
  await expect(
    stat(path.join(oldTarget, snapshotPath(renamed))),
  ).rejects.toThrow();
  console.log(
    `Long-path fixture: ${original.length} source characters; evidence ${root}`,
  );
}, 120_000);
