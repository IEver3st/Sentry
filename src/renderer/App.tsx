import { useCallback, useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  Copy,
  FileClock,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  Job,
  Plan,
  Request,
  ResponseMap,
  State,
} from "../shared/contracts";
import {
  AppContext,
  Button,
  bytes,
  Confirm,
  date,
  Empty,
  Notice,
  shortPath,
  Status,
  useApp,
} from "./ui";
import { newPlan, PlanEditor, RunDialog } from "./PlanEditor";
import { Restore } from "./Restore";
import { SettingsPage } from "./Settings";

type Page = "Overview" | "Backup Plans" | "Restore" | "Activity" | "Settings";
const pages: Array<{ name: Page; icon: typeof LayoutDashboard }> = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Backup Plans", icon: ListChecks },
  { name: "Restore", icon: ArrowDownToLine },
  { name: "Activity", icon: ActivityIcon },
];
export function App() {
  const [state, setState] = useState<State>();
  const [page, setPage] = useState<Page>("Overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean }>();
  const [editor, setEditor] = useState<Plan>();
  const [run, setRun] = useState<Plan>();
  const refresh = useCallback(async () => {
    setState(await window.sentry.request({ type: "state" }));
  }, []);
  const notify = useCallback(
    (message: string, isError = false) =>
      setNotice({ message, error: isError }),
    [],
  );
  const clearNotice = useCallback(() => setNotice(undefined), []);
  const perform = useCallback(
    async <T extends Request>(
      request: T,
      success?: string,
    ): Promise<ResponseMap[T["type"]] | undefined> => {
      try {
        const result = await window.sentry.request(request);
        if (success) notify(success);
        if (
          ![
            "state",
            "files",
            "snapshots",
            "history",
            "preview",
            "choose-path",
            "window",
          ].includes(request.type)
        )
          await refresh();
        return result;
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : String(cause), true);
        return undefined;
      }
    },
    [refresh, notify],
  );
  useEffect(() => {
    if (!window.sentry) {
      setError(
        "The secure desktop connection is unavailable. Open Sentry using the installed application.",
      );
      return;
    }
    void refresh().catch((cause) => setError(String(cause)));
    const unsubscribe = window.sentry.subscribe((next) => {
      if (!document.hidden) setState(next);
    });
    const visibility = () => {
      document.documentElement.dataset.hidden = String(document.hidden);
      if (!document.hidden)
        void refresh().catch((cause) => setError(String(cause)));
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const theme = () => {
      document.documentElement.dataset.theme =
        state?.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : state?.settings.theme || "dark";
    };
    theme();
    media.addEventListener("change", theme);
    return () => media.removeEventListener("change", theme);
  }, [state?.settings.theme]);
  const windowAction = (action: "minimize" | "maximize" | "close") =>
    void window.sentry?.request({ type: "window", action });
  const shell = (
    <>
      <header className="titlebar">
        <div className="brand">
          <img src="./sentry-mark.png" alt="" width={28} height={28} />
          <span>Sentry</span>
        </div>
        <div className="window-controls">
          <button
            aria-label="Minimize"
            onClick={() => windowAction("minimize")}
          >
            <Minus size={14} />
          </button>
          <button
            aria-label="Maximize or restore window"
            onClick={() => windowAction("maximize")}
          >
            <Square size={11} />
          </button>
          <button
            aria-label="Close to tray"
            className="window-close"
            onClick={() => windowAction("close")}
          >
            <X size={16} />
          </button>
        </div>
      </header>
    </>
  );
  if (!state)
    return (
      <div className="app-shell">
        {shell}
        <main className="startup">
          <img src="./sentry-mark.png" alt="Sentry" width={54} height={54} />
          <h1>{error ? "Sentry needs attention" : "Opening Sentry"}</h1>
          <p>{error || "Loading your backup plans…"}</p>
          {error && (
            <Button
              onClick={() => {
                setError("");
                void refresh().catch((cause) => setError(String(cause)));
              }}
            >
              Try again
            </Button>
          )}
        </main>
      </div>
    );
  const activeJobs = state.jobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  );
  return (
    <AppContext.Provider
      value={{ state, refresh, notify, perform, notice, clearNotice }}
    >
      <div className="app-shell">
        {shell}
        <div className="app-body">
          <aside className="sidebar">
            <nav aria-label="Main navigation">
              {pages.map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  aria-label={name}
                  title={name}
                  onClick={() => {
                    setPage(name);
                    setNotice(undefined);
                  }}
                  aria-current={page === name ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span>{name}</span>
                  {name === "Activity" && activeJobs.length > 0 && (
                    <span className="nav-count">{activeJobs.length}</span>
                  )}
                </button>
              ))}
            </nav>
            <nav className="sidebar-bottom" aria-label="Application">
              <UpdateControl />
              <button aria-label="Settings" title="Settings" aria-current={page === "Settings" ? "page" : undefined} onClick={() => { setPage("Settings"); setNotice(undefined); }}>
                <SettingsIcon size={17} aria-hidden="true" /><span>Settings</span>
              </button>
            </nav>
          </aside>
          <main className={`workspace${page === "Settings" ? " workspace-settings" : ""}`} id="main-content">
            <div className="page-header">
              <div>
                <h1>{page}</h1>
              </div>
              <div className="button-group">
                {page === "Overview" && (
                  <Button
                    variant="primary"
                    disabled={!state.plans.some((plan) => plan.enabled)}
                    onClick={() =>
                      void perform({ type: "run" }, "Backups queued.")
                    }
                  >
                    <Play size={15} />
                    Back up now
                  </Button>
                )}
                {page === "Backup Plans" && (
                  <Button
                    variant="primary"
                    onClick={() => setEditor(newPlan())}
                  >
                    <Plus size={16} />
                    New plan
                  </Button>
                )}
              </div>
            </div>
            <div className="page-content">
              {notice && (
                <div className="toast-container">
                  <Notice error={notice.error}>{notice.message}</Notice>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Dismiss notification"
                    onClick={() => setNotice(undefined)}
                  >
                    <X size={15} />
                  </Button>
                </div>
              )}
              {state.policy && (
                <div className="policy-notice">
                  <Pause size={14} />
                  {state.policy}
                </div>
              )}
              {page === "Overview" && (
                <Overview
                  create={() => setEditor(newPlan())}
                  edit={setEditor}
                  run={setRun}
                  navigate={setPage}
                />
              )}{" "}
              {page === "Backup Plans" && (
                <Plans
                  edit={setEditor}
                  run={setRun}
                  create={() => setEditor(newPlan())}
                />
              )}{" "}
              {page === "Restore" && <Restore />}
              {page === "Activity" && <ActivityPage />}
              {page === "Settings" && <SettingsPage />}
            </div>
          </main>
        </div>
      </div>
      {editor && (
        <PlanEditor initial={editor} onClose={() => setEditor(undefined)} />
      )}{" "}
      {run && <RunDialog plan={run} onClose={() => setRun(undefined)} />}
    </AppContext.Provider>
  );
}

function Overview({
  create,
  edit,
  run,
  navigate,
}: {
  create: () => void;
  edit: (plan: Plan) => void;
  run: (plan: Plan) => void;
  navigate: (page: Page) => void;
}) {
  const { state } = useApp();
  const enabled = state.plans.filter((plan) => plan.enabled);
  const gaps = enabled
    .flatMap((plan) =>
      plan.destinationIds.map((id) => ({
        plan,
        destination: state.destinations.find(
          (destination) => destination.id === id,
        ),
        latest: state.protection.find(
          (item) => item.planId === plan.id && item.destinationId === id,
        ),
      })),
    )
    .filter(
      (item) =>
        !item.latest ||
        item.latest.status !== "success" ||
        item.destination?.status !== "ready",
    );
  const running = state.jobs.filter((job) =>
    ["running", "queued"].includes(job.status),
  );
  if (!state.plans.length)
    return (
      <>
        <div className="welcome-state">
          <img src="./sentry-mark.png" alt="" />
          <div>
            <h2>No files are protected yet.</h2>
            <p>
              Create a backup plan to keep encrypted, recoverable copies of your
              documents, projects, and photos.
            </p>
            <Button variant="primary" onClick={create}>
              <Plus size={16} />
              Create your first plan
            </Button>
          </div>
        </div>
        <div className="recover-existing">
          <FileClock size={22} />
          <div>
            <strong>Already have Sentry backups?</strong>
            <p>Connect an existing repository using its recovery password.</p>
          </div>
          <Button onClick={() => navigate("Settings")}>
            Connect repository
            <ArrowRight size={15} />
          </Button>
        </div>
      </>
    );
  return (
    <>
      <section
        className={`protection-summary ${gaps.length ? "has-gaps" : ""}`}
      >
        <div className="protection-mark">
          {gaps.length ? <Clock3 size={22} /> : <Check size={22} />}
        </div>
        <div>
          <h2>
            {state.settings.paused
              ? "Protection is paused"
              : running.length
                ? "Your backup work is in progress"
                : gaps.length
                  ? `${gaps.length} protection ${gaps.length === 1 ? "gap needs" : "gaps need"} attention`
                  : enabled.length
                    ? "Your enabled plans have successful copies"
                    : "No backup plans are enabled"}
          </h2>
          <p>
            {state.settings.paused
              ? "Manual backups remain available. Resume to allow automatic runs."
              : gaps.length
                ? "Review the destinations below. A successful copy in one place does not cover a failed copy elsewhere."
                : enabled.length
                  ? `${enabled.length} enabled ${enabled.length === 1 ? "plan" : "plans"} · Check a recovery regularly to confirm your files can be restored.`
                  : "Enable a plan to protect files automatically. Existing snapshots remain available to restore."}
          </p>
        </div>
        <Button onClick={() => navigate("Restore")}>
          Restore files
          <ArrowDownToLine size={15} />
        </Button>
      </section>
      {running.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <h2>In progress</h2>
            <Button
              variant="ghost"
              size="small"
              onClick={() => navigate("Activity")}
            >
              View activity
              <ArrowRight size={14} />
            </Button>
          </div>
          {running.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </section>
      )}
      <section className="section">
        <div className="section-heading">
          <h2>Protection ledger</h2>
          <Button size="small" onClick={create}>
            <Plus size={14} />
            New plan
          </Button>
        </div>
        <div className="ledger-header">
          <span>Plan & sources</span>
          <span>Destination</span>
          <span>Last complete copy</span>
        </div>
        {state.plans.map((plan) => (
          <div className="ledger-plan" key={plan.id}>
            <div className="ledger-plan-name">
              <button className="text-button" onClick={() => edit(plan)}>
                <FolderOpen size={18} />
                <strong>{plan.name}</strong>
              </button>
              <p title={plan.sources.join("\n")}>
                {plan.sources.map(shortPath).join(", ")}
              </p>
              <small>{plan.enabled ? scheduleText(plan) : "Disabled"}</small>
            </div>
            <div className="ledger-copies">
              {plan.destinationIds.map((id) => {
                const destination = state.destinations.find((d) => d.id === id);
                const latest = state.protection.find(
                  (item) =>
                    item.planId === plan.id && item.destinationId === id,
                );
                return (
                  <div className="ledger-copy" key={id}>
                    <div>
                      {destination?.kind === "gdrive" ? (
                        <Cloud size={15} />
                      ) : (
                        <HardDrive size={15} />
                      )}
                      <span>
                        <strong>
                          {destination?.name || "Missing destination"}
                        </strong>
                        <small>
                          {destination?.error ||
                            destination?.location ||
                            "Reconnect in Settings"}
                        </small>
                      </span>
                    </div>
                    <div>
                      <span>{date(latest?.lastSuccess)}</span>
                      <Status status={latest?.status || "attention"} />
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Back up ${plan.name}`}
              onClick={() => run(plan)}
            >
              <Play size={16} />
            </Button>
          </div>
        ))}
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <Button
            variant="ghost"
            size="small"
            onClick={() => navigate("Activity")}
          >
            All activity
            <ArrowRight size={14} />
          </Button>
        </div>
        {state.jobs.length ? (
          state.jobs.slice(0, 4).map((job) => <JobRow job={job} key={job.id} />)
        ) : (
          <p className="section-empty">
            No jobs yet. Run a plan to create its first copy.
          </p>
        )}
      </section>
    </>
  );
}

function scheduleText(plan: Plan) {
  const schedule = plan.schedule;
  switch (schedule.kind) {
    case "manual":
      return "Manual backups";
    case "interval":
      return `Every ${schedule.minutes} minutes`;
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekly":
      return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][schedule.weekday]} at ${schedule.time}`;
    case "monthly":
      return `Day ${schedule.day} at ${schedule.time}`;
  }
}
function Plans({
  edit,
  run,
  create,
}: {
  edit: (plan: Plan) => void;
  run: (plan: Plan) => void;
  create: () => void;
}) {
  const { state, perform } = useApp();
  const [expanded, setExpanded] = useState<string>();
  return !state.plans.length ? (
    <Empty
      icon={<ListChecks size={28} />}
      heading="No backup plans yet"
      action={
        <Button variant="primary" onClick={create}>
          <Plus size={16} />
          New plan
        </Button>
      }
    >
      A plan brings your files, destinations, and schedule together.
    </Empty>
  ) : (
    <div className="plans-list">
      {state.plans.map((plan) => (
        <article className="plan-item" key={plan.id}>
          <div className="plan-heading">
            <button
              className="expand-button"
              aria-expanded={expanded === plan.id}
              onClick={() =>
                setExpanded(expanded === plan.id ? undefined : plan.id)
              }
            >
              {expanded === plan.id ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
              <FolderOpen size={21} />
              <span>
                <strong>{plan.name}</strong>
                <small>
                  {plan.sources.length} source
                  {plan.sources.length === 1 ? "" : "s"} · {scheduleText(plan)}
                </small>
              </span>
            </button>
            <Status status={plan.enabled ? "enabled" : "disabled"} />
            <Button size="small" onClick={() => run(plan)}>
              <Play size={14} />
              Back up
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${plan.name}`}
              onClick={() => edit(plan)}
            >
              <Pencil size={15} />
            </Button>
          </div>
          <div className="plan-destinations">
            {plan.destinationIds.map((id) => {
              const d = state.destinations.find((item) => item.id === id);
              const j = state.protection.find(
                (item) => item.planId === plan.id && item.destinationId === id,
              );
              return (
                <div key={id}>
                  {d?.kind === "gdrive" ? (
                    <Cloud size={15} />
                  ) : (
                    <HardDrive size={15} />
                  )}
                  <span>{d?.name || "Missing destination"}</span>
                  <Status status={j?.status || d?.status || "attention"} />
                </div>
              );
            })}
          </div>
          {expanded === plan.id && (
            <div className="plan-details">
              <div className="two-column">
                <div>
                  <h3>Protected sources</h3>
                  <ul className="path-list">
                    {plan.sources.map((source) => (
                      <li key={source}>
                        <FolderOpen size={14} />
                        <span>{source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Version policy</h3>
                  <p>
                    {plan.retention.daily} daily · {plan.retention.weekly}{" "}
                    weekly · {plan.retention.monthly} monthly
                  </p>
                  <p className="hint">
                    {plan.pruningSuspended
                      ? "Automatic pruning is suspended."
                      : "Pinned versions are retained."}
                  </p>
                  <p className="hint">
                    {plan.includes.length} include rules ·{" "}
                    {plan.excludes.length} exclude rules
                  </p>
                </div>
              </div>
              <div className="plan-actions">
                <Button
                  size="small"
                  onClick={() =>
                    void perform({
                      type: "save-plan",
                      plan: { ...plan, enabled: !plan.enabled },
                    })
                  }
                >
                  {plan.enabled ? <Pause size={14} /> : <Play size={14} />}{" "}
                  {plan.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    edit({
                      ...plan,
                      id: crypto.randomUUID(),
                      name: `${plan.name} copy`,
                    })
                  }
                >
                  <Copy size={14} />
                  Duplicate
                </Button>
                <Confirm
                  title={`Delete ${plan.name}?`}
                  description="This removes the plan and stops its schedule. Existing backup snapshots are kept in their repositories."
                  action="Delete plan"
                  onConfirm={async () => {
                    await perform(
                      { type: "delete-plan", id: plan.id },
                      "Plan deleted. Existing backups are kept.",
                    );
                  }}
                >
                  <Button variant="ghost" size="small">
                    <Trash2 size={14} />
                    Delete
                  </Button>
                </Confirm>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function JobRow({ job }: { job: Job }) {
  const { perform } = useApp();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="job-item">
      <div className="job-row">
        <button
          className="job-name"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {job.kind === "restore" ? (
            <ArrowDownToLine size={17} />
          ) : job.kind === "backup" ? (
            <FolderOpen size={17} />
          ) : (
            <ListChecks size={17} />
          )}
          <span>
            <strong>{job.planName || job.kind.replace("-", " ")}</strong>
            <small>
              {job.kind} · {job.destinationName} · {job.trigger}
            </small>
          </span>
        </button>
        <div className="job-time">
          {date(job.finishedAt || job.startedAt || job.createdAt)}
          <small>{bytes(job.transferred)} transferred</small>
        </div>
        <div className="job-outcome">
          <Status status={job.status} />
          {job.status === "running" && (
            <small>
              {job.phase}
              {job.progress !== undefined
                ? ` · ${Math.round(job.progress * 100)}%`
                : ""}
            </small>
          )}
        </div>
        {["running", "queued"].includes(job.status) ? (
          <Button
            size="small"
            onClick={() => void perform({ type: "cancel", id: job.id })}
          >
            Cancel
          </Button>
        ) : ["failed", "partial", "interrupted", "cancelled"].includes(
            job.status,
          ) ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Retry ${job.planName}`}
            onClick={() =>
              void perform(
                { type: "retry", id: job.id },
                "Failed destination queued for retry.",
              )
            }
          >
            <RefreshCw size={15} />
          </Button>
        ) : (
          <span className="job-spacer" />
        )}
      </div>
      {job.status === "running" && job.progress !== undefined && (
        <div className="progress-track">
          <div
            style={{
              transform: `scaleX(${Math.max(0, Math.min(1, job.progress))})`,
            }}
          />
        </div>
      )}
      {expanded && (
        <div className="job-details">
          <div className="job-counts">
            <span>
              <b>{job.added}</b> added
            </span>
            <span>
              <b>{job.changed}</b> changed
            </span>
            <span>
              <b>{job.deleted}</b> deleted
            </span>
            <span>
              <b>{job.skipped}</b> skipped
            </span>
            <span>
              <b>{bytes(job.bytes)}</b> processed
            </span>
          </div>
          <p>
            Started {date(job.startedAt)} · Finished {date(job.finishedAt)}
          </p>
          {job.name && (
            <p>
              Snapshot: {job.name}
              {job.pin ? " · Pinned" : ""}
            </p>
          )}
          {job.error && <Notice error>{job.error}</Notice>}
        </div>
      )}
    </div>
  );
}

function ActivityPage() {
  const { state, perform, notify } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    void window.sentry
      .request({ type: "history", offset, limit: 50 })
      .then((result) => {
        if (alive) {
          setJobs(result.jobs);
          setTotal(result.total);
        }
      })
      .catch((cause) => {
        if (alive) notify(String(cause), true);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [offset, state.jobs, notify]);
  return (
    <>
      <div className="section-heading">
        <span className="muted">
          {total.toLocaleString()} recorded operations
        </span>
        <Button
          size="small"
          onClick={async () => {
            const path = await perform({ type: "diagnostics" });
            if (path && path !== "Export cancelled")
              notify(`Redacted diagnostics saved to ${path}`);
          }}
        >
          <ArrowDownToLine size={14} />
          Export diagnostics
        </Button>
      </div>
      {!jobs.length && !busy ? (
        <Empty icon={<ActivityIcon size={28} />} heading="No activity yet">
          Backups, checks, and restores will appear here with an outcome for
          each destination.
        </Empty>
      ) : (
        <div aria-busy={busy}>
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
      <div className="pagination">
        <Button
          size="small"
          disabled={!offset || busy}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </Button>
        <span>
          {total
            ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}`
            : "0 operations"}
        </span>
        <Button
          size="small"
          disabled={offset + 50 >= total || busy}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </Button>
      </div>
    </>
  );
}

function UpdateControl() {
  const { state, perform } = useApp();
  const update = state.update;
  const working = ["checking", "downloading", "installing"].includes(update.status);
  const label = update.status === "ready" ? "Restart to update" : update.status === "downloading" ? `Downloading ${Math.round(update.progress ?? 0)}%` : update.status === "checking" ? "Checking for updates" : update.status === "installing" ? "Restarting�" : update.status === "error" ? "Retry update" : "Check for updates";
  const detail = update.status === "ready" ? (state.busy ? "Waiting for backup work" : `Version ${update.version} ready`) : update.status === "current" ? "Sentry is up to date" : update.status === "unavailable" ? "Installed app only" : update.status === "idle" ? "Checks automatically" : update.status === "error" ? "Check failed � Try again" : update.version ? `Version ${update.version}` : "";
  return <button className="sidebar-update" aria-label={label} title={update.message || `${label}${detail ? ` � ${detail}` : ""}`} disabled={working || update.status === "unavailable" || (update.status === "ready" && state.busy)} onClick={() => void perform({ type: "updates", action: update.status === "ready" ? "install" : "check" })}>
    {update.status === "ready" ? <ArrowDownToLine size={17} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
    <span className="update-copy" aria-live="polite"><span>{label}</span><small>{detail}</small></span>
  </button>;
}
