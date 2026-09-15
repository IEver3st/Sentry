import type { Job } from "../shared/contracts";

export const outcomes = [
  { status: "success", label: "Complete", color: "var(--accent)" },
  { status: "partial", label: "Partial", color: "var(--warn)" },
  { status: "failed", label: "Failed", color: "var(--bad)" },
  { status: "cancelled", label: "Cancelled", color: "var(--subtle)" },
  { status: "interrupted", label: "Interrupted", color: "var(--overview-interrupted)" },
] as const;
export type Outcome = (typeof outcomes)[number]["status"];
const counts = (): Record<Outcome, number> => ({ success: 0, partial: 0, failed: 0, cancelled: 0, interrupted: 0 });
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Presentation-only aggregation of the engine's bounded state feed. No catalog reads.
export function backupInsights(jobs: Job[], days: 7 | 30, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - days + 1);
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { key: dayKey(date), date, counts: counts(), total: 0, bytes: 0 };
  });
  const byDay = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const totals = counts();
  let processed = 0;
  for (const job of jobs) {
    if (job.kind !== "backup" || !job.finishedAt || !outcomes.some((outcome) => outcome.status === job.status)) continue;
    const finished = new Date(job.finishedAt);
    if (!Number.isFinite(finished.getTime()) || finished > now || finished < start) continue;
    const bucket = byDay.get(dayKey(finished));
    if (!bucket) continue;
    const status = job.status as Outcome;
    bucket.counts[status]++;
    bucket.total++;
    totals[status]++;
    if (status === "success") {
      const value = Number.isFinite(job.bytes) ? Math.max(0, job.bytes) : 0;
      bucket.bytes += value;
      processed += value;
    }
  }
  return { buckets, totals, processed, total: Object.values(totals).reduce((a, b) => a + b, 0) };
}
