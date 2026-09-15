import { useCallback, useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  Check,
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
  Search,
  ShieldCheck,
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
  Select,
  useApp,
} from "./ui";
import { newPlan, PlanEditor, RunDialog } from "./PlanEditor";
import { Restore } from "./Restore";
import { SettingsPage } from "./Settings";
import { ProtectionGaps } from "./RecoverySettings";
import { OverviewInsights } from "./OverviewInsights";
import { defaultOverview } from "../shared/contracts";
import { Onboarding } from "./onboarding/Onboarding";
import { shouldStartOnboarding } from "./onboarding/model";
import { PreparationList, WorkspaceIntro } from "./WorkspaceParts";

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
  const [onboarding, setOnboarding] = useState<boolean>();
  const [settingsEntry, setSettingsEntry] = useState<"General" | "Destinations">("General");
  useEffect(() => {
    if (state && onboarding === undefined) setOnboarding(shouldStartOnboarding(state));
  }, [state, onboarding]);
  useEffect(() => { if (state?.historyPath) setPage("Restore"); }, [state?.historyPath]);
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
    document.documentElement.dataset.hidden = String(document.hidden);
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
  const showOnboarding = onboarding ?? shouldStartOnboarding(state);
  return (
    <AppContext.Provider
      value={{ state, refresh, notify, perform, notice, clearNotice }}
    >
      <div className="app-shell">
        {shell}
        {showOnboarding ? <Onboarding onExit={(target) => { if (target === "Settings") setSettingsEntry("Destinations"); setOnboarding(false); setPage(target); }} /> : <div className="app-body">
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
              <button aria-label="Settings" title="Settings" aria-current={page === "Settings" ? "page" : undefined} onClick={() => { setSettingsEntry("General"); setPage("Settings"); setNotice(undefined); }}>
                <SettingsIcon size={17} aria-hidden="true" /><span>Settings</span>
              </button>
            </nav>
          </aside>
          <main className={`workspace${page === "Settings" ? " workspace-settings" : ""}${["Backup Plans", "Restore", "Activity"].includes(page) ? " operational-workspace" : ""}`} id="main-content">
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
            <div className="page-content" key={page}>
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
                  setup={() => { setNotice(undefined); setOnboarding(true); }}
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
              {page === "Restore" && <Restore connect={() => setPage("Settings")} plans={() => setPage("Backup Plans")} />}
              {page === "Overview" && state.plans.length > 0 && <ProtectionGaps onReview={(path, planId) => { const existing = state.plans.find(p => p.id === planId); setEditor(existing ?? { ...newPlan(), name: path?.split(/[\\/]/).pop() ?? "", sources: path ? [path] : [] }); }} />}
              {page === "Activity" && <ActivityPage plans={() => setPage("Backup Plans")} restore={() => setPage("Restore")} />}
              {page === "Settings" && <SettingsPage initialTab={settingsEntry} />}
            </div>
          </main>
        </div>}
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
  setup,
  edit,
  run,
  navigate,
}: {
  create: () => void;
  setup: () => void;
  edit: (plan: Plan) => void;
  run: (plan: Plan) => void;
  navigate: (page: Page) => void;
}) {
  const { state } = useApp();
  const overviewWidgets = (state.settings.overview ?? defaultOverview).widgets;
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
            <Button variant="ghost" onClick={setup}>Guided setup<ArrowRight size={15} /></Button>
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
        className={`protection-summary ${gaps.length || state.settings.paused || !enabled.length || running.length ? "has-gaps" : ""}`}
      >
        <div className="protection-mark">
          {gaps.length || state.settings.paused || !enabled.length || running.length ? <Clock3 size={22} /> : <Check size={22} />}
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
              ? "Manual backups remain available. Resume automatic backups in Settings."
              : gaps.length
                ? "A successful copy in one place does not cover a failed copy elsewhere. Review your plans and destinations."
                : enabled.length
                  ? `${enabled.length} enabled ${enabled.length === 1 ? "plan" : "plans"} · Check a recovery regularly to confirm your files can be restored.`
                  : "Enable a plan to protect files automatically. Existing snapshots remain available to restore."}
          </p>
        </div>
        <Button onClick={() => navigate(state.settings.paused ? "Settings" : gaps.length ? "Backup Plans" : "Restore")}>
          {state.settings.paused ? "Open settings" : gaps.length ? "Review plans" : "Restore files"}
          {state.settings.paused || gaps.length ? <ArrowRight size={15} /> : <ArrowDownToLine size={15} />}
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
      <OverviewInsights />
      {overviewWidgets.includes("ledger") && <section className="section">
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
                      <Status status={destination?.status !== "ready" ? destination?.status || "unavailable" : latest?.status || "attention"} />
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
      </section>}
      {overviewWidgets.includes("recent") && <section className="section">
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
      </section>}
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const enabled = state.plans.filter(plan => plan.enabled).length;
  const visible = state.plans.filter(plan =>
    (filter === "all" || (filter === "enabled" ? plan.enabled : !plan.enabled)) &&
    [plan.name, ...plan.sources].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  return <div className="plans-workspace">
    <div className="workspace-summary"><span><strong>{state.plans.length}</strong> {state.plans.length === 1 ? "plan" : "plans"}</span><span><strong>{enabled}</strong> enabled</span><span><strong>{state.destinations.length}</strong> {state.destinations.length === 1 ? "destination" : "destinations"}</span><span className="summary-note"><Clock3 size={14} />{state.settings.paused ? "Automatic backups paused" : "Schedules follow each plan"}</span></div>
    {!state.plans.length ? <>
      <div className="workspace-empty-split">
        <WorkspaceIntro icon={<FolderOpen size={29} />} eyebrow="YOUR BACKUP LIBRARY" title="Create your first backup plan." action={<Button variant="primary" onClick={create}><Plus size={15} />Create your first plan</Button>}>
          Choose what to save, where to keep it, and when to back it up. Each destination keeps its own recovery history.
        </WorkspaceIntro>
        <PreparationList title="Build your first plan" items={[
          { title: "Files & folders", detail: "Add documents, projects, or any folders you want to keep." },
          { title: "A place for your copies", detail: state.destinations.length ? `${state.destinations.length} destinations available. Choose one or more in your plan. Each must be ready to receive a backup.` : "Connect a local drive or cloud destination while creating your plan.", ready: state.destinations.some(destination => destination.status === "ready") },
          { title: "A schedule that fits", detail: "Run on a schedule, or keep it manual and back up when you choose." },
        ]} />
      </div>
      <section className="workspace-reference"><h2>What your plan keeps track of</h2><div className="reference-columns"><div><HardDrive size={18} /><h3>Every destination</h3><p>See the latest outcome and last complete copy for each location.</p></div><div><Clock3 size={18} /><h3>Saved versions</h3><p>Set how many daily, weekly, and monthly versions to retain.</p></div><div><ShieldCheck size={18} /><h3>Checkpoints</h3><p>Name and pin a backup before a big change so it stays available.</p></div></div></section>
    </> : <>
    <div className="workspace-toolbar"><div className="filter-segments" role="group" aria-label="Filter plans">{[["all", "All plans"], ["enabled", "Enabled"], ["disabled", "Disabled"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="search-box"><Search size={15} /><input type="search" aria-label="Search plans" placeholder="Find a plan or source…" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
    <div className="plans-list">
      {visible.map((plan) => (
        <article className="plan-item" key={plan.id}>
          <div className="plan-heading">
            <button
              className="expand-button"
              aria-expanded={expanded === plan.id}
              onClick={() =>
                setExpanded(expanded === plan.id ? undefined : plan.id)
              }
            >
              <ChevronRight className="disclosure-chevron" size={16} />
              <FolderOpen size={21} />
              <span>
                <strong>{plan.name}</strong>
                <small>
                    {plan.sources.map(shortPath).join(", ")} · {scheduleText(plan)}
                </small>
              </span>
            </button>
            <Status status={plan.enabled ? "enabled" : "disabled"} />
            <Button size="small" onClick={() => run(plan)}>
              <Play size={14} />
              Checkpoint
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
                <div className="plan-copy-row" key={id}>
                  {d?.kind === "gdrive" ? (
                    <Cloud size={15} />
                  ) : (
                    <HardDrive size={15} />
                  )}
                  <span className="plan-copy-name"><strong>{d?.name || "Missing destination"}</strong><small>{d?.error || d?.location || "Reconnect in Settings"}</small></span>
                  <span className="plan-copy-date"><small>Last complete copy</small>{j?.lastSuccess ? date(j.lastSuccess) : "No complete copy yet"}</span>
                  <Status status={d?.status !== "ready" ? d?.status || "unavailable" : j?.status || "attention"} />
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
      {!visible.length && <Empty icon={<Search size={24} />} heading="No matching plans" action={<Button onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button>}>Try another name or source folder.</Empty>}
    </div>
    <p className="workspace-footnote">{visible.length} of {state.plans.length} plans · Expand a plan to review its sources, version policy, and controls.</p>
    </>}
  </div>;
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
          <ChevronRight size={14} className="disclosure-chevron" />
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
          <small>{job.kind === "test-recovery" && job.recoveredFiles !== undefined ? `${job.recoveredFiles} files verified · ${bytes(job.recoveryBytes ?? 0)}` : bytes(job.transferred) + " transferred"}</small>
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

function ActivityPage({ plans, restore }: { plans: () => void; restore: () => void }) {
  const { state, perform, notify } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setReadError("");
    void window.sentry
      .request({ type: "history", offset, limit: 50 })
      .then((result) => {
        if (alive) {
          setJobs(result.jobs);
          setTotal(result.total);
        }
      })
      .catch((cause) => {
        if (alive) setReadError(String(cause));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [offset, state.jobs, reload]);
  const ongoing = (job: Job) => ["running", "queued"].includes(job.status);
  const incomplete = (job: Job) => ["failed", "partial", "interrupted", "cancelled"].includes(job.status);
  const visible = jobs.filter(job =>
    (filter === "all" || (filter === "active" ? ongoing(job) : filter === "success" ? job.status === "success" : incomplete(job))) &&
    (kind === "all" || job.kind === kind) &&
    [job.planName, job.destinationName, job.name, job.error].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="activity-workspace">
      <div className="workspace-summary"><span><strong>{total.toLocaleString()}</strong> recorded operations</span><span><strong>{state.jobs.filter(ongoing).length}</strong> in progress</span><span className="summary-note">Each destination has its own outcome</span></div>
      <div className="workspace-toolbar">
        <div className="filter-segments" role="group" aria-label="Filter activity">{[["all", "All outcomes"], ["active", "In progress"], ["attention", "Incomplete"], ["success", "Successful"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
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
      {(total > 0 || busy) && <div className="activity-search-row"><div className="search-box"><Search size={15} /><input type="search" aria-label="Search current activity page" placeholder="Search plan, destination, or error…" value={search} onChange={event => setSearch(event.target.value)} /></div><Select aria-label="Operation type" value={kind} onValueChange={setKind}><option value="all">All operations</option><option value="backup">Backups</option><option value="restore">Restores</option><option value="test-recovery">Recovery tests</option><option value="check">Repository checks</option><option value="copy">Copies</option><option value="prune">Pruning</option></Select></div>}
      {readError ? <Notice error>Activity could not be refreshed. {readError}<Button size="small" onClick={() => setReload(value => value + 1)}>Try again</Button></Notice> : null}
      {!jobs.length && busy ? <div className="workspace-loading" role="status"><Clock3 size={22} /><div><strong>Reading operation history</strong><p>Loading outcomes from your activity log…</p></div></div> : !jobs.length && !readError ? (
        <>
          <div className="workspace-empty-split"><WorkspaceIntro icon={<ActivityIcon size={29} />} eyebrow="OPERATION HISTORY" title="No operations recorded yet." action={<div className="button-group"><Button variant="primary" onClick={plans}>Go to backup plans<ArrowRight size={15} /></Button><Button onClick={restore}>Recover existing files</Button></div>}>Backups, restores, and checks appear here as they run. Open an operation to inspect its files, timing, and outcome.</WorkspaceIntro><PreparationList title="Follow every operation" items={[
            { title: "While it runs", detail: "See the current phase and progress, or cancel a queued or running job." },
            { title: "When it finishes", detail: "Review transferred bytes, file changes, skipped files, and any errors." },
            { title: "If it needs attention", detail: "Inspect incomplete work and retry the affected operation." },
          ]} /></div>
          <section className="workspace-reference"><h2>Know what an outcome means</h2><div className="reference-columns"><div><Status status="success" /><p>The operation finished successfully. Recovery tests report the files they verified.</p></div><div><Status status="partial" /><p>Some work finished, but skipped or unreadable files mean the copy is incomplete.</p></div><div><Status status="failed" /><p>The operation did not finish successfully. Open its details to find the cause.</p></div></div></section>
        </>
      ) : jobs.length > 0 ? (
        <section className="activity-ledger" aria-busy={busy} aria-label="Operation history">
          <div className="activity-ledger-heading"><h2>Operations</h2><span>{busy ? "Refreshing…" : `${visible.length} ${visible.length === 1 ? "match" : "matches"} on this page`}</span></div>
          {visible.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
          {!visible.length && <Empty icon={<Search size={24} />} heading="No matching operations" action={<Button onClick={() => { setFilter("all"); setSearch(""); setKind("all"); }}>Clear filters</Button>}>Filters apply to this page of history. Try another page or clear the filters.</Empty>}
        </section>
      ) : null}
      {total > 0 && <><div className="pagination">
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
      </div><p className="workspace-footnote">Filters apply to the current 50-operation page. Incomplete includes partial, failed, interrupted, and cancelled work.</p></>}
    </div>
  );
}

function UpdateControl() {
  const { state, perform } = useApp();
  const update = state.update;
  if (!["available", "downloading", "ready", "installing"].includes(update.status) && !(update.status === "error" && update.version)) return null;
  const working = ["downloading", "installing"].includes(update.status);
  const label = update.status === "ready" ? "Restart to update" : update.status === "downloading" ? `Downloading ${Math.round(update.progress ?? 0)}%` : update.status === "installing" ? "Restarting…" : update.status === "error" ? "Retry download" : "Download update";
  const detail = update.status === "ready" && state.busy ? "Waiting for backup work" : `Version ${update.version}`;
  return <button className="sidebar-update" aria-label={label} title={update.message || `${label} · ${detail}`} disabled={working || (update.status === "ready" && state.busy)} onClick={() => void perform({ type: "updates", action: update.status === "ready" ? "install" : "download" })}>
    {update.status === "ready" ? <RefreshCw size={17} aria-hidden="true" /> : <ArrowDownToLine size={17} aria-hidden="true" />}
    <span className="update-copy" aria-live="polite"><span>{label}</span><small>{detail}</small></span>
  </button>;
}
