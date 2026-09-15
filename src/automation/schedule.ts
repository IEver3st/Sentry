import type { Schedule } from "../shared/contracts";

/** Next occurrence strictly after `after`. Calendar schedules follow the host's local time zone.
 * A missing spring-forward time rolls forward by the DST gap; a repeated autumn time runs once.
 * Monthly days 29–31 clamp to the final day of shorter months. */
export function nextRun(schedule: Schedule, after: Date): Date | null {
  if (!Number.isFinite(after.getTime()))
    throw new Error("Invalid schedule reference time");
  if (schedule.kind === "manual") return null;
  if (schedule.kind === "interval")
    return new Date(after.getTime() + schedule.minutes * 60_000);
  const [hour, minute] = schedule.time.split(":").map(Number);
  if (schedule.kind === "monthly") {
    for (let offset = 0; offset < 14; offset++) {
      const month = new Date(
        after.getFullYear(),
        after.getMonth() + offset,
        1,
        12,
      );
      const lastDay = new Date(
        month.getFullYear(),
        month.getMonth() + 1,
        0,
        12,
      ).getDate();
      const candidate = new Date(
        month.getFullYear(),
        month.getMonth(),
        Math.min(schedule.day, lastDay),
        hour,
        minute,
      );
      if (candidate > after) return candidate;
    }
  } else {
    for (let offset = 0; offset < 9; offset++) {
      const day = new Date(
        after.getFullYear(),
        after.getMonth(),
        after.getDate() + offset,
        12,
      );
      if (schedule.kind === "weekly" && day.getDay() !== schedule.weekday)
        continue;
      const candidate = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
      );
      if (candidate > after) return candidate;
    }
  }
  throw new Error("Cannot calculate next schedule occurrence");
}

/** Persist nextDue with the job enqueue transaction. An overdue occurrence is one catch-up job,
 * never one job per missed interval. After enqueue, compute nextRun(schedule, now). */
export function isDue(
  schedule: Schedule,
  nextDue: string | null | undefined,
  now = new Date(),
): boolean {
  if (schedule.kind === "manual" || !nextDue) return false;
  const due = Date.parse(nextDue);
  return Number.isFinite(due) && due <= now.getTime();
}

/** On a time-zone change preserve overdue work, but recalculate future wall-clock occurrences. */
export function reconcileTimeZone(
  schedule: Schedule,
  nextDue: string | null,
  now = new Date(),
): string | null {
  if (schedule.kind === "manual") return null;
  if (isDue(schedule, nextDue, now) || schedule.kind === "interval")
    return nextDue ?? nextRun(schedule, now)?.toISOString() ?? null;
  return nextRun(schedule, now)?.toISOString() ?? null;
}
