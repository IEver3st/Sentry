import type { DiagnosticEvent, State } from "../shared/contracts";

/** Only fixed messages and explicitly selected metadata enter the session log. */
export class DiagnosticLog {
  private entries: DiagnosticEvent[] = [];
  private sequence = 0;
  private dropped = 0;
  private jobs = new Map<string, string>();
  add(event: Omit<DiagnosticEvent, "id" | "time">) {
    this.entries.push({ ...event, id: ++this.sequence, time: new Date().toISOString() });
    if (this.entries.length > 500) { this.entries.shift(); this.dropped++; }
  }
  observe(state: State) {
    for (const job of state.jobs) {
      if (this.jobs.get(job.id) === job.status) continue;
      // Initial history is available in the report, not invented as live events.
      if (this.jobs.has(job.id) || job.status === "queued" || job.status === "running")
        this.add({ source: "engine", level: job.status === "failed" ? "error" : ["partial", "cancelled", "interrupted"].includes(job.status) ? "warning" : "info", message: `${job.kind}: ${job.status}`, jobId: job.id });
    }
    this.jobs = new Map(state.jobs.map((j) => [j.id, j.status]));
  }
  snapshot() { return { events: this.entries.slice().reverse(), droppedEvents: this.dropped }; }
}
