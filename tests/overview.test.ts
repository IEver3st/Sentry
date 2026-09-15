import { expect, test } from "bun:test";
import { backupInsights } from "../src/renderer/overview-data";
import { defaultOverview, defaults, settingsSchema, type Job } from "../src/shared/contracts";

const now = new Date(2026, 8, 15, 12);
const job = (overrides: Partial<Job> = {}): Job => ({
  id: "job", planName: "Documents", destinationId: "local", destinationName: "Local",
  kind: "backup", trigger: "manual", status: "success", phase: "done",
  createdAt: now.toISOString(), finishedAt: now.toISOString(), bytes: 1024,
  transferred: 10, added: 1, changed: 0, deleted: 0, skipped: 0, ...overrides,
});

test("overview keeps incomplete outcomes separate and counts bytes only from complete backups", () => {
  const data = backupInsights([
    job(), job({ status: "partial" }), job({ status: "failed" }), job({ status: "cancelled" }),
    job({ status: "interrupted" }), job({ status: "running" }), job({ status: "queued" }),
    job({ kind: "restore" }), job({ kind: "check" }), job({ kind: "copy" }), job({ kind: "test-recovery" }),
  ], 7, now);
  expect(data.total).toBe(5);
  expect(data.totals).toEqual({ success: 1, partial: 1, failed: 1, cancelled: 1, interrupted: 1 });
  expect(data.processed).toBe(1024);
});

test("overview uses local calendar boundaries and completion dates, excluding invalid and future records", () => {
  const firstDay = new Date(2026, 8, 9);
  const data = backupInsights([
    job({ createdAt: new Date(2026, 7, 1).toISOString(), finishedAt: firstDay.toISOString() }),
    job({ finishedAt: new Date(firstDay.getTime() - 1).toISOString() }),
    job({ finishedAt: new Date(now.getTime() + 1).toISOString() }),
    job({ finishedAt: undefined }), job({ finishedAt: "invalid" }),
  ], 7, now);
  expect(data.total).toBe(1);
  expect(data.buckets).toHaveLength(7);
  expect(data.buckets[0].total).toBe(1);
  expect(data.buckets.at(-1)?.total).toBe(0);
  expect(backupInsights([], 30, now).buckets).toHaveLength(30);
});

test("overview preferences preserve old settings, allow a simplified view, and reject invalid sections", () => {
  expect(settingsSchema.parse(defaults).overview).toBeUndefined();
  expect(settingsSchema.parse({ ...defaults, overview: defaultOverview }).overview).toEqual(defaultOverview);
  expect(settingsSchema.parse({ ...defaults, overview: { days: 30, widgets: [] } }).overview?.widgets).toEqual([]);
  for (const overview of [{ days: 90, widgets: [] }, { days: 7, widgets: ["unknown"] }, { days: 7, widgets: ["data", "data"] }]) {
    expect(settingsSchema.safeParse({ ...defaults, overview }).success).toBe(false);
  }
});
