import { describe, expect, test } from "bun:test";
import { DiagnosticLog } from "../src/main/diagnostics";
import { requestSchema, type Job, type State } from "../src/shared/contracts";

describe("diagnostics metadata boundary", () => {
  test("bounds session retention and returns newest entries first", () => {
    const log = new DiagnosticLog();
    for (let i = 0; i < 510; i++) log.add({ source: "request", level: "info", message: "Request completed", durationMs: i });
    const report = log.snapshot();
    expect(report.events).toHaveLength(500);
    expect(report.droppedEvents).toBe(10);
    expect(report.events[0].durationMs).toBe(509);
    report.events.pop();
    expect(log.snapshot().events).toHaveLength(500);
  });
  test("records actual transitions without leaking job names, paths or errors", () => {
    const log = new DiagnosticLog();
    const job = { id: "job1", kind: "backup", status: "success", planName: "Private project", destinationName: "Private drive", error: "token=secret C:\\private\\file" } as Job;
    log.observe({ jobs: [job] } as State);
    expect(log.snapshot().events).toHaveLength(0);
    log.observe({ jobs: [{ ...job, status: "running" }] } as State);
    log.observe({ jobs: [{ ...job, status: "partial" }] } as State);
    log.observe({ jobs: [{ ...job, status: "partial" }] } as State);
    expect(log.snapshot().events).toHaveLength(2);
    expect(log.snapshot().events[0].level).toBe("warning");
    const serialized = JSON.stringify(log.snapshot());
    for (const sensitive of ["Private", "token", "secret", "private", "file"]) expect(serialized).not.toContain(sensitive);
  });
  test("snapshot request accepts no data or file arguments", () => {
    expect(requestSchema.parse({ type: "diagnostics-snapshot", path: "C:\\private", password: "secret" })).toEqual({ type: "diagnostics-snapshot" });
  });
});
