import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  File,
  FileClock,
  Folder,
  FolderOpen,
  Pin,
  Search,
  ShieldCheck,
  HardDrive,
  KeyRound,
} from "lucide-react";
import type { FileEntry, Snapshot } from "../shared/contracts";
import { FileHistory } from "./FileHistory";
import { SnapshotTools } from "./SnapshotTools";
import {
  Button,
  Select,
  bytes,
  date,
  Field,
  Modal,
  Notice,
  shortPath,
  useApp,
} from "./ui";
import { PreparationList, WorkflowSteps, WorkspaceIntro } from "./WorkspaceParts";

export function Restore({ connect, plans }: { connect: () => void; plans: () => void }) {
  const { state, perform, notify } = useApp();
  const [destinationId, setDestinationId] = useState(
    state.destinations[0]?.id || "",
  );
  const [planId, setPlanId] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotOffset, setSnapshotOffset] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [overwrite, setOverwrite] = useState<"never" | "always">("never");
  const [busy, setBusy] = useState(false);
  const [historyPath, setHistoryPath] = useState<string | undefined>(state.historyPath);
  useEffect(() => { if (state.historyPath) setHistoryPath(state.historyPath); }, [state.historyPath, state.historyRequest]);
  const [pendingRestore, setPendingRestore] = useState<{ snapshot: Snapshot; paths: string[] }>();
  useEffect(() => { if (pendingRestore && snapshot?.id === pendingRestore.snapshot.id) { setSelected(pendingRestore.paths); setRestoreOpen(true); setPendingRestore(undefined); } }, [pendingRestore, snapshot]);
  const selectRecovery = (version: Snapshot, paths: string[]) => {
    setHistoryPath(undefined);
    if (destinationId !== version.destinationId) { setPendingRestore({ snapshot: version, paths }); setDestinationId(version.destinationId); }
    else { setSnapshot(version); setSelected(paths); setRestoreOpen(true); }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    setSnapshots([]);
    setSnapshotOffset(0);
    setFiles([]);
    setSelected([]);
    setError("");
    if (!destinationId) { setLoading(false); return; }
    setLoading(true);
    void window.sentry
      .request({
        type: "snapshots",
        destinationId,
        planId: planId || undefined,
      })
      .then((result) => {
        if (active) {
          setSnapshots(result);
          setSnapshot(pendingRestore?.snapshot ?? result[0]);
          setOffset(0);
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [destinationId, planId, reload]);
  useEffect(() => {
    let active = true;
    setError("");
    if (!snapshot) {
      setFiles([]);
      setFileLoading(false);
      setTotal(0);
      return;
    }
    setFiles([]);
    setFileLoading(true);
    void window.sentry
      .request({
        type: "files",
        destinationId,
        snapshotId: snapshot.id,
        search: query,
        offset,
        limit: 100,
      })
      .then((result) => {
        if (active) {
          setFiles(result.entries);
          setTotal(result.total);
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [snapshot, destinationId, query, offset]);
  async function pinSnapshot() {
    if (!snapshot) return;
    const result = await perform({
      type: "pin",
      destinationId,
      snapshotId: snapshot.id,
      pinned: !snapshot.pinned,
    });
    if (result) {
      // Restic tags rewrite snapshot IDs. Read the new catalog before allowing
      // another operation against the selected version.
      const refreshed = await perform({
        type: "snapshots",
        destinationId,
        planId: planId || undefined,
      });
      if (refreshed) {
        setSnapshots(refreshed);
        setSnapshot(
          refreshed.find(
            (item) =>
              item.time === snapshot.time &&
              item.planId === snapshot.planId &&
              item.pinned !== snapshot.pinned,
          ) || refreshed[0],
        );
      }
    }
  }
  return (
    <div className="restore-workspace">
      <WorkflowSteps current={!destinationId ? 0 : !snapshot ? 1 : 2} steps={[
        { title: "Choose a repository", detail: state.destinations.find(item => item.id === destinationId)?.name || "Connect where your backups live" },
        { title: "Find a saved version", detail: snapshot ? date(snapshot.time) : "Browse snapshots by date" },
        { title: "Recover your files", detail: selected.length ? `${selected.length} paths selected` : "A separate folder by default" },
      ]} />
      {state.destinations.length > 0 && <><div className="restore-source-toolbar"><div className="restore-filters">
        <Field label="Destination">
          <Select
            aria-label="Restore destination"
            value={destinationId}
            onValueChange={(value) => setDestinationId(value)}
          >
            <option value="" disabled>
              Choose a repository
            </option>
            {state.destinations.map((destination) => (
              <option value={destination.id} key={destination.id}>
                {destination.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Backup plan">
          <Select
            aria-label="Restore plan"
            value={planId}
            onValueChange={(value) => setPlanId(value)}
          >
            <option value="">All plans, including recovered plans</option>
            {state.plans.map((plan) => (
              <option value={plan.id} key={plan.id}>
                {plan.name}
              </option>
            ))}
          </Select>
        </Field>
      </div><Button onClick={() => setHistoryPath("")}><FileClock size={15} />Find a file's history</Button></div></>}
      {error && <Notice error>{error}<Button size="small" onClick={() => setReload(value => value + 1)}>Try again</Button></Notice>}
      {!state.destinations.length ? (
        <>
          <div className="workspace-empty-split"><WorkspaceIntro icon={<HardDrive size={29} />} eyebrow="RECOVER FROM A BACKUP" title="Connect a repository to recover files." action={<Button variant="primary" onClick={connect}>Connect repository<ArrowRight size={15} /></Button>}>Connect the drive or cloud location holding your backups. An existing repository and its password are enough, even after reinstalling Sentry.</WorkspaceIntro><PreparationList title="Have these ready" items={[
            { title: "Your backup location", detail: "The local folder, external drive, or cloud destination containing your repository." },
            { title: "Your recovery password", detail: "The password used to encrypt the repository when it was created." },
            { title: "A folder for recovered files", detail: "Choose a separate location to keep your current work intact." },
          ]} /></div>
          <section className="recovery-safety"><KeyRound size={20} /><div><h3>Recovery belongs to your repository</h3><p>You can recover with your repository and password without Sentry's local database. Keep the password somewhere safe.</p></div></section>
        </>
      ) : loading ? (
        <div className="workspace-loading" role="status"><FileClock size={22} /><div><strong>Reading snapshots…</strong><p>Looking for saved versions in this repository.</p></div></div>
      ) : !snapshots.length && !error ? (
        <WorkspaceIntro icon={<FileClock size={29} />} eyebrow="NO SAVED VERSIONS" title="No snapshots in this selection" action={<div className="button-group"><Button onClick={() => setReload(value => value + 1)}>Refresh snapshots</Button><Button variant="primary" onClick={plans}>Go to backup plans<ArrowRight size={15} /></Button></div>}>Create a backup or choose another destination. Only committed snapshots appear here.</WorkspaceIntro>
      ) : snapshots.length > 0 ? (
        <div className="restore-browser">
          <aside className="snapshot-list">
            <div className="inspector-heading">
                <h2>Saved versions</h2>
              <span>{snapshots.length}</span>
            </div>
            <div className="snapshot-scroll">
              {snapshots
                .slice(snapshotOffset, snapshotOffset + 50)
                .map((item) => (
                  <button
                    className={snapshot?.id === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() => {
                      setSnapshot(item);
                      setSelected([]);
                      setOffset(0);
                    }}
                    aria-pressed={snapshot?.id === item.id}
                  >
                    <span className="snapshot-date">
                      {date(item.time)}
                      {item.pinned && <Pin size={13} aria-label="Pinned" />}
                    </span>
                    <strong>
                      {item.name || item.planName || "Recovered snapshot"}
                    </strong>
                    <small>
                      {item.checkpointUntil && Date.parse(item.checkpointUntil) > Date.now() ? `Checkpoint until ${date(item.checkpointUntil)} · ` : ""}
                      {item.incomplete
                        ? "Incomplete snapshot"
                        : `${item.paths.length} source${item.paths.length === 1 ? "" : "s"}`}
                    </small>
                  </button>
                ))}
            </div>
            {snapshots.length > 50 && (
              <div className="pagination snapshot-pagination">
                <Button
                  size="icon"
                  aria-label="Previous versions"
                  disabled={snapshotOffset === 0}
                  onClick={() =>
                    setSnapshotOffset(Math.max(0, snapshotOffset - 50))
                  }
                >
                  <ChevronLeft size={14} />
                </Button>
                <span>
                  {snapshotOffset + 1}–
                  {Math.min(snapshotOffset + 50, snapshots.length)}
                </span>
                <Button
                  size="icon"
                  aria-label="Next versions"
                  disabled={snapshotOffset + 50 >= snapshots.length}
                  onClick={() => setSnapshotOffset(snapshotOffset + 50)}
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </aside>
          <section className="file-browser">
            <div className="file-browser-heading">
              <div>
                <h2>
                  {snapshot?.name || snapshot?.planName || "Snapshot files"}
                </h2>
                <p>{snapshot ? date(snapshot.time) : "Choose a version"}</p>
              </div>
              <div className="button-group">
                {snapshot && <SnapshotTools snapshot={snapshot} snapshots={snapshots} onSelect={selectRecovery} />}
                <Button
                  size="icon"
                  aria-label={
                    snapshot?.pinned ? "Unpin snapshot" : "Pin snapshot"
                  }
                  aria-pressed={snapshot?.pinned}
                  onClick={() => void pinSnapshot()}
                >
                  <Pin size={15} />
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    if (snapshot)
                      void perform(
                        {
                          type: "test-recovery",
                          destinationId,
                          snapshotId: snapshot.id,
                        },
                        "Test recovery queued. View its verified result in Activity.",
                      );
                  }}
                >
                  <ShieldCheck size={15} />
                  Test recovery
                </Button>
              </div>
            </div>
            {snapshot?.incomplete && (
              <Notice error>
                This snapshot contains skipped or unreadable files. It is not a
                complete copy.
              </Notice>
            )}
            <div className="search-box">
              <Search size={15} />
              <input
                aria-label="Search backed-up paths"
                type="search"
                placeholder="Search backed-up paths"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="file-list" aria-busy={fileLoading}>
              <div className="file-table-header">
                <span>Path</span>
                <span>Size</span>
              </div>
              {files.map((entry) => (
                <label className="file-row" key={entry.path}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${entry.path}`}
                    checked={selected.includes(entry.path)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, entry.path]
                          : current.filter((path) => path !== entry.path),
                      )
                    }
                  />
                  {entry.type === "dir" ? (
                    <Folder size={16} />
                  ) : (
                    <File size={16} />
                  )}
                  <span className="file-path" title={entry.path}>
                    <strong>{shortPath(entry.path)}</strong>
                    <small>{entry.path}</small>
                  </span>
                  <span className="file-size">
                    {entry.type === "dir" ? "Folder" : bytes(entry.size)}
                  </span>
                </label>
              ))}
              {!files.length && (
                <p className="section-empty">
                  {fileLoading
                    ? "Loading files…"
                    : "No paths match your search."}
                </p>
              )}
            </div>
            <div className="pagination">
              <Button
                size="icon"
                aria-label="Previous file page"
                disabled={offset === 0 || fileLoading}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                <ChevronLeft size={15} />
              </Button>
              <span>
                {total
                  ? `${offset + 1}–${Math.min(offset + 100, total)} of ${total.toLocaleString()} paths`
                  : "No paths"}
              </span>
              <Button
                size="icon"
                aria-label="Next file page"
                disabled={offset + 100 >= total || fileLoading}
                onClick={() => setOffset(offset + 100)}
              >
                <ChevronRight size={15} />
              </Button>
            </div>
            <div className="restore-footer">
              <div>
                <strong>
                  {selected.length
                    ? `${selected.length} selected`
                    : "Full snapshot"}
                </strong>
                <small>Choose a separate folder in the next step.</small>
              </div>
              {selected.length > 0 && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setSelected([])}
                >
                  Clear selection
                </Button>
              )}
              {selected.length === 1 && <Button size="small" onClick={() => setHistoryPath(selected[0])}><FileClock size={14} />History & preview</Button>}
              <Button
                variant="primary"
                disabled={!snapshot || fileLoading || !!error}
                onClick={() => setRestoreOpen(true)}
              >
                <ArrowDownToLine size={15} />
                {selected.length ? "Restore selected" : "Restore snapshot"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
      <Modal
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="Restore files"
        description={
          selected.length
            ? `Restore ${selected.length} selected ${selected.length === 1 ? "path" : "paths"} from this snapshot.`
            : "Restore all files and folders from this snapshot."
        }
      >
        <div className="dialog-body">
          <Field
            label="Restore into folder"
            hint="Choose a separate folder so your current work stays intact."
          >
            <div className="input-action">
              <input
                aria-label="Restore into folder"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="D:\\Recovered files"
              />
              <Button
                aria-label="Choose restore folder"
                onClick={async () => {
                  const paths = await perform({
                    type: "choose-path",
                    kind: "folder",
                  });
                  if (paths?.[0]) setTarget(paths[0]);
                }}
              >
                <FolderOpen size={16} />
              </Button>
            </div>
          </Field>
          <Field label="If files already exist">
            <Select
              aria-label="Restore collision behavior"
              value={overwrite}
              onValueChange={(value) => setOverwrite(value as typeof overwrite)}
            >
              <option value="never">Do not overwrite existing files</option>
              <option value="always">Overwrite existing files</option>
            </Select>
          </Field>
          {overwrite === "always" && (
            <Notice error>
              Files at the restore paths will be replaced with the selected
              backup version.
            </Notice>
          )}
        </div>
        <div className="dialog-footer">
          <Button onClick={() => setRestoreOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!snapshot || !target.trim()) {
                notify("Choose a restore folder.", true);
                return;
              }
              setBusy(true);
              try {
                if (
                  await perform(
                    {
                      type: "restore",
                      destinationId,
                      snapshotId: snapshot.id,
                      target,
                      paths: selected,
                      overwrite,
                    },
                    "Restore queued. Follow progress and verification in Activity.",
                  )
                )
                  setRestoreOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Preparing…" : "Restore files"}
          </Button>
        </div>
      </Modal>
      {historyPath !== undefined && <FileHistory key={state.historyRequest} initialPath={historyPath} initialDestination={destinationId} onClose={() => setHistoryPath(undefined)} onRestore={(version, path) => selectRecovery(version, [path])} />}
    </div>
  );
}
