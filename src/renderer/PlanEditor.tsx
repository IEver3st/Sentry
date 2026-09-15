import { useState } from "react";
import {
  File,
  FolderOpen,
  HardDrive,
  Plus,
  ScanLine,
  Cloud,
} from "lucide-react";
import type { Destination, Plan, Preview } from "../shared/contracts";
import {
  Button,
  bytes,
  CheckField,
  Field,
  lines,
  Modal,
  Notice,
  useApp,
} from "./ui";

export function DestinationForm({
  onDone,
  onCancel,
}: {
  onDone: (destination: Destination) => void;
  onCancel: () => void;
}) {
  const { state, perform } = useApp();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"local" | "gdrive">("local");
  const [location, setLocation] = useState("");
  const [password, setPassword] = useState("");
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setError("");
    if (
      !name.trim() ||
      !location.trim() ||
      password.length < (existing ? 1 : 8)
    ) {
      setError(
        existing
          ? "Enter a name, repository location, and its existing password."
          : "Enter a name, repository location, and password of at least 8 characters.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await perform({
        type: "add-destination",
        id: crypto.randomUUID(),
        name,
        kind,
        location,
        password,
        existing,
      });
      setPassword("");
      if (result) onDone(result);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="destination-form">
      <div className="two-column">
        <Field label="Destination name">
          <input
            aria-label="Destination name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="External drive"
            maxLength={120}
          />
        </Field>
        <Field label="Storage">
          <select
            aria-label="Storage"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="local">Drive or network share</option>
            <option value="gdrive">Google Drive</option>
          </select>
        </Field>
      </div>
      {kind === "gdrive" && !state.googleConnected && (
        <Notice error>
          {state.googleConfigured
            ? "Connect Google Drive in Settings before adding this destination."
            : "Google OAuth is not configured. See the Google Drive setup in Settings."}
        </Notice>
      )}
      <Field
        label={kind === "local" ? "Repository folder" : "Google Drive folder"}
        hint={
          kind === "local"
            ? "Choose a dedicated folder outside your backup sources."
            : "Folder path in the connected Google Drive account."
        }
      >
        <div className="input-action">
          <input
            aria-label="Repository folder"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={
              kind === "local" ? "E:\\Sentry Backups" : "Sentry/Personal"
            }
          />
          {kind === "local" && (
            <Button
              aria-label="Choose repository folder"
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
      <CheckField
        label="Connect an existing Sentry / restic repository"
        checked={existing}
        onChange={setExisting}
      />
      <Field
        label={existing ? "Repository password" : "Create a recovery password"}
        hint="Keep a copy outside Sentry. Without this password, encrypted backups cannot be recovered."
      >
        <input
          aria-label="Repository password"
          type="password"
          autoComplete={existing ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
      <div className="dialog-footer">
        <Button
          onClick={() => {
            setPassword("");
            onCancel();
          }}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || (kind === "gdrive" && !state.googleConnected)}
          onClick={() => void save()}
        >
          {busy
            ? "Opening repository…"
            : existing
              ? "Connect repository"
              : "Create destination"}
        </Button>
      </div>
    </div>
  );
}

const presets: Record<string, { includes: string[]; excludes: string[] }> = {
  Custom: { includes: [], excludes: [] },
  Documents: {
    includes: [
      "**/*.pdf",
      "**/*.doc",
      "**/*.docx",
      "**/*.txt",
      "**/*.md",
      "**/*.odt",
      "**/*.xlsx",
      "**/*.pptx",
    ],
    excludes: [],
  },
  Photos: {
    includes: [
      "**/*.jpg",
      "**/*.jpeg",
      "**/*.png",
      "**/*.heic",
      "**/*.raw",
      "**/*.dng",
      "**/*.tif",
      "**/*.webp",
    ],
    excludes: [],
  },
  Schoolwork: { includes: [], excludes: ["**/~$*", "**/*.tmp"] },
  Development: {
    includes: [],
    excludes: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/__pycache__/**",
    ],
  },
};
export function newPlan(): Plan {
  return {
    id: crypto.randomUUID(),
    name: "",
    sources: [],
    destinationIds: [],
    enabled: true,
    includes: [],
    excludes: [],
    schedule: { kind: "daily", minutes: 60, time: "18:00", weekday: 0, day: 1 },
    retention: { daily: 7, weekly: 4, monthly: 12 },
    priority: 5,
    pruningSuspended: false,
  };
}

export function PlanEditor({
  initial,
  onClose,
}: {
  initial: Plan;
  onClose: () => void;
}) {
  const { state, perform } = useApp();
  const [plan, setPlan] = useState<Plan>(initial);
  const [sourceText, setSourceText] = useState(initial.sources.join("\n"));
  const [includeText, setIncludeText] = useState(initial.includes.join("\n"));
  const [excludeText, setExcludeText] = useState(initial.excludes.join("\n"));
  const [preview, setPreview] = useState<Preview>();
  const [showDestination, setShowDestination] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update<K extends keyof Plan>(key: K, value: Plan[K]) {
    setPlan((current) => ({ ...current, [key]: value }));
  }
  async function choose(kind: "sources" | "folder" | "file") {
    const paths = await perform({ type: "choose-path", kind });
    if (paths?.length)
      setSourceText((current) =>
        [...new Set([...lines(current), ...paths])].join("\n"),
      );
    setPreview(undefined);
  }
  async function save() {
    setError("");
    const candidate = {
      ...plan,
      sources: lines(sourceText),
      includes: lines(includeText),
      excludes: lines(excludeText),
    };
    if (
      !candidate.name.trim() ||
      !candidate.sources.length ||
      !candidate.destinationIds.length
    ) {
      setError(
        "Give this plan a name, at least one source, and a destination.",
      );
      return;
    }
    setBusy(true);
    try {
      if (
        await perform(
          { type: "save-plan", plan: candidate },
          "Backup plan saved.",
        )
      )
        onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={initial.name ? "Edit backup plan" : "New backup plan"}
      description="Choose the files to protect and where to keep their copies."
      wide
    >
      <div className="dialog-body">
        <Field label="Plan name">
          <input
            autoFocus
            aria-label="Plan name"
            value={plan.name}
            maxLength={120}
            placeholder="Personal documents"
            onChange={(e) => update("name", e.target.value)}
          />
        </Field>
        <section className="form-section">
          <div className="section-heading">
            <h3>Sources</h3>
            <div className="button-group">
              <Button size="small" onClick={() => void choose("folder")}>
                <FolderOpen size={14} />
                Add folder
              </Button>
              <Button size="small" onClick={() => void choose("file")}>
                <File size={14} />
                Add files
              </Button>
            </div>
          </div>
          <Field
            label="Files and folders"
            hint="One absolute path per line. Source folders retain their identity in each snapshot."
          >
            <textarea
              aria-label="Files and folders"
              rows={3}
              value={sourceText}
              placeholder="C:\\Users\\You\\Documents"
              onChange={(e) => {
                setSourceText(e.target.value);
                setPreview(undefined);
              }}
            />
          </Field>
        </section>
        <section className="form-section">
          <div className="section-heading">
            <h3>Destinations</h3>
            <Button size="small" onClick={() => setShowDestination(true)}>
              <Plus size={14} />
              New destination
            </Button>
          </div>
          {state.destinations.length === 0 ? (
            <p className="hint">
              Add a drive or Google Drive destination to keep your backups.
            </p>
          ) : (
            <div className="destination-choices">
              {state.destinations.map((destination) => (
                <label className="destination-choice" key={destination.id}>
                  <input
                    type="checkbox"
                    checked={plan.destinationIds.includes(destination.id)}
                    onChange={(e) =>
                      update(
                        "destinationIds",
                        e.target.checked
                          ? [...plan.destinationIds, destination.id]
                          : plan.destinationIds.filter(
                              (id) => id !== destination.id,
                            ),
                      )
                    }
                  />
                  {destination.kind === "local" ? (
                    <HardDrive size={18} />
                  ) : (
                    <Cloud size={18} />
                  )}
                  <span>
                    <strong>{destination.name}</strong>
                    <small>{destination.location}</small>
                  </span>
                  <span className="muted">{destination.status}</span>
                </label>
              ))}
            </div>
          )}
        </section>
        <section className="form-section">
          <h3>Schedule</h3>
          <div className="form-grid">
            <Field label="Run">
              <select
                aria-label="Schedule frequency"
                value={plan.schedule.kind}
                onChange={(e) =>
                  update("schedule", {
                    ...plan.schedule,
                    kind: e.target.value as Plan["schedule"]["kind"],
                  })
                }
              >
                <option value="manual">Manually</option>
                <option value="interval">At an interval</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
            {plan.schedule.kind === "interval" && (
              <Field label="Every (minutes)">
                <input
                  aria-label="Interval minutes"
                  type="number"
                  min={15}
                  max={525600}
                  value={plan.schedule.minutes}
                  onChange={(e) =>
                    update("schedule", {
                      ...plan.schedule,
                      minutes: Number(e.target.value),
                    })
                  }
                />
              </Field>
            )}
            {["daily", "weekly", "monthly"].includes(plan.schedule.kind) && (
              <Field label="Local time">
                <input
                  aria-label="Schedule time"
                  type="time"
                  value={plan.schedule.time}
                  onChange={(e) =>
                    update("schedule", {
                      ...plan.schedule,
                      time: e.target.value,
                    })
                  }
                />
              </Field>
            )}
            {plan.schedule.kind === "weekly" && (
              <Field label="Day">
                <select
                  aria-label="Weekday"
                  value={plan.schedule.weekday}
                  onChange={(e) =>
                    update("schedule", {
                      ...plan.schedule,
                      weekday: Number(e.target.value),
                    })
                  }
                >
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {plan.schedule.kind === "monthly" && (
              <Field label="Day of month">
                <input
                  aria-label="Day of month"
                  type="number"
                  min={1}
                  max={31}
                  value={plan.schedule.day}
                  onChange={(e) =>
                    update("schedule", {
                      ...plan.schedule,
                      day: Number(e.target.value),
                    })
                  }
                />
              </Field>
            )}
          </div>
          <CheckField
            label="Enable this plan"
            checked={plan.enabled}
            onChange={(v) => update("enabled", v)}
          />
        </section>
        <details className="form-section">
          <summary>
            File rules & preview<span>Include and exclude patterns</span>
          </summary>
          <Field
            label="Start from a preset"
            hint="Presets replace the patterns below. Review them before saving. Git history and configuration are kept unless you exclude them."
          >
            <select
              aria-label="File preset"
              defaultValue="Custom"
              onChange={(e) => {
                const preset = presets[e.target.value];
                setIncludeText(preset.includes.join("\n"));
                setExcludeText(preset.excludes.join("\n"));
                setPreview(undefined);
              }}
            >
              {Object.keys(presets).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Field>
          <div className="two-column">
            <Field
              label="Include patterns"
              hint="One glob per line. Empty includes all files."
            >
              <textarea
                aria-label="Include patterns"
                rows={4}
                value={includeText}
                onChange={(e) => {
                  setIncludeText(e.target.value);
                  setPreview(undefined);
                }}
                placeholder="**/*.pdf"
              />
            </Field>
            <Field
              label="Exclude patterns"
              hint="Patterns match paths; ** crosses folders."
            >
              <textarea
                aria-label="Exclude patterns"
                rows={4}
                value={excludeText}
                onChange={(e) => {
                  setExcludeText(e.target.value);
                  setPreview(undefined);
                }}
                placeholder="**/node_modules/**"
              />
            </Field>
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!lines(sourceText).length) {
                setError("Add a source before previewing.");
                return;
              }
              setBusy(true);
              try {
                setPreview(
                  await perform({
                    type: "preview",
                    sources: lines(sourceText),
                    includes: lines(includeText),
                    excludes: lines(excludeText),
                    destinationIds: plan.destinationIds,
                  }),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <ScanLine size={15} />
            {busy ? "Scanning…" : "Preview files"}
          </Button>
          {preview && (
            <div className="preview">
              <p>
                <strong>{preview.included.toLocaleString()}</strong> included ·{" "}
                {preview.excluded.toLocaleString()} excluded ·{" "}
                {bytes(preview.bytes)}
              </p>
              {preview.warnings.map((warning, index) => (
                <Notice error key={index}>
                  {warning}
                </Notice>
              ))}
              <div className="preview-list">
                {preview.entries.slice(0, 200).map((entry, index) => (
                  <div key={index} className="preview-row">
                    <span title={entry.path}>{entry.path}</span>
                    <small>
                      {entry.included
                        ? bytes(entry.size)
                        : entry.reason || "Excluded"}
                    </small>
                  </div>
                ))}
              </div>
              {(preview.truncated || preview.entries.length > 200) && (
                <p className="hint">
                  Showing a limited preview. Backup scans the complete source
                  selection.
                </p>
              )}
            </div>
          )}
        </details>
        <details className="form-section">
          <summary>
            Retention & priority<span>Version history and weather order</span>
          </summary>
          <div className="form-grid">
            {(["daily", "weekly", "monthly"] as const).map((period) => (
              <Field key={period} label={`Keep ${period}`}>
                <input
                  aria-label={`Keep ${period}`}
                  type="number"
                  min={period === "daily" ? 1 : 0}
                  value={plan.retention[period]}
                  onChange={(e) =>
                    update("retention", {
                      ...plan.retention,
                      [period]: Number(e.target.value),
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <Field
            label="Weather priority"
            hint="Higher priority plans run first. Keep urgent plans small and include an off-device destination."
          >
            <input
              aria-label="Weather priority"
              type="number"
              min={0}
              max={10}
              value={plan.priority}
              onChange={(e) => update("priority", Number(e.target.value))}
            />
          </Field>
          <CheckField
            label="Suspend automatic pruning"
            checked={plan.pruningSuspended}
            onChange={(v) => update("pruningSuspended", v)}
            hint="Keep versions while investigating unexpected file changes."
          />
        </details>
        {error && <Notice error>{error}</Notice>}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Working…" : "Save plan"}
        </Button>
      </div>
      <Modal
        open={showDestination}
        onOpenChange={setShowDestination}
        title="Add destination"
        description="Backups are encrypted before they leave your computer."
      >
        <div className="dialog-body">
          <DestinationForm
            onCancel={() => setShowDestination(false)}
            onDone={(destination) => {
              update("destinationIds", [
                ...plan.destinationIds,
                destination.id,
              ]);
              setShowDestination(false);
            }}
          />
        </div>
      </Modal>
    </Modal>
  );
}

export function RunDialog({
  plan,
  onClose,
}: {
  plan: Plan;
  onClose: () => void;
}) {
  const { perform } = useApp();
  const [name, setName] = useState("");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={`Back up ${plan.name}`}
      description="Create a recoverable version before making changes."
    >
      <div className="dialog-body">
        <Field label="Snapshot name (optional)">
          <input
            autoFocus
            aria-label="Snapshot name"
            placeholder="Before project upgrade"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <CheckField
          label="Pin this snapshot"
          hint="Pinned snapshots are kept when old versions are pruned."
          checked={pin}
          onChange={setPin}
        />
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (
                await perform(
                  {
                    type: "run",
                    planId: plan.id,
                    name: name || undefined,
                    pin,
                  },
                  "Backup queued.",
                )
              )
                onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Back up now
        </Button>
      </div>
    </Modal>
  );
}
