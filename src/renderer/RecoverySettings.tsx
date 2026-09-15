import { useState } from "react";
import { Download, FolderOpen, ScanSearch, ShieldCheck } from "lucide-react";
import type { BackgroundStatus, ResponseMap } from "../shared/contracts";
import { Button, Field, Modal, Notice, Select, bytes, date, lines, useApp } from "./ui";

export function RecoverySettings() {
  const { state, perform } = useApp();
  const [roots, setRoots] = useState((state.settings.discoveryRoots ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [practice, setPractice] = useState(false);
  const [destination, setDestination] = useState(state.destinations[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<ResponseMap["practice-recovery"]>();
  const [background, setBackground] = useState<BackgroundStatus>();
  return <>
    <section className="settings-section"><h2>Recovery readiness</h2>
      <div className="setting-row"><div><strong>Recovery kit</strong><p>Save repository locations and recovery steps somewhere independent of this PC. Passwords stay separate.</p></div><Button disabled={busy || !state.destinations.length} onClick={() => void perform({ type: "recovery-kit" })}><Download size={15} />Export kit</Button></div>
      <div className="setting-row"><div><strong>Practice on a replacement PC</strong><p>Enter your password again and restore a sample using a fresh repository catalog.</p></div><Button disabled={busy || !state.destinations.length} onClick={() => { setResult(undefined); setPractice(true); }}><ShieldCheck size={15} />Practice recovery</Button></div>
      {(state.recoveryDrills ?? []).map(drill => <div className="readiness-row" key={drill.planId + drill.destinationId}><div><strong>{state.plans.find(p => p.id === drill.planId)?.name ?? "Recovered plan"}</strong><small>{state.destinations.find(d => d.id === drill.destinationId)?.name}</small></div><div><strong>{drill.files} / {drill.totalFiles} files verified</strong><small>{bytes(drill.bytes)} · {date(drill.checkedAt)}</small></div></div>)}
      {!state.recoveryDrills?.length && <p className="hint">No recovery drill has completed yet. Schedule drills in a plan's Capture & automation options, or test a snapshot in Restore.</p>}
    </section>
    <section className="settings-section"><h2>Protection gaps</h2>
      <Field label="Folders to discover" hint="Optional, one absolute folder per line. Sentry checks these folders and their immediate child folders when you run a review. It never changes plans automatically."><textarea aria-label="Discovery folders" rows={3} value={roots} onChange={e => setRoots(e.target.value)} placeholder="C:\Users\…\Projects" /></Field>
      <div className="button-group"><Button disabled={busy} onClick={async () => { const folders = await perform({ type: "choose-path", kind: "folder" }); if (folders?.[0]) setRoots([...new Set([...lines(roots), folders[0]])].join("\n")); }}><FolderOpen size={15} />Add folder</Button><Button disabled={busy || state.busy} onClick={async () => { setBusy(true); try { const saved = await perform({ type: "settings", settings: { ...state.settings, discoveryRoots: lines(roots) } }); if (saved) await perform({ type: "scan-gaps" }, "Protection review complete. See the findings on Overview."); } finally { setBusy(false); } }}><ScanSearch size={15} />{busy ? "Reviewing…" : "Review protection"}</Button></div>
    </section>
    <section className="settings-section"><h2>Windows integration</h2>
      <div className="setting-row"><div><strong>File history in Explorer</strong><p>Add “View history in Sentry” to file context menus. On Windows 11 it appears under Show more options.</p></div><div className="button-group"><Button onClick={() => void perform({ type: "explorer-integration", enabled: true }, "Explorer history action enabled.")}>Enable</Button><Button variant="ghost" onClick={() => void perform({ type: "explorer-integration", enabled: false }, "Explorer history action removed.")}>Remove</Button></div></div>
      <div className="setting-row"><div><strong>Independent background service</strong><p>{background?.detail ?? state.background?.detail ?? "Optional service for protection while signed out. Setup requires an administrator and your Windows account password."}</p></div><div className="button-group"><Button onClick={async () => setBackground(await perform({ type: "background-service", action: "status" }))}>Check status</Button><Button onClick={async () => setBackground(await perform({ type: "background-service", action: "export-setup" }))}>Export setup</Button></div></div>
    </section>
    <Modal open={practice} onOpenChange={open => { if (!busy) { setPractice(open); setPassword(""); } }} title="Practice recovery" description="Recover a verified sample without the saved password or catalog. The recovered file stays in the folder you choose.">
      <div className="dialog-body"><Field label="Repository"><Select aria-label="Practice repository" value={destination} onValueChange={setDestination}>{state.destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field><Field label="Recovery password"><input type="password" autoComplete="off" aria-label="Practice recovery password" value={password} onChange={e => setPassword(e.target.value)} /></Field><Field label="Empty recovery folder"><div className="input-action"><input aria-label="Practice recovery folder" value={target} onChange={e => setTarget(e.target.value)} /><Button aria-label="Choose practice folder" onClick={async () => { const folders = await perform({ type: "choose-path", kind: "folder" }); if (folders?.[0]) setTarget(folders[0]); }}><FolderOpen size={15} /></Button></div></Field>{result && <Notice>{result.files} file restored and verified ({bytes(result.bytes)}). Open it in {result.target} to finish your practice. This tests the sample only.</Notice>}</div>
      <div className="dialog-footer"><Button disabled={busy} onClick={() => { setPractice(false); setPassword(""); }}>Close</Button><Button variant="primary" disabled={busy || !destination || !password || !target} onClick={async () => { setBusy(true); setResult(undefined); const credential = password; setPassword(""); try { setResult(await perform({ type: "practice-recovery", destinationId: destination, password: credential, target })); } finally { setBusy(false); } }}>{busy ? "Restoring sample…" : "Test recovery"}</Button></div>
    </Modal>
  </>;
}

export function ProtectionGaps({ onReview }: { onReview: (path?: string, planId?: string) => void }) {
  const { state, perform } = useApp();
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(12);
  const scan = state.gaps;
  return <section className="protection-gaps"><div className="section-heading"><div><h2>Protection review</h2>{scan && <p className="hint">Checked {date(scan.checkedAt)}</p>}</div><Button size="small" disabled={busy || state.busy} onClick={async () => { setBusy(true); try { await perform({ type: "scan-gaps" }); } finally { setBusy(false); } }}><ScanSearch size={14} />{busy ? "Reviewing…" : "Review now"}</Button></div>
    {(state.finishedDrives ?? []).map(id => <Notice key={id}>Sentry has finished using {state.destinations.find(d => d.id === id)?.name ?? "this drive"}. Use Windows Safely Remove Hardware before unplugging it. Reconnect it for future backups.</Notice>)}
    {!scan ? <p className="hint">Check for stale copies, shared disks and important paths excluded by your rules. Add discovery folders in Settings → Recovery.</p> : !scan.gaps.length ? <p className="hint">No gaps found within the reviewed plans and discovery folders. Unreviewed folders may still need protection.</p> : <><div className="gap-list">{scan.gaps.slice(0, visible).map(gap => <div className="gap-row" key={gap.id}><div><strong>{gap.title}</strong><p>{gap.detail}</p>{gap.path && <small>{gap.path}</small>}</div><Button size="small" onClick={() => onReview(gap.path, gap.planId)}>Review</Button></div>)}</div>{scan.gaps.length > visible && <Button size="small" onClick={() => setVisible(visible + 12)}>Show more findings ({scan.gaps.length - visible} remaining)</Button>}{scan.truncated && <p className="hint">Discovery reached its scan limit. Review these findings, then narrow the discovery folders and scan again.</p>}</>}
  </section>;
}
