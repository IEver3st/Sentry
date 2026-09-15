import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "sentry-engine-proof-"));
const repo = join(root, "repository");
const a = join(root, "a");
const b = join(root, "b");
mkdirSync(join(a, "empty-folder"), { recursive: true });
mkdirSync(b);
writeFileSync(join(a, "same.txt"), "source A");
writeFileSync(join(b, "same.txt"), "source B");
writeFileSync(join(a, "empty"), "");
writeFileSync(join(a, "日本語.txt"), "Unicode content");
writeFileSync(join(a, "deleted.txt"), "old version");
const password = "fixture-only-not-a-user-credential";
function run(args: string[], key = password) {
  const r = spawnSync(
    resolve("vendor/bin/restic.exe"),
    ["--repo", repo, "--json", "--no-cache", ...args],
    {
      env: { ...process.env, RESTIC_PASSWORD: key },
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );
  if (r.error) throw r.error;
  return r;
}
assert.equal(run(["init"]).status, 0);
const first = run(["backup", a, b]);
assert.equal(first.status, 0, first.stderr);
const firstSummary = first.stdout
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .find((x) => x.message_type === "summary");
writeFileSync(join(a, "same.txt"), "source A updated");
unlinkSync(join(a, "deleted.txt"));
const second = run(["backup", a, b]);
assert.equal(second.status, 0, second.stderr);
const secondSummary = second.stdout
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .find((x) => x.message_type === "summary");
assert.equal(secondSummary.files_changed, 1);
assert.equal(secondSummary.files_unmodified, 3);
const snapshots = JSON.parse(run(["snapshots"]).stdout);
assert.equal(snapshots.length, 2);
const nodes = run(["ls", snapshots[1].id])
  .stdout.trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const target = join(root, "restored");
const restored = run([
  "restore",
  snapshots[1].id + ":" + root.replaceAll("\\", "/").replace(":", ""),
  "--target",
  target,
  "--verify",
]);
assert.equal(restored.status, 0, restored.stderr);
for (const node of nodes.filter((x) => x.type === "file")) {
  const source = node.path.replace(/^\/([A-Za-z])\//, "$1:/");
  assert.deepEqual(
    readFileSync(join(target, node.path.slice(root.length + 1))),
    readFileSync(source),
  );
}
assert.ok(nodes.some((x) => x.name === "empty-folder" && x.type === "dir"));
assert.ok(!nodes.some((x) => x.name === "deleted.txt"));
assert.equal(run(["snapshots"], "wrong-key").status, 12);
assert.equal(run(["check", "--read-data"]).status, 0);
const oldTarget = join(root, "old-version");
assert.equal(
  run([
    "restore",
    snapshots[0].id + ":" + root.replaceAll("\\", "/").replace(":", ""),
    "--target",
    oldTarget,
    "--verify",
  ]).status,
  0,
);
const deletedNode = run(["ls", snapshots[0].id])
  .stdout.trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .find((x) => x.name === "deleted.txt");
assert.ok(existsSync(join(oldTarget, deletedNode.path.slice(root.length + 1))));
console.log(
  JSON.stringify(
    {
      root,
      restic: "0.19.1",
      first: firstSummary,
      second: secondSummary,
      proof:
        "two roots; byte restore; incremental modification; deleted-file history; empty file and directory; Unicode; wrong key; no app database; full check",
    },
    null,
    2,
  ),
);
