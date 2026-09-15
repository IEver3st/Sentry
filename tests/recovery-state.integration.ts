import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { BackupService } from "../src/engine/service";
import type { Job } from "../src/shared/contracts";

test("abandoning a retry releases ancestor copy holds and a later retry acquires a fresh hold", async () => {
  await mkdir("outputs/recovery-state", { recursive: true });
  const data = await mkdtemp(resolve("outputs/recovery-state/run-"));
  const service = new BackupService({ data, engines: resolve("vendor/bin"), secrets: {}, clientId: "", host: { saveSecret: async () => {}, authorize: async () => {}, publish: () => {} } });
  try {
    await service.request({ type: "settings", settings: { ...service.state().settings, paused: true } });
    const failed: Job = { id: "failed-copy", kind: "copy", status: "failed", planName: "Fixture", destinationId: "target", destinationName: "Fixture target", sourceDestinationId: "source", trigger: "manual", createdAt: new Date().toISOString(), phase: "failed", bytes: 0, transferred: 0, added: 0, changed: 0, deleted: 0, skipped: 0 };
    service.store.enqueue(failed, { sourceDestinationId: "source", snapshotId: "a".repeat(64) });
    const retry = await service.request({ type: "retry", id: failed.id }) as string;
    await service.request({ type: "cancel", id: retry });
    assert.equal(service.store.getJob(retry).status, "cancelled");
    assert.equal(service.store.get<{ copyResolved: boolean }>("payload", failed.id)?.copyResolved, true);
    const later = await service.request({ type: "retry", id: failed.id }) as string;
    assert.equal(service.store.get<{ copyResolved: boolean }>("payload", later)?.copyResolved, false);
    assert.equal(service.store.getJob(later).status, "queued");
  } finally { await service.close(); }
});
