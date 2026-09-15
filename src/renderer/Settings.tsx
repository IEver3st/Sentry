import { useState } from "react";
import {
  ArrowDownToLine,
  Cloud,
  CloudLightning,
  FolderOpen,
  HardDrive,
  KeyRound,
  Link,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { Destination, Settings } from "../shared/contracts";
import {
  Button,
  bytes,
  CheckField,
  Confirm,
  date,
  Field,
  lines,
  Modal,
  Notice,
  Status,
  useApp,
} from "./ui";
import { DestinationForm } from "./PlanEditor";

type SettingsTab = "General" | "Destinations" | "Weather" | "Maintenance";

function retentionSummary(result: unknown): string {
  const kept: Array<Record<string, unknown>> = [];
  const removed: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.keep))
      for (const snapshot of item.keep)
        if (snapshot && typeof snapshot === "object")
          kept.push(snapshot as Record<string, unknown>);
    if (Array.isArray(item.remove))
      for (const snapshot of item.remove)
        if (snapshot && typeof snapshot === "object")
          removed.push(snapshot as Record<string, unknown>);
    if (item.value) visit(item.value);
  };
  visit(result);
  const describe = (snapshot: Record<string, unknown>) =>
    `${typeof snapshot.time === "string" ? date(snapshot.time) : "Snapshot"} · ${String(snapshot.short_id || snapshot.id || "").slice(0, 8)}`;
  return [
    `${kept.length} versions kept · ${removed.length} versions removed`,
    ...removed.map((snapshot) => `Remove   ${describe(snapshot)}`),
    ...kept.map((snapshot) => `Keep     ${describe(snapshot)}`),
  ].join("\n");
}
export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("General");
  return (
    <>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {(["General", "Destinations", "Weather", "Maintenance"] as const).map(
          (name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              id={`tab-${name}`}
              aria-controls={`panel-${name}`}
              onClick={() => setTab(name)}
              onKeyDown={(event) => {
                const options: SettingsTab[] = [
                  "General",
                  "Destinations",
                  "Weather",
                  "Maintenance",
                ];
                let next: SettingsTab | undefined;
                if (event.key === "ArrowRight")
                  next = options[(options.indexOf(tab) + 1) % options.length];
                if (event.key === "ArrowLeft")
                  next =
                    options[
                      (options.indexOf(tab) + options.length - 1) %
                        options.length
                    ];
                if (event.key === "Home") next = options[0];
                if (event.key === "End") next = options.at(-1);
                if (next) {
                  event.preventDefault();
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
              tabIndex={tab === name ? 0 : -1}
            >
              {name}
            </button>
          ),
        )}
      </div>
      <div
        className="settings-panel"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "General" ? (
          <General />
        ) : tab === "Destinations" ? (
          <Destinations />
        ) : tab === "Weather" ? (
          <Weather />
        ) : (
          <Maintenance />
        )}
      </div>
    </>
  );
}
function General() {
  const { state, perform } = useApp();
  const [bandwidth, setBandwidth] = useState(state.settings.bandwidthKiB);
  const change = (patch: Partial<Settings>) =>
    void perform({
      type: "settings",
      settings: { ...state.settings, ...patch },
    });
  return (
    <>
      <section className="settings-section">
        <h2>Appearance</h2>
        <div className="setting-row">
          <div>
            <strong>Color theme</strong>
            <p>Follow Windows or choose your own appearance.</p>
          </div>
          <select
            aria-label="Color theme"
            value={state.settings.theme}
            onChange={(e) =>
              change({ theme: e.target.value as Settings["theme"] })
            }
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </section>
      <section className="settings-section">
        <h2>Background protection</h2>
        <CheckField
          label="Start Sentry when I sign in"
          checked={state.settings.startAtLogin}
          onChange={(value) => change({ startAtLogin: value })}
          hint="Starts in the tray and checks for missed backups."
        />
        <CheckField
          label="Pause automatic backups on battery"
          checked={state.settings.pauseOnBattery}
          onChange={(value) => change({ pauseOnBattery: value })}
        />
        <CheckField
          label="Run automatic backups only when idle"
          checked={state.settings.idleOnly}
          onChange={(value) => change({ idleOnly: value })}
        />
        <CheckField
          label="Allow automatic transfers on metered networks"
          checked={state.settings.allowMetered}
          onChange={(value) => change({ allowMetered: value })}
        />
        <div className="inline-note">
          Closing the window keeps Sentry in the tray. Quitting Sentry stops
          scheduling until you open it again. Backups protect ordinary files,
          not a running system or application-consistent database.
        </div>
      </section>
      <section className="settings-section">
        <h2>Transfers</h2>
        <div className="setting-row">
          <div>
            <strong>Bandwidth limit</strong>
            <p>KiB/s per transfer. Set 0 for unlimited.</p>
          </div>
          <div className="input-action bandwidth-input">
            <input
              aria-label="Bandwidth limit KiB per second"
              type="number"
              min={0}
              max={1048576}
              value={bandwidth}
              onChange={(e) => setBandwidth(Number(e.target.value))}
            />
            <Button onClick={() => change({ bandwidthKiB: bandwidth })}>
              Save
            </Button>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h2>Application</h2>
        <div className="setting-row">
          <div>
            <strong>Sentry</strong>
            <p>{state.engineVersion || "Engine version unavailable"}</p>
          </div>
          <Confirm
            title="Quit Sentry?"
            description="Scheduled backups and weather checks stop until Sentry is opened again. Finish or cancel active work before quitting."
            action="Quit Sentry"
            onConfirm={async () => {
              await perform({ type: "window", action: "quit" });
            }}
          >
            <Button>Quit Sentry</Button>
          </Confirm>
        </div>
      </section>
    </>
  );
}

function Destinations() {
  const { state, perform } = useApp();
  const [add, setAdd] = useState(false);
  const [manage, setManage] = useState<Destination>();
  const [quota, setQuota] = useState<{ used: number; limit?: number }>();
  const [connecting, setConnecting] = useState(false);
  return (
    <>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Backup destinations</h2>
            <p className="hint">
              Repositories stay recoverable without this application's catalog.
            </p>
          </div>
          <Button size="small" onClick={() => setAdd(true)}>
            <Plus size={15} />
            Add destination
          </Button>
        </div>
        {!state.destinations.length ? (
          <div className="section-empty">
            No destinations connected. Add a drive, network share, or Google
            Drive repository.
          </div>
        ) : (
          state.destinations.map((destination) => (
            <div className="destination-row" key={destination.id}>
              {destination.kind === "gdrive" ? (
                <Cloud size={20} />
              ) : (
                <HardDrive size={20} />
              )}
              <div className="destination-info">
                <strong>{destination.name}</strong>
                <p>{destination.location}</p>
                <small>
                  Last success {date(destination.lastSuccess)} · Last check{" "}
                  {date(destination.lastVerified)}
                </small>
                {destination.error && (
                  <span className="error-text">{destination.error}</span>
                )}
              </div>
              <Status status={destination.status} />
              <Button size="small" onClick={() => setManage(destination)}>
                Manage
              </Button>
            </div>
          ))
        )}
      </section>
      <section className="settings-section">
        <h2>Google Drive</h2>
        <div className="setting-row">
          <div>
            <strong>
              {state.googleConnected
                ? "Google Drive connected"
                : "Connect your Google account"}
            </strong>
            <p>
              {state.googleConfigured
                ? "Authorize Sentry in your browser. Credentials are stored using Windows encryption."
                : "This build needs Google installed-app OAuth configuration before account connection is available."}
            </p>
          </div>
          {state.googleConnected ? (
            <Confirm
              title="Disconnect Google Drive?"
              description="Cloud backups will need a reconnection. Existing cloud repositories and local copies remain available."
              action="Disconnect"
              onConfirm={async () => {
                await perform(
                  { type: "google-disconnect" },
                  "Google Drive disconnected.",
                );
              }}
            >
              <Button>Disconnect</Button>
            </Confirm>
          ) : (
            <Button
              disabled={!state.googleConfigured || connecting}
              onClick={async () => {
                setConnecting(true);
                try {
                  await perform(
                    { type: "google-connect" },
                    "Google Drive connected.",
                  );
                } finally {
                  setConnecting(false);
                }
              }}
            >
              <Link size={15} />
              {connecting
                ? "Waiting for authorization…"
                : "Connect Google Drive"}
            </Button>
          )}
        </div>
        {!state.googleConfigured && (
          <details className="setup-details">
            <summary>Application configuration</summary>
            <p>
              The application owner must configure a Google Cloud Desktop OAuth
              client with the Drive API enabled, publish the required consent
              screen, and distribute its client ID using Sentry's documented
              build configuration. A desktop client secret is not confidential.
            </p>
            <p>
              See README → Google Drive setup for the exact configuration.
              Sentry will not show a connected account until authorization
              succeeds.
            </p>
          </details>
        )}
        {state.googleConnected && (
          <div className="setting-row">
            <span>
              {quota
                ? `${bytes(quota.used)} used${quota.limit ? ` of ${bytes(quota.limit)}` : ""}`
                : "Storage quota has not been checked."}
            </span>
            <Button
              size="small"
              onClick={async () =>
                setQuota(await perform({ type: "google-quota" }))
              }
            >
              <RefreshCw size={14} />
              Check quota
            </Button>
          </div>
        )}
      </section>
      <Modal
        open={add}
        onOpenChange={setAdd}
        title="Add destination"
        description="Use a new repository or reconnect your existing backups."
      >
        <div className="dialog-body">
          <DestinationForm
            onCancel={() => setAdd(false)}
            onDone={() => setAdd(false)}
          />
        </div>
      </Modal>
      {manage && (
        <ManageDestination
          destination={manage}
          onClose={() => setManage(undefined)}
        />
      )}
    </>
  );
}

function ManageDestination({
  destination,
  onClose,
}: {
  destination: Destination;
  onClose: () => void;
}) {
  const { state, perform, notify } = useApp();
  const [location, setLocation] = useState(destination.location);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const current =
    state.destinations.find((item) => item.id === destination.id) ||
    destination;
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={destination.name}
      description="Validate the repository, reconnect storage, or verify your recovery password."
    >
      <div className="dialog-body">
        <div className="repository-facts">
          <span>Repository identity</span>
          <code>{destination.repositoryId}</code>
          <span>Last integrity check</span>
          <strong>{date(current.lastVerified)}</strong>
          <span>Result</span>
          <strong>{current.verification || "Not checked"}</strong>
          <span>Available space</span>
          <strong>{bytes(current.freeBytes)}</strong>
        </div>
        <div className="button-group">
          <Button
            disabled={busy}
            onClick={() =>
              void perform(
                { type: "check", destinationId: destination.id, full: false },
                "Repository check queued.",
              )
            }
          >
            <ShieldCheck size={15} />
            Check repository
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void perform(
                { type: "check", destinationId: destination.id, full: true },
                "Full data verification queued.",
              )
            }
          >
            Verify all data
          </Button>
        </div>
        <section className="form-section">
          <Field
            label="Repository location"
            hint="If a drive letter changed, reconnect here. Sentry checks that its repository identity matches."
          >
            <div className="input-action">
              <input
                aria-label="Repository location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              {destination.kind === "local" && (
                <Button
                  aria-label="Choose reconnected repository folder"
                  onClick={async () => {
                    const paths = await perform({
                      type: "choose-path",
                      kind: "folder",
                    });
                    if (paths?.[0]) setLocation(paths[0]);
                  }}
                >
                  <FolderOpen size={16} />
                </Button>
              )}
            </div>
          </Field>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await perform(
                  {
                    type: "reconnect-destination",
                    id: destination.id,
                    location,
                  },
                  "Repository reconnected and its identity verified.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={15} />
            Reconnect
          </Button>
        </section>
        <section className="form-section">
          <Field
            label="Test recovery password"
            hint="Use your saved recovery copy to confirm it opens this repository."
          >
            <input
              aria-label="Test recovery password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setVerified(false);
              }}
            />
          </Field>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!password) {
                notify("Enter your recovery password.", true);
                return;
              }
              setBusy(true);
              try {
                const result = await perform({
                  type: "verify-password",
                  destinationId: destination.id,
                  password,
                });
                setPassword("");
                setVerified(result === true);
                if (result === false)
                  notify("This password could not open the repository.", true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <KeyRound size={15} />
            Verify password
          </Button>
          {verified && (
            <Notice>The recovery password opened this repository.</Notice>
          )}
        </section>
        <section className="form-section">
          <Confirm
            title={`Disconnect ${destination.name}?`}
            description="Removes this destination from Sentry. Backup files remain untouched. Plans that use it must be updated first."
            action="Disconnect destination"
            onConfirm={async () => {
              if (
                await perform(
                  { type: "delete-destination", id: destination.id },
                  "Destination disconnected. Backup files are unchanged.",
                )
              )
                onClose();
            }}
          >
            <Button variant="danger">
              <Trash2 size={15} />
              Disconnect destination
            </Button>
          </Confirm>
        </section>
      </div>
    </Modal>
  );
}

function Weather() {
  const { state, perform } = useApp();
  const [weather, setWeather] = useState(state.settings.weather);
  const [events, setEvents] = useState(weather.events.join("\n"));
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof Settings["weather"]>(
    key: K,
    value: Settings["weather"][K],
  ) => setWeather((current) => ({ ...current, [key]: value }));
  return (
    <>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Weather-triggered backups</h2>
            <p className="hint">
              An additional backup when a relevant US National Weather Service
              alert arrives.
            </p>
          </div>
          <CloudLightning size={24} />
        </div>
        <CheckField
          label="Enable weather automation"
          checked={weather.enabled}
          onChange={(value) => update("enabled", value)}
        />
        <div className="weather-status">
          <span>
            Last checked <strong>{date(state.weather.lastCheck)}</strong>
          </span>
          <span>
            Last successful check{" "}
            <strong>{date(state.weather.lastSuccess)}</strong>
          </span>
          <span>
            <strong>{state.weather.alerts}</strong> eligible alerts
          </span>
        </div>
        {state.weather.error && <Notice error>{state.weather.error}</Notice>}
        <p className="inline-note">
          Weather checks supplement regular schedules. Coverage is limited to
          the US National Weather Service service area. A stale or unavailable
          feed cannot trigger protection.
        </p>
      </section>
      <section className="settings-section">
        <h2>Location</h2>
        <Field label="Location name">
          <input
            aria-label="Weather location name"
            value={weather.locationName}
            onChange={(e) => update("locationName", e.target.value)}
            placeholder="Home"
          />
        </Field>
        <div className="two-column">
          <Field label="Latitude">
            <input
              aria-label="Weather latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={weather.latitude}
              onChange={(e) => update("latitude", Number(e.target.value))}
            />
          </Field>
          <Field label="Longitude">
            <input
              aria-label="Weather longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={weather.longitude}
              onChange={(e) => update("longitude", Number(e.target.value))}
            />
          </Field>
        </div>
      </section>
      <section className="settings-section">
        <h2>Alert rules</h2>
        <Field label="Alert types" hint="One exact NWS event name per line.">
          <textarea
            aria-label="Weather alert types"
            rows={3}
            value={events}
            onChange={(e) => setEvents(e.target.value)}
          />
        </Field>
        <Field label="Severity">
          <div className="inline-checks">
            {(
              ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const
            ).map((severity) => (
              <CheckField
                key={severity}
                label={severity}
                checked={weather.severities.includes(severity)}
                onChange={(checked) =>
                  update(
                    "severities",
                    checked
                      ? [...weather.severities, severity]
                      : weather.severities.filter((item) => item !== severity),
                  )
                }
              />
            ))}
          </div>
        </Field>
        <Field
          label="Cooldown (minutes)"
          hint="Repeated alerts are deduplicated. Cooldown limits extra backups."
        >
          <input
            aria-label="Weather cooldown minutes"
            className="short-input"
            type="number"
            min={15}
            max={10080}
            value={weather.cooldownMinutes}
            onChange={(e) => update("cooldownMinutes", Number(e.target.value))}
          />
        </Field>
        <h3>Plans to protect</h3>
        {state.plans.length ? (
          state.plans.map((plan) => (
            <CheckField
              key={plan.id}
              label={plan.name}
              hint={`Priority ${plan.priority} · ${plan.destinationIds.length} destinations`}
              checked={weather.planIds.includes(plan.id)}
              onChange={(checked) =>
                update(
                  "planIds",
                  checked
                    ? [...weather.planIds, plan.id]
                    : weather.planIds.filter((id) => id !== plan.id),
                )
              }
            />
          ))
        ) : (
          <p className="hint">Create a plan before enabling automation.</p>
        )}
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await perform(
                {
                  type: "settings",
                  settings: {
                    ...state.settings,
                    weather: { ...weather, events: lines(events) },
                  },
                },
                "Weather settings saved.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save weather settings
        </Button>
      </section>
      <section className="settings-section">
        <h2>Check & test</h2>
        <div className="button-group">
          <Button
            disabled={busy}
            onClick={() =>
              void perform(
                { type: "weather-check", simulate: false },
                "Weather check completed.",
              )
            }
          >
            <RefreshCw size={15} />
            Check live alerts
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void perform(
                { type: "weather-check", simulate: true },
                "Simulation completed. Real protection history is unchanged.",
              )
            }
          >
            Simulate eligible alert
          </Button>
        </div>
        <p className="hint">
          Simulation tests saved automation rules. It is separate from real
          backup activity.
        </p>
        {state.weather.simulation && (
          <Notice>Simulation: {state.weather.simulation}</Notice>
        )}
      </section>
    </>
  );
}

function Maintenance() {
  const { state, perform } = useApp();
  const [planId, setPlanId] = useState(state.plans[0]?.id || "");
  const [destinationId, setDestinationId] = useState(
    state.plans[0]?.destinationIds[0] || "",
  );
  const [preview, setPreview] = useState<string>();
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    warnings: string[];
  }>();
  const [exportPath, setExportPath] = useState("");
  const plan = state.plans.find((item) => item.id === planId);
  return (
    <>
      <section className="settings-section">
        <h2>Version retention</h2>
        <p className="hint">
          Review versions before pruning. Pinned snapshots are always kept;
          shared content is removed only when no retained snapshot needs it.
        </p>
        <div className="two-column">
          <Field label="Plan">
            <select
              aria-label="Retention plan"
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setDestinationId(
                  state.plans.find((item) => item.id === e.target.value)
                    ?.destinationIds[0] || "",
                );
                setPreviewReady(false);
                setPreview(undefined);
              }}
            >
              <option value="" disabled>
                Choose a plan
              </option>
              {state.plans.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Destination">
            <select
              aria-label="Retention destination"
              value={destinationId}
              onChange={(e) => {
                setDestinationId(e.target.value);
                setPreviewReady(false);
                setPreview(undefined);
              }}
            >
              <option value="" disabled>
                Choose a destination
              </option>
              {state.destinations
                .filter((item) => plan?.destinationIds.includes(item.id))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        {plan && (
          <p>
            {plan.retention.daily} daily · {plan.retention.weekly} weekly ·{" "}
            {plan.retention.monthly} monthly
            {plan.pruningSuspended ? " · Automatic pruning suspended" : ""}
          </p>
        )}
        <div className="button-group">
          <Button
            disabled={!planId || !destinationId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await perform({
                  type: "retention",
                  planId,
                  destinationId,
                  preview: true,
                });
                if (result !== undefined) {
                  setPreview(retentionSummary(result));
                  setPreviewReady(true);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview retention
          </Button>
          <Confirm
            title="Prune old snapshots?"
            description="Versions outside this plan's retention policy will be removed from this destination. Pinned snapshots are kept. This cannot be undone."
            action="Apply retention"
            onConfirm={async () => {
              if (
                await perform(
                  { type: "retention", planId, destinationId, preview: false },
                  "Retention queued. Follow its result in Activity.",
                )
              ) {
                setPreviewReady(false);
                setPreview(undefined);
              }
            }}
          >
            <Button disabled={!previewReady || busy || state.busy}>
              Apply retention
            </Button>
          </Confirm>
        </div>
        {preview && (
          <details className="retention-preview" open>
            <summary>Version changes</summary>
            <pre>{preview}</pre>
            <p className="hint">
              Shared blocks mean removed snapshot sizes do not equal freed disk
              space.
            </p>
          </details>
        )}
      </section>
      <section className="settings-section">
        <h2>Import legacy plan settings</h2>
        <p className="hint">
          Import supported settings from Sentry-Old. Review every imported plan
          and reconnect its destinations. Legacy backup files are left
          untouched.
        </p>
        <Button
          onClick={async () => {
            const paths = await perform({ type: "choose-path", kind: "file" });
            if (paths?.[0])
              setImportResult(
                await perform({ type: "legacy-import", path: paths[0] }),
              );
          }}
        >
          <FolderOpen size={15} />
          Choose legacy settings
        </Button>
        {importResult && (
          <>
            <Notice>{importResult.imported} plans imported.</Notice>
            {importResult.warnings.map((warning, index) => (
              <Notice key={index} error>
                {warning}
              </Notice>
            ))}
          </>
        )}
      </section>
      <section className="settings-section">
        <h2>Diagnostics</h2>
        <p className="hint">
          Export application and job metadata with paths and credentials
          redacted. File contents are never included.
        </p>
        <Button
          onClick={async () => {
            const path = await perform({ type: "diagnostics" });
            if (path && path !== "Export cancelled") setExportPath(path);
          }}
        >
          <ArrowDownToLine size={15} />
          Export redacted diagnostics
        </Button>
        {exportPath && <Notice>Saved to {exportPath}</Notice>}
      </section>
      <section className="settings-section">
        <h2>Updates</h2>
        <div className="setting-row">
          <div>
            <strong>{state.update.status}</strong>
            <p>
              {state.update.version
                ? `Available version: ${state.update.version}`
                : "Check when you are ready. Downloads wait for active jobs."}
            </p>
          </div>
          <div className="button-group">
            <Button
              onClick={() => void perform({ type: "updates", action: "check" })}
            >
              Check for updates
            </Button>
            {state.update.url && (
              <Button
                disabled={state.busy}
                onClick={() =>
                  void perform({ type: "updates", action: "download" })
                }
              >
                Download update
              </Button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
