import { useEffect, useState } from "react";
import { Copy, GitCompareArrows } from "lucide-react";
import type { Snapshot, SnapshotChange } from "../shared/contracts";
import { Button, Field, Modal, Notice, Select, date, useApp } from "./ui";

export function SnapshotTools({ snapshot, snapshots, onSelect }: { snapshot: Snapshot; snapshots: Snapshot[]; onSelect: (snapshot: Snapshot, paths: string[]) => void }) {
  const { state, perform } = useApp();
  const [mode, setMode] = useState<"changes" | "copy">();
  const [after, setAfter] = useState("");
  const [target, setTarget] = useState("");
  const [offset, setOffset] = useState(0);
  const [changes, setChanges] = useState<SnapshotChange[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (mode !== "changes" || !after) return;
    setBusy(true); setError(""); setChanges([]);
    void window.sentry.request({ type: "snapshot-diff", destinationId: snapshot.destinationId, before: snapshot.id, after, offset, limit: 100 }).then(r => { if (active) { setChanges(r.changes); setTotal(r.total); } }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [mode, after, snapshot, offset]);
  return <>
    <Button size="small" onClick={() => { setAfter(snapshots.find(s => s.planId === snapshot.planId && s.id !== snapshot.id)?.id ?? ""); setOffset(0); setMode("changes"); }}><GitCompareArrows size={14} />Changes</Button>
    {state.destinations.find(d => d.id === snapshot.destinationId)?.kind === "local" && <Button size="small" disabled={snapshot.incomplete} onClick={() => { setError(""); setMode("copy"); }}><Copy size={14} />Copy</Button>}
    <Modal open={!!mode} onOpenChange={() => { if (!busy) setMode(undefined); }} title={mode === "copy" ? "Copy this snapshot" : "Changes between snapshots"} description={mode === "copy" ? "Transfer this captured version to another repository. Its original capture time is preserved." : `Compare ${snapshot.name || date(snapshot.time)} with another saved version.`} wide={mode === "changes"}>
      <div className="dialog-body">{error && <Notice error>{error}</Notice>}
        {mode === "copy" ? <Field label="Copy to"><Select aria-label="Copy snapshot destination" value={target} onValueChange={setTarget}><option value="" disabled>Choose destination</option>{state.destinations.filter(d => d.id !== snapshot.destinationId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field> : <>
          <Field label="Compare to"><Select aria-label="Compare snapshot" value={after} onValueChange={v => { setAfter(v); setOffset(0); }}><option value="" disabled>Choose another snapshot</option>{snapshots.filter(s => s.planId === snapshot.planId && s.id !== snapshot.id).map(s => <option key={s.id} value={s.id}>{s.name || date(s.time)}</option>)}</Select></Field>
          {busy ? <p role="status">Comparing saved contents…</p> : <div className="change-list">{changes.map(c => <div className="change-row" key={c.path}><span className={`change-kind change-${c.change}`}>{c.change}</span><span title={c.path}>{c.path}</span><Button size="small" onClick={() => { const s = c.change === "deleted" ? snapshot : snapshots.find(s => s.id === after); if (s) { setMode(undefined); onSelect(s, [c.path]); } }}>Recover</Button></div>)}{!changes.length && after && !error && <p className="section-empty">No content changes in this comparison.</p>}</div>}
          <div className="pagination"><Button size="small" disabled={!offset || busy} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</Button><span>{total} {total === 1 ? "change" : "changes"}</span><Button size="small" disabled={offset + 100 >= total || busy} onClick={() => setOffset(offset + 100)}>Next</Button></div>
        </>}
      </div>
      <div className="dialog-footer"><Button disabled={busy} onClick={() => setMode(undefined)}>Close</Button>{mode === "copy" && <Button variant="primary" disabled={!target || busy} onClick={async () => { setBusy(true); try { const id = await perform({ type: "copy-snapshot", sourceDestinationId: snapshot.destinationId, destinationId: target, snapshotId: snapshot.id }, "Snapshot copy queued. Check Activity for the destination result."); if (id) setMode(undefined); } finally { setBusy(false); } }}>Copy snapshot</Button>}</div>
    </Modal>
  </>;
}
