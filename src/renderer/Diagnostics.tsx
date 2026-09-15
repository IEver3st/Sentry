import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Download, Pause, Play, RefreshCw } from "lucide-react";
import type { DiagnosticsSnapshot } from "../shared/contracts";
import { Button, Field, Notice, Select, bytes, date, useApp } from "./ui";

type Sample = { at: number; cpu: number; memory: number };
const percent = (n: number) => `${n.toFixed(1)}%`;
export function Diagnostics() {
  const { state } = useApp();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState("");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [minutes, setMinutes] = useState("5");
  const [metric, setMetric] = useState("cpu");
  const [page, setPage] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const next = await window.sentry.request({ type: "diagnostics-snapshot" });
      if (!mounted.current) return;
      setSnapshot(next);
      setError("");
      setSamples((previous) => next.processes.some((p) => p.cpu === null) ? previous : [...previous, { at: Date.parse(next.capturedAt), cpu: next.processes.reduce((n, p) => n + (p.cpu ?? 0), 0), memory: next.processes.reduce((n, p) => n + p.memory, 0) }].filter((s) => s.at >= Date.now() - 15 * 60_000).slice(-450));
    } catch {
      if (mounted.current) setError("Could not refresh diagnostics. The last captured values are retained.");
    } finally { pending.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!live) return;
    const tick = () => { if (!document.hidden) void refresh(); };
    tick();
    const timer = setInterval(tick, 2000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [live, refresh]);
  const events = (snapshot?.events ?? []).filter((e) => (level === "all" || e.level === level) && (source === "all" || e.source === source) && `${e.message} ${e.operation ?? ""} ${e.jobId ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(events.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = events.slice(currentPage * 50, (currentPage + 1) * 50);
  const selectedSamples = samples.filter((s) => s.at >= (samples.at(-1)?.at ?? Date.now()) - Number(minutes) * 60_000);
  const cpu = snapshot?.processes.reduce((n, p) => n + (p.cpu ?? 0), 0) ?? 0;
  const memory = snapshot?.processes.reduce((n, p) => n + p.memory, 0) ?? 0;
  const engine = snapshot?.engine;
  async function exportReport() {
    setExporting(true); setExportResult("");
    try {
      const result = await window.sentry.request({ type: "diagnostics" });
      if (mounted.current) setExportResult(result === "Export cancelled" ? result : result.startsWith("{") ? "Diagnostics generated in hidden validation mode." : `Saved to ${result}`);
    } catch { if (mounted.current) setExportResult("Export failed. Try again and choose a writable location."); }
    finally { if (mounted.current) setExporting(false); }
  }
  return <div className="diagnostics-workspace">
    <div className="diagnostics-toolbar">
      <span className="diagnostics-collection"><Activity size={15} aria-hidden="true" />{!live ? "Collection paused" : error ? "Collection failed" : snapshot ? "Live · every 2 seconds" : "Connecting to collector"}</span>
      <div className="button-group">
        <Button size="small" onClick={() => setLive(!live)}>{live ? <Pause size={14} /> : <Play size={14} />}{live ? "Pause" : "Resume"}</Button>
        <Button size="icon" aria-label="Refresh diagnostics" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} /></Button>
        <Button size="small" disabled={exporting} onClick={() => void exportReport()}><Download size={14} />{exporting ? "Exporting…" : "Export report"}</Button>
      </div>
    </div>
    {error && <Notice error>{error}</Notice>}
    {exportResult && <Notice error={exportResult.startsWith("Export failed")}>{exportResult}</Notice>}
    {!snapshot ? <p role="status" className="diagnostics-empty">{loading ? "Reading application and backup-worker counters…" : "No sample yet. Refresh to try again."}</p> : <>
      <section className="diagnostics-footprint" aria-labelledby="footprint-title">
        <div className="diagnostics-section-title"><h3 id="footprint-title">Sentry footprint</h3><span>Captured {new Date(snapshot.capturedAt).toLocaleTimeString()}</span></div>
        <div className="diagnostics-metrics">
          <div><span>CPU · machine capacity</span><strong>{snapshot.processes.some((p) => p.cpu === null) ? "Warming up" : percent(cpu)}</strong><small>{snapshot.runtime.logicalCores} logical processors</small></div>
          <div><span>Resident memory</span><strong>{bytes(memory)}</strong><small>Summed working sets / RSS</small></div>
          <div><span>Measured processes</span><strong>{snapshot.processes.length}</strong><small>{engine ? "Electron + backup worker" : "Electron only · partial"}</small></div>
        </div>
        <p className="hint">Backup subprocesses (restic / rclone) and disk I/O are not included in these counters.</p>
      </section>
      <div className="diagnostics-health">
        <section><h3>Host & runtime</h3><dl>
          <div><dt>Power source</dt><dd>{snapshot.runtime.battery ? "Battery" : "External power"}</dd></div>
          <div><dt>System memory available</dt><dd>{bytes(snapshot.runtime.freeMemory)} / {bytes(snapshot.runtime.totalMemory)}</dd></div>
          <div><dt>System idle</dt><dd>{snapshot.runtime.idleSeconds}s</dd></div>
          <div><dt>Session uptime</dt><dd>{Math.floor(snapshot.runtime.uptime / 60)}m {Math.floor(snapshot.runtime.uptime % 60)}s</dd></div>
          <div><dt>Credential encryption</dt><dd>{snapshot.runtime.encryption ? "Available" : "Unavailable"}</dd></div>
          <div><dt>Sentry / Electron / Node</dt><dd>{snapshot.runtime.app} / {snapshot.runtime.electron} / {snapshot.runtime.node}</dd></div>
          <div><dt>Platform</dt><dd>{snapshot.runtime.platform} · {snapshot.runtime.arch}</dd></div>
        </dl></section>
        <section><h3>Engine & collection</h3><dl>
          <div><dt>Backup worker</dt><dd className={engine ? "diagnostics-good" : "diagnostics-warning"}>{engine ? "Responding" : "Unavailable"}</dd></div>
          <div><dt>Backup engine</dt><dd>{engine?.version ?? "Unavailable"}</dd></div>
          <div><dt>Protection scheduling</dt><dd>{engine ? engine.paused ? "Paused" : engine.busy ? "Working" : state.plans.some((p) => p.enabled) ? "Enabled" : "No enabled plans" : "Unknown"}</dd></div>
          <div><dt>Destinations needing attention</dt><dd>{engine ? `${engine.unavailable} / ${engine.destinations}` : "Unknown"}</dd></div>
          <div><dt>Job history / queue</dt><dd>{engine ? `${engine.jobs} / ${engine.queued}` : "Unknown"}</dd></div>
          <div><dt>Google Drive</dt><dd>{engine ? engine.googleConnected ? "Connected" : "Disconnected" : "Unknown"}</dd></div>
          <div><dt>Weather collection</dt><dd>{engine ? engine.weatherError ? "Last check failed" : engine.weatherLastCheck ? date(engine.weatherLastCheck) : "Not checked" : "Unknown"}</dd></div>
          <div><dt>Collection / pending requests</dt><dd>{snapshot.collectionMs.toFixed(1)} ms / {snapshot.runtime.pendingRequests}</dd></div>
        </dl></section>
      </div>
      {snapshot.engineError && <Notice error>{snapshot.engineError}</Notice>}
      <section className="diagnostics-section">
        <div className="diagnostics-section-title"><h3>Resource timeline</h3><div className="button-group">
          <Select aria-label="Timeline metric" value={metric} onValueChange={setMetric}><option value="cpu">CPU %</option><option value="memory">Memory</option></Select>
          <Select aria-label="Timeline range" value={minutes} onValueChange={setMinutes}><option value="5">5 minutes</option><option value="15">15 minutes</option></Select>
        </div></div>
        <Timeline samples={selectedSamples} metric={metric} minutes={Number(minutes)} />
        <p className="hint">This panel session only · gaps indicate collection pauses · {selectedSamples.length} samples</p>
        <div className="diagnostics-table-scroll" tabIndex={0} role="region" aria-label="Measured processes">
          <table className="diagnostics-table"><thead><tr><th scope="col">Process</th><th scope="col">PID</th><th scope="col">CPU</th><th scope="col">Memory</th></tr></thead><tbody>
            {snapshot.processes.map((p) => <tr key={p.pid}><th scope="row">{p.name}</th><td>{p.pid}</td><td>{p.cpu === null ? "Warming up" : percent(p.cpu)}</td><td>{bytes(p.memory)}</td></tr>)}
          </tbody></table>
        </div>
      </section>
    </>}
    <section className="diagnostics-section">
      <div className="diagnostics-section-title"><h3>Event log</h3><span>{events.length} matching / {snapshot?.events.length ?? 0} retained</span></div>
      <div className="diagnostics-filters">
        <Field label="Search events"><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Operation, message or job ID" /></Field>
        <Field label="Severity"><Select value={level} onValueChange={(v) => { setLevel(v); setPage(0); }}><option value="all">All severities</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></Select></Field>
        <Field label="Source"><Select value={source} onValueChange={(v) => { setSource(v); setPage(0); }}><option value="all">All sources</option><option value="application">Application</option><option value="engine">Engine</option><option value="request">Request</option></Select></Field>
      </div>
      <div className="diagnostics-events">
        {shown.length ? shown.map((event) => <details key={event.id} className="diagnostics-event"><summary><time>{new Date(event.time).toLocaleTimeString()}</time><span className={`diagnostics-${event.level}`}>{event.level}</span><span>{event.operation ? `${event.operation} · ` : ""}{event.message}</span></summary><dl><div><dt>Timestamp</dt><dd>{event.time}</dd></div><div><dt>Source</dt><dd>{event.source}</dd></div>{event.durationMs !== undefined && <div><dt>Request duration</dt><dd>{event.durationMs} ms</dd></div>}{event.jobId && <div><dt>Job ID</dt><dd>{event.jobId}</dd></div>}</dl></details>) : <p className="diagnostics-empty">{query || level !== "all" || source !== "all" ? "No events match these filters." : "No session events have been recorded yet."}</p>}
      </div>
      <div className="diagnostics-section-title diagnostics-pagination"><span>Newest first · latest 500 session events{snapshot?.droppedEvents ? ` · ${snapshot.droppedEvents} older events discarded` : ""}</span><div className="button-group"><Button size="small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span>{currentPage + 1} / {pageCount}</span><Button size="small" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>
      <p className="hint">Requests record completion of the request, not completion of a backup. Reports exclude paths, account details, credentials, file contents and raw engine errors.</p>
    </section>
    <section className="diagnostics-section"><h3>Recent job details</h3><p className="hint">Latest {state.jobs.length} jobs. Local details may contain paths; raw errors are excluded from exports.</p>
      {state.jobs.length === 0 ? <p className="diagnostics-empty">No jobs recorded. Backup, restore and verification results will appear here.</p> : state.jobs.map((job) => <details className="diagnostics-job" key={job.id}><summary><span>{job.planName || job.kind} · {job.destinationName}</span><span className={job.status === "success" ? "diagnostics-good" : "diagnostics-warning"}>{job.status}</span></summary><dl><div><dt>Job / operation</dt><dd>{job.id} / {job.kind}</dd></div><div><dt>Created / finished</dt><dd>{date(job.createdAt)} / {job.finishedAt ? date(job.finishedAt) : "Not finished"}</dd></div><div><dt>Phase / trigger</dt><dd>{job.phase} / {job.trigger}</dd></div><div><dt>Processed / transferred</dt><dd>{bytes(job.bytes)} / {bytes(job.transferred)}</dd></div><div><dt>Added / changed / deleted / skipped</dt><dd>{job.added} / {job.changed} / {job.deleted} / {job.skipped}</dd></div></dl>{job.error && <pre className="diagnostics-error-detail">{job.error}</pre>}</details>)}
    </section>
  </div>;
}

function Timeline({ samples, metric, minutes }: { samples: Sample[]; metric: string; minutes: number }) {
  const memory = metric === "memory";
  const maximum = memory ? Math.max(1, ...samples.map((s) => s.memory)) * 1.1 : Math.max(1, ...samples.map((s) => s.cpu * 1.1));
  const end = samples.at(-1)?.at ?? Date.now();
  const start = Math.max(end - minutes * 60_000, samples[0]?.at ?? end - 1000);
  const points = samples.map((s, i) => `${i === 0 || s.at - samples[i - 1].at > 6000 ? "M" : "L"}${((s.at - start) / Math.max(1, end - start) * 900).toFixed(1)},${(110 - (memory ? s.memory : s.cpu) / maximum * 100).toFixed(1)}`).join(" ");
  return <div className={`diagnostics-chart ${memory ? "is-memory" : ""}`}><div className="diagnostics-chart-label"><span>{memory ? bytes(maximum) : percent(maximum)}</span><span>{memory ? "Resident memory" : "CPU · % of machine capacity"}</span></div>
    {samples.length < 2 ? <div className="diagnostics-chart-empty">Collecting samples. The timeline appears after two readings.</div> : <svg viewBox="0 0 900 120" preserveAspectRatio="none" role="img" aria-label={`${memory ? "Memory" : "CPU"} over the last ${minutes} minutes, ${samples.length} samples`}><path className="diagnostics-grid" d="M0 10H900 M0 60H900 M0 110H900" /><path className="diagnostics-line" d={points} /></svg>}
    <div className="diagnostics-chart-label"><span>{new Date(start).toLocaleTimeString()}</span><span>{new Date(end).toLocaleTimeString()}</span></div></div>;
}
