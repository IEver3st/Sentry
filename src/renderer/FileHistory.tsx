import { useEffect, useState } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, FolderOpen, Search } from "lucide-react";
import type { FilePreview, FileVersion, Snapshot } from "../shared/contracts";
import { Button, Field, Modal, Notice, Select, bytes, date, useApp } from "./ui";

export function FileHistory({ initialPath = "", initialDestination, onClose, onRestore }: { initialPath?: string; initialDestination?: string; onClose: () => void; onRestore: (snapshot: Snapshot, path: string) => void }) {
  const { state, perform } = useApp();
  const [path, setPath] = useState(initialPath);
  const [query, setQuery] = useState(initialPath);
  const [destination, setDestination] = useState(initialDestination ?? state.destinations[0]?.id ?? "");
  const [reload, setReload] = useState(0);
  const [offset, setOffset] = useState(0);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<FileVersion>();
  const [comparison, setComparison] = useState<FileVersion>();
  const [preview, setPreview] = useState<FilePreview>();
  const [other, setOther] = useState<FilePreview>();
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setVersions([]); setSelected(undefined); setComparison(undefined); setPreview(undefined); setOther(undefined); setTotal(0);
    if (!query || !destination) return;
    setLoading(true); setError("");
    void window.sentry.request({ type: "file-history", destinationId: destination, path: query, offset, limit: 10 }).then(result => {
      if (active) { setVersions(result.versions); setTotal(result.total); setSelected(result.versions.find(v => v.file)); }
    }).catch(error => { if (active) setError(String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, destination, offset, reload]);
  useEffect(() => {
    let active = true;
    setPreview(undefined); setOther(undefined);
    if (!selected?.file) return;
    setPreviewing(true); setError("");
    void (async () => {
      const first = await window.sentry.request({ type: "file-preview", destinationId: destination, snapshotId: selected.snapshot.id, path: selected.file!.path });
      if (!active) return;
      setPreview(first);
      if (comparison?.file) {
        const next = await window.sentry.request({ type: "file-preview", destinationId: destination, snapshotId: comparison.snapshot.id, path: comparison.file.path });
        if (active) setOther(next);
      }
    })().catch(error => { if (active) setError(String(error)); }).finally(() => { if (active) setPreviewing(false); });
    return () => { active = false; };
  }, [selected, comparison, destination]);
  return <Modal open onOpenChange={onClose} title="File history" description="Find a previous version, including files that have been deleted." wide>
    <div className="dialog-body">
      <form className="history-search" onSubmit={e => { e.preventDefault(); setOffset(0); setQuery(path.trim()); setReload(reload + 1); }}>
        <Field label="File path"><div className="input-action"><input aria-label="File history path" value={path} onChange={e => setPath(e.target.value)} placeholder="C:\Users\…\notes.txt" /><Button aria-label="Choose file for history" onClick={async () => { const paths = await perform({ type: "choose-path", kind: "file" }); if (paths?.[0]) { setPath(paths[0]); setQuery(paths[0]); setOffset(0); } }}><FolderOpen size={15} /></Button></div></Field>
        <Field label="Repository"><Select aria-label="History repository" value={destination} onValueChange={v => { setDestination(v); setOffset(0); }}>{state.destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Button type="submit" disabled={loading || !path.trim() || !destination}><Search size={15} />Find versions</Button>
      </form>
      {query && <p className="history-path">{query}</p>}
      {error && <Notice error>{error}</Notice>}
      {loading ? <p role="status">Reading version history…</p> : !versions.length ? <p className="section-empty">{query ? "No snapshots cover this path in this repository. Try another repository or path." : "Enter a file path or choose a file to see its saved versions."}</p> : <div className="history-workbench">
        <div className="history-versions" aria-label="File versions">{versions.map(v => <button key={v.snapshot.id} className={selected?.snapshot.id === v.snapshot.id ? "selected" : ""} onClick={() => { setSelected(v); setComparison(undefined); }}><strong>{date(v.snapshot.time)}</strong><span>{v.snapshot.name || v.snapshot.planName}</span><small>{v.file ? bytes(v.file.size) : "Not present in this snapshot"}{v.snapshot.incomplete ? " · Incomplete snapshot" : ""}</small></button>)}
          <div className="pagination"><Button size="icon" aria-label="Previous history page" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 10))}><ChevronLeft size={14} /></Button><span>{offset + 1}–{Math.min(offset + 10, total)} / {total}</span><Button size="icon" aria-label="Next history page" disabled={offset + 10 >= total} onClick={() => setOffset(offset + 10)}><ChevronRight size={14} /></Button></div>
        </div>
        <div className="history-inspector">
          {selected?.file ? <><Field label="Compare with"><Select aria-label="Compare file version" value={comparison?.snapshot.id ?? ""} onValueChange={id => setComparison(versions.find(v => v.snapshot.id === id))}><option value="">Single version</option>{versions.filter(v => v.file && v.snapshot.id !== selected.snapshot.id).map(v => <option key={v.snapshot.id} value={v.snapshot.id}>{v.snapshot.name ? v.snapshot.name + " · " : ""}{date(v.snapshot.time)} · {v.snapshot.id.slice(0, 6)}</option>)}</Select></Field>
          {previewing && <p role="status">Restoring verified preview…</p>}
          <div className={other ? "preview-pair" : ""}><PreviewPane preview={preview} label={`${selected.snapshot.name ?? selected.snapshot.id.slice(0, 6)} · ${date(selected.snapshot.time)}`} />{other && <PreviewPane preview={other} label={`${comparison?.snapshot.name ?? comparison?.snapshot.id.slice(0, 6)} · ${date(comparison?.snapshot.time)}`} />}</div>
          {other?.kind === "text" && preview?.kind === "text" && <p className="hint">{other.content === preview.content ? "These versions contain identical text." : "The text differs. Both saved versions are shown above."}</p>}
          </> : <p className="section-empty">This path is absent from this snapshot. Choose an earlier version to recover it.</p>}
        </div>
      </div>}
    </div>
    <div className="dialog-footer"><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={!selected?.file || previewing} onClick={() => { if (selected?.file) onRestore(selected.snapshot, selected.file.path); }}><ArrowDownToLine size={15} />Restore this version</Button></div>
  </Modal>;
}
function PreviewPane({ preview, label }: { preview?: FilePreview; label: string }) {
  if (!preview) return null;
  return <section className="saved-preview"><h3>{label}</h3>{preview.kind === "text" ? <pre>{preview.content || "(Empty file)"}</pre> : preview.kind === "image" ? <img src={preview.content} alt={`Saved image from ${label}`} /> : <p className="hint">{preview.reason}</p>}</section>;
}
