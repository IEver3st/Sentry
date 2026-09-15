import { randomUUID } from "node:crypto";
import { readFile, mkdir, statfs, stat, readdir, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { Store } from "./store";
import { ResticEngine, type Repository, type EngineEvent } from "./restic";
import { previewSources, validateSources, containsPath, safeSnapshotPath, snapshotPath, safeRestoreTarget } from "./paths";
import { captureDatabases } from "./capture";
import { previewFile, compareSnapshots, recoveryKit, scanGaps } from "./recovery";
import {
  inspectVolume,
  relocateVolume,
  sharesPhysicalDisk,
  type VolumeIdentity,
} from "./volume";
import { nextRun, isDue, reconcileTimeZone } from "../automation/schedule";
import { GoogleDriveAuth, type GoogleCredentials } from "../automation/google";
import {
  checkWeather,
  simulateWeather,
  acknowledgeWeather,
  type WeatherLedger,
} from "../automation/weather";
import {
  defaults,
  settingsSchema,
  planSchema,
  requestSchema,
  type State,
  type Request,
  type Settings,
  type Destination,
  type Plan,
  type Job,
  type Snapshot,
  type FileEntry,
  type WeatherStatus,
  type Protection,
  type RecoveryDrill,
  type FileVersion,
} from "../shared/contracts";

export interface Host {
  saveSecret(key: string, value?: string): Promise<void>;
  authorize(url: string): Promise<void>;
  publish(state: State): void;
}
export interface ServiceOptions {
  data: string;
  engines: string;
  secrets: Record<string, string>;
  clientId: string;
  clientSecret?: string;
  host: Host;
}
type JobPayload = {
  plan?: Plan;
  request?: Request;
  attempt?: number;
  notBefore?: number;
  sourceJobId?: string;
  sourceDestinationId?: string;
  snapshotId?: string;
  copyResolved?: boolean;
};
const now = () => new Date().toISOString();
function number(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
export class BackupService {
  readonly store: Store;
  readonly engine: ResticEngine;
  readonly google: GoogleDriveAuth;
  private active?: { job: Job; abort: AbortController };
  private running = false;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private emitting?: ReturnType<typeof setTimeout>;
  private engineVersion = "Checking engine";
  private weather: WeatherStatus;
  private weatherRunning = false;
  private settings: Settings;
  private secrets: Record<string, string>;
  private connected = false;
  private power: { battery: boolean; idleSeconds: number; metered?: boolean } =
    { battery: false, idleSeconds: 0 };
  private policyMessage?: string;
  private requests: Promise<unknown> = Promise.resolve();
  private reserved = false;
  private readonly credentialsAbort = new AbortController();
  private closing?: Promise<void>;
  private connectionScan = false;
  constructor(private readonly options: ServiceOptions) {
    this.store = new Store(options.data);
    this.settings =
      settingsSchema.parse(this.store.get<Settings>("settings", "app") ?? structuredClone(defaults));
    this.weather = this.store.get<WeatherStatus>("weather", "status") ?? {
      alerts: 0,
    };
    this.secrets = { ...options.secrets };
    this.engine = new ResticEngine({
      executable: join(options.engines, "restic.exe"),
      rcloneExecutable: join(options.engines, "rclone.exe"),
      cacheDir: join(options.data, "cache"),
    });
    this.google = new GoogleDriveAuth({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      load: async () => {
        try {
          return this.secrets.google
            ? (JSON.parse(this.secrets.google) as GoogleCredentials)
            : null;
        } catch {
          return null;
        }
      },
      save: async (c) => {
        await this.secret("google", c ? JSON.stringify(c) : undefined);
        this.connected = !!c;
      },
      onAuthorize: options.host.authorize,
    });
  }
  async start() {
    this.connected = await this.google.connected();
    try {
      this.engineVersion = await this.engine.version();
    } catch {
      this.engineVersion = "Backup engine unavailable. Reinstall Sentry.";
    }
    this.emit();
    await this.tick();
  }
  state(): State {
    const jobs = this.liveJobs(this.store.jobs(0, 100).jobs);
    if (this.active && !jobs.some((job) => job.id === this.active?.job.id))
      jobs.unshift({ ...this.active.job });
    return {
      plans: this.store.all<Plan>("plan"),
      destinations: this.store.all<Destination>("destination"),
      jobs: jobs.slice(0, 100),
      protection: this.store.all<Protection>("protection"),
      settings: this.settings,
      weather: this.weather,
      engineVersion: this.engineVersion,
      busy: !!this.active || this.running || this.reserved,
      googleConfigured: this.google.configured,
      googleConnected: this.connected,
      update: { status: "unavailable" },
      policy: this.policyMessage,
      recoveryDrills: this.store.all<RecoveryDrill>("drill"),
      gaps: this.store.get("gaps", "latest"),
    };
  }
  private liveJobs(jobs: Job[]): Job[] {
    return jobs.map((job) =>
      job.id === this.active?.job.id ? { ...this.active.job } : job,
    );
  }
  private emit(immediate = false) {
    if (this.closed) return;
    if (immediate) {
      clearTimeout(this.emitting);
      this.emitting = undefined;
      this.options.host.publish(this.state());
      return;
    }
    if (!this.emitting)
      this.emitting = setTimeout(() => {
        this.emitting = undefined;
        this.options.host.publish(this.state());
      }, 250);
  }
  private async secret(key: string, value?: string) {
    await this.options.host.saveSecret(key, value);
    if (value === undefined) delete this.secrets[key];
    else this.secrets[key] = value;
  }
  private destination(id: string): Destination {
    const d = this.store.get<Destination>("destination", id);
    if (!d) throw new Error("Destination was removed.");
    return d;
  }
  private plan(id: string): Plan {
    const p = this.store.get<Plan>("plan", id);
    if (!p) throw new Error("Plan was removed.");
    return p;
  }
  private async repo(
    d: Destination,
    verify = true,
    passwordOverride?: string,
  ): Promise<Repository> {
    const password = passwordOverride ?? this.secrets[d.id];
    if (!password)
      throw new Error("Reconnect this destination with its recovery password.");
    if (d.kind === "local" && verify) {
      try {
        await stat(d.location);
      } catch {
        const volume = this.store.get<VolumeIdentity>("volume", d.id);
        if (volume) {
          const relocated = await relocateVolume(d.location, volume.volumeId);
          if (relocated) d.location = relocated;
        }
      }
    }
    const repo: Repository = {
      location:
        d.kind === "gdrive" ? `rclone:SENTRY:${d.location}` : d.location,
      password,
      bandwidthKiB: this.settings.bandwidthKiB,
    };
    if (d.kind === "gdrive")
      repo.env = Object.fromEntries(
        Object.entries(await this.google.environment()).filter(
          (p): p is [string, string] => typeof p[1] === "string",
        ),
      );
    if (
      verify &&
      (await this.engine.identity(repo, this.credentialsAbort.signal)) !==
        d.repositoryId
    )
      throw new Error(
        "This is a different repository. Reconnect the expected backup destination.",
      );
    if (verify) this.store.put("destination", d.id, d);
    return repo;
  }
  private ensureIdle() {
    if (this.active || this.running)
      throw new Error("Wait for the current repository operation to finish.");
  }
  request(raw: unknown): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error("Sentry is shutting down."));
    const parsed = requestSchema.parse(raw);
    if (["state", "cancel", "history", "diagnostics-snapshot", "diagnostics"].includes(parsed.type))
      return this.dispatch(parsed);
    const work = this.requests
      .catch(() => {})
      .then(async () => {
        while (this.connectionScan && !this.closed) await new Promise(resolve => setTimeout(resolve, 25));
        if (this.closed) throw new Error("Sentry is shutting down.");
        this.reserved = true;
        try {
          return await this.dispatch(parsed);
        } finally {
          this.reserved = false;
          this.emit();
          void this.pump();
        }
      });
    this.requests = work;
    return work;
  }
  private async dispatch(raw: unknown): Promise<unknown> {
    const request = requestSchema.parse(raw);
    switch (request.type) {
      case "state":
        return this.state();
      case "history":
        {
          const page = this.store.jobs(request.offset, request.limit);
          return { ...page, jobs: this.liveJobs(page.jobs) };
        }
      case "save-plan": {
        const p = request.plan;
        if (p.replicateFrom && (!p.destinationIds.includes(p.replicateFrom) || this.destination(p.replicateFrom).kind !== "local"))
          throw new Error("Choose a local destination in this plan as its capture repository.");
        if (p.capture === "sqlite" && (p.includes.length || p.excludes.length))
          throw new Error("SQLite capture protects the selected database files in full. Remove include and exclude rules.");
        for (const id of p.destinationIds) {
          const d = this.destination(id);
          await validateSources(
            p.sources,
            d.kind === "local" ? d.location : undefined,
          );
        }
        const previous = this.store.get<Plan>("plan", p.id);
        this.store.put("plan", p.id, p);
        if (!p.enabled)
          for (const queued of this.store.queued())
            if (queued.planId === p.id && queued.trigger !== "manual") {
              queued.status = "cancelled";
              queued.finishedAt = now();
              queued.phase = "Plan disabled";
              this.store.job(queued);
            }
        if (
          !previous ||
          JSON.stringify(previous.schedule) !== JSON.stringify(p.schedule) ||
          previous.enabled !== p.enabled
        )
          this.store.put(
            "due",
            p.id,
            nextRun(p.schedule, new Date())?.toISOString() ?? null,
          );
        this.emit();
        return p;
      }
      case "delete-plan": {
        if (
          this.store.queued().some((j) => j.planId === request.id) ||
          this.active?.job.planId === request.id
        )
          throw new Error(
            "Cancel this plan’s pending jobs before removing it.",
          );
        this.store.remove("plan", request.id);
        this.store.remove("due", request.id);
        this.emit();
        return true;
      }
      case "preview": {
        const destinations = request.destinationIds
          .map((id) => this.destination(id))
          .filter((d) => d.kind === "local");
        const result = await previewSources(
          request.sources,
          request.includes,
          request.excludes,
          destinations.map((d) => d.location),
        );
        for (const d of destinations) {
          if (await sharesPhysicalDisk(request.sources[0], d.location))
            result.warnings.push(
              `${d.name} is on the same physical device as a source. It will not protect against that device failing.`,
            );
        }
        return result;
      }
      case "add-destination": {
        this.ensureIdle();
        if (this.store.get("destination", request.id))
          throw new Error("Destination identity already exists.");
        if (request.kind === "local" && !isAbsolute(request.location))
          throw new Error("Choose an absolute destination folder.");
        if (
          request.kind === "gdrive" &&
          !/^([\p{L}\p{N} _.-]+\/)*[\p{L}\p{N} _.-]+$/u.test(request.location)
        )
          throw new Error(
            "Use a Google Drive folder path without reserved characters.",
          );
        for (const p of this.store.all<Plan>("plan"))
          if (request.kind === "local")
            await validateSources(p.sources, request.location);
        const d: Destination = {
          id: request.id,
          name: request.name,
          kind: request.kind,
          location: request.location,
          repositoryId: "",
          status: "ready",
        };
        if (
          this.store
            .all<Destination>("destination")
            .some(
              (x) =>
                x.kind === d.kind &&
                x.location.toLowerCase() === d.location.toLowerCase(),
            )
        )
          throw new Error("This destination is already connected.");
        const repo: Repository = {
          location:
            d.kind === "gdrive" ? `rclone:SENTRY:${d.location}` : d.location,
          password: request.password,
        };
        if (d.kind === "gdrive")
          repo.env = Object.fromEntries(
            Object.entries(await this.google.environment()).filter(
              (p): p is [string, string] => typeof p[1] === "string",
            ),
          );
        if (d.kind === "local" && !request.existing) {
          await mkdir(d.location, { recursive: true });
          if ((await readdir(d.location)).length)
            throw new Error(
              "Choose an empty folder for a new repository, or connect this folder as an existing repository.",
            );
        }
        d.repositoryId = request.existing
          ? await this.engine.identity(repo, this.credentialsAbort.signal)
          : await this.engine.init(repo, this.credentialsAbort.signal);
        if (
          this.store
            .all<Destination>("destination")
            .some((x) => x.repositoryId === d.repositoryId)
        )
          throw new Error(
            "This repository is already connected. Use Reconnect to change its location.",
          );
        await this.secret(d.id, request.password);
        this.store.put("destination", d.id, d);
        if (d.kind === "local") {
          const volume = await inspectVolume(d.location);
          if (volume) this.store.put("volume", d.id, volume);
        }
        await this.refreshSnapshots(d, repo);
        this.emit();
        return d;
      }
      case "reconnect-destination": {
        this.ensureIdle();
        const d = this.destination(request.id);
        const updated = { ...d, location: request.location };
        const repo = await this.repo(
          { ...updated, id: d.id },
          false,
          request.password,
        );
        if (
          (await this.engine.identity(repo, this.credentialsAbort.signal)) !==
          d.repositoryId
        )
          throw new Error(
            "The selected repository does not match this destination. Existing backup metadata was preserved.",
          );
        if (request.password) await this.secret(d.id, request.password);
        updated.status = "ready";
        updated.error = undefined;
        this.store.put("destination", d.id, updated);
        this.emit();
        return updated;
      }
      case "delete-destination": {
        this.ensureIdle();
        if (
          this.store
            .all<Plan>("plan")
            .some((p) => p.destinationIds.includes(request.id))
        )
          throw new Error("Remove this destination from its plans first.");
        if (this.store.queued().some((j) => j.destinationId === request.id))
          throw new Error("Cancel queued operations first.");
        this.store.remove("destination", request.id);
        await this.secret(request.id);
        this.emit();
        return true;
      }
      case "run": {
        const plans = request.planId
          ? [this.plan(request.planId)]
          : this.store.all<Plan>("plan").filter((p) => p.enabled);
        const ids = plans.flatMap((p) =>
          this.enqueuePlan(p, "manual", request),
        );
        void this.pump();
        return ids;
      }
      case "file-history": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        const logical = isAbsolute(request.path) && !request.path.startsWith("/") ? snapshotPath(request.path) : safeSnapshotPath(request.path);
        const snapshots = await this.refreshSnapshots(d, await this.repo(d));
        const relevant = snapshots.filter(s => s.paths.some(p => logical.toLowerCase() === snapshotPath(p).toLowerCase() || logical.toLowerCase().startsWith(snapshotPath(p).toLowerCase() + "/")));
        const versions: FileVersion[] = [];
        for (const snapshot of relevant.slice(request.offset, request.offset + request.limit)) {
          await this.index(d, snapshot.id);
          const row = this.store.db.prepare("SELECT path,type,size,mtime FROM files WHERE destination=? AND snapshot=? AND path=? COLLATE NOCASE").get(d.id, snapshot.id, logical);
          versions.push({ snapshot, file: row as unknown as FileEntry | undefined });
        }
        return { versions, total: relevant.length };
      }
      case "file-preview": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        await this.index(d, request.snapshotId);
        const file = this.store.db.prepare("SELECT path,type,size,mtime FROM files WHERE destination=? AND snapshot=? AND path=?").get(d.id, request.snapshotId, safeSnapshotPath(request.path));
        if (!file) throw new Error("This file is not in the selected snapshot.");
        return previewFile(this.engine, await this.repo(d), request.snapshotId, file as unknown as FileEntry, this.options.data, this.credentialsAbort.signal);
      }
      case "snapshot-diff": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        return compareSnapshots(this.store, this.engine, await this.repo(d), d.id, request.before, request.after, request.offset, request.limit, this.credentialsAbort.signal);
      }
      case "copy-snapshot": {
        this.ensureIdle();
        if (request.sourceDestinationId === request.destinationId) throw new Error("Choose a different destination.");
        const source = this.destination(request.sourceDestinationId);
        if (source.kind !== "local") throw new Error("Choose a local repository as the source of a snapshot copy.");
        const snapshot = (await this.refreshSnapshots(source, await this.repo(source))).find(s => s.id === request.snapshotId);
        if (!snapshot || snapshot.incomplete) throw new Error("Choose a complete snapshot to copy.");
        const target = this.destination(request.destinationId);
        const job = this.newJob("copy", target, "manual", this.store.get<Plan>("plan", snapshot.planId));
        job.sourceDestinationId = source.id;
        this.store.enqueue(job, { request, sourceDestinationId: source.id, snapshotId: snapshot.id });
        this.emit();
        return job.id;
      }
      case "scan-gaps": {
        this.ensureIdle();
        const gaps = await scanGaps(this.store.all<Plan>("plan"), this.store.all<Destination>("destination"), this.store.all<Protection>("protection"), this.settings.discoveryRoots ?? [], this.credentialsAbort.signal);
        this.store.put("gaps", "latest", gaps);
        this.emit();
        return gaps;
      }
      case "recovery-kit": return recoveryKit(this.state());
      case "practice-recovery": {
        this.ensureIdle();
        this.validateRestoreTarget(request.target);
        await safeRestoreTarget(request.target);
        if ((await readdir(request.target)).length) throw new Error("Choose an empty folder for the recovery practice.");
        const repo = await this.repo(this.destination(request.destinationId), false, request.password);
        if (await this.engine.identity(repo, this.credentialsAbort.signal) !== this.destination(request.destinationId).repositoryId) throw new Error("Repository identity does not match.");
        const snapshots = (await this.engine.snapshots(repo, this.credentialsAbort.signal)).filter(s => !s.tags?.includes("sentry:incomplete")).sort((a,b) => b.time.localeCompare(a.time));
        if (!snapshots.length) throw new Error("No complete snapshot is available for practice.");
        const snapshot = snapshots[0];
        const mappings = this.engine.mappings(snapshot);
        let sample: { path: string; size: number } | undefined;
        await this.engine.list(repo, snapshot.id, entry => {
          if (entry.type === "file" && (!sample || (number(entry.size) > 0 && (sample.size === 0 || number(entry.size) < sample.size)))) sample = { path: String(entry.path), size: number(entry.size) };
        }, this.credentialsAbort.signal);
        if (!sample) throw new Error("No ordinary files are available for practice.");
        const picked = sample as { path: string; size: number };
        const logical = mappings.find(m => m.captured === picked.path)?.original ?? picked.path;
        const result = await this.engine.restore(repo, { snapshotId: snapshot.id, target: request.target, paths: [logical], overwrite: "never" }, undefined, this.credentialsAbort.signal);
        if (result.code !== 0) throw new Error("Practice recovery was incomplete. Recovered files remain in the selected folder.");
        return { files: 1, bytes: picked.size, snapshotId: snapshot.id, target: request.target };
      }
      case "cancel": {
        const job = this.store.getJob(request.id);
        if (this.active?.job.id === job.id) this.active.abort.abort();
        else if (job.status === "queued" || (job.kind === "copy" && ["failed", "interrupted", "partial"].includes(job.status))) {
          job.status = "cancelled";
          job.finishedAt = now();
          this.store.job(job);
        }
        this.emit();
        return true;
      }
      case "retry": {
        const old = this.store.getJob(request.id);
        if (
          !["failed", "partial", "interrupted", "cancelled"].includes(
            old.status,
          )
        )
          throw new Error("Only unsuccessful operations can be retried.");
        const payload = this.store.get<JobPayload>("payload", old.id);
        if (!payload)
          throw new Error(
            "This older operation cannot be retried. Start a new operation.",
          );
        const job = {
          ...old,
          id: randomUUID(),
          createdAt: now(),
          startedAt: undefined,
          finishedAt: undefined,
          status: "queued" as const,
          phase: "Queued",
          error: undefined,
          progress: undefined,
          retryOf: old.id,
        };
        this.store.enqueue(job, { ...payload, attempt: 0, notBefore: 0 });
        this.emit();
        void this.pump();
        return job.id;
      }
      case "snapshots": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        const snapshots = await this.refreshSnapshots(d, await this.repo(d));
        return request.planId
          ? snapshots.filter((s) => s.planId === request.planId)
          : snapshots;
      }
      case "files": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        await this.index(d, request.snapshotId);
        return this.store.files(
          d.id,
          request.snapshotId,
          request.search,
          request.offset,
          request.limit,
        );
      }
      case "restore": {
        const d = this.destination(request.destinationId);
        this.validateRestoreTarget(request.target);
        for (const p of this.store.all<Plan>("plan"))
          if (
            p.sources.some(
              (s) =>
                containsPath(s, request.target) ||
                containsPath(request.target, s),
            )
          )
            throw new Error(
              "Choose a restore folder separate from protected source folders.",
            );
        for (const destination of this.store.all<Destination>("destination"))
          if (
            destination.kind === "local" &&
            (containsPath(destination.location, request.target) ||
              containsPath(request.target, destination.location))
          )
            throw new Error(
              "Restore folder must be separate from backup repositories.",
            );
        return this.enqueueOperation("restore", d, request);
      }
      case "check":
        return this.enqueueOperation(
          "check",
          this.destination(request.destinationId),
          request,
        );
      case "test-recovery":
        return this.enqueueOperation(
          "test-recovery",
          this.destination(request.destinationId),
          request,
        );
      case "pin": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        const repo = await this.repo(d);
        if (this.copyNeedsSnapshot(d.id, request.snapshotId)) throw new Error("Wait for pending copies of this snapshot before changing its pin.");
        await this.engine.pin(
          repo,
          request.snapshotId,
          request.pinned,
          this.credentialsAbort.signal,
        );
        await this.refreshSnapshots(d, repo);
        this.emit();
        return true;
      }
      case "retention": {
        const p = this.plan(request.planId);
        if (!p.destinationIds.includes(request.destinationId))
          throw new Error("This destination is not part of the plan.");
        if (p.pruningSuspended && !request.preview)
          throw new Error(
            "Pruning is suspended after incomplete protection or a large change. Review snapshots and explicitly resume pruning in the plan.",
          );
        if (request.preview) {
          this.ensureIdle();
          return this.engine.retain(
            await this.repo(this.destination(request.destinationId)),
            { planId: p.id, ...p.retention, dryRun: true },
          );
        }
        return this.enqueueOperation(
          "prune",
          this.destination(request.destinationId),
          request,
          p,
        );
      }
      case "verify-password": {
        this.ensureIdle();
        const d = this.destination(request.destinationId);
        const repo = await this.repo(d, false, request.password);
        return (await this.engine.identity(repo)) === d.repositoryId;
      }
      case "settings": {
        this.settings = request.settings;
        this.store.put("settings", "app", this.settings);
        this.emit();
        void this.tick();
        return this.settings;
      }
      case "weather-check":
        return this.weatherCheck(request.simulate);
      case "google-connect":
        await this.google.connect(this.credentialsAbort.signal);
        this.connected = await this.google.connected();
        this.emit();
        return true;
      case "google-disconnect":
        this.ensureIdle();
        await this.google.disconnect();
        this.connected = false;
        this.emit();
        return true;
      case "google-quota":
        return this.google.quota();
      case "diagnostics-snapshot": {
        const state = this.state();
        return {
          process: { pid: process.pid, name: "Backup worker", cpu: null, memory: process.memoryUsage().rss },
          cpuUsage: process.cpuUsage(),
          engine: { version: state.engineVersion, busy: state.busy, paused: state.settings.paused, jobs: this.store.jobs(0, 1).total, queued: Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").get()!.n), destinations: state.destinations.length, unavailable: state.destinations.filter((d) => d.status !== "ready").length, googleConnected: state.googleConnected, weatherLastCheck: state.weather.lastCheck, weatherError: !!state.weather.error },
        };
      }
      case "diagnostics":
        return this.diagnostics();
      case "legacy-import":
        return this.importLegacy(request.path);
      default:
        throw new Error("This action requires the native application.");
    }
  }
  private validateRestoreTarget(target: string) {
    const protectedPaths = [this.options.data, ...this.store.all<Plan>("plan").flatMap(p => p.sources), ...this.store.all<Destination>("destination").filter(d => d.kind === "local").map(d => d.location)];
    if (protectedPaths.some(p => containsPath(p, target) || containsPath(target, p)))
      throw new Error("Choose a restore folder separate from sources, repositories and Sentry's application data.");
  }
  private copyNeedsSnapshot(destinationId: string, snapshotId?: string): boolean {
    const rows = this.store.db.prepare("SELECT data FROM jobs WHERE status IN ('queued','running','failed','interrupted','partial')").all();
    return rows.some(row => {
      const job = JSON.parse(String(row.data)) as Job;
      if (job.kind !== "copy") return false;
      const payload = this.store.get<JobPayload>("payload", job.id);
      if (payload?.sourceDestinationId !== destinationId || payload.copyResolved) return false;
      const id = payload.snapshotId ?? (payload.sourceJobId ? this.store.getJob(payload.sourceJobId).snapshotId : undefined);
      return !snapshotId || id === snapshotId;
    });
  }
  private enqueuePlan(
    plan: Plan,
    trigger: string,
    options: { name?: string; pin?: boolean; destinationId?: string; checkpointDays?: number } = {},
  ): string[] {
    const ids: string[] = [];
    if (plan.replicateFrom && (!options.destinationId || options.destinationId !== plan.replicateFrom)) {
      // The cloud jobs depend on this particular capture, never on a later scan.
      if (this.store.queued().some(j => j.planId === plan.id && (j.kind === "backup" || j.kind === "copy")) || this.active?.job.planId === plan.id) return [];
      const source = this.destination(plan.replicateFrom);
      const capture = this.newJob("backup", source, trigger, plan);
      capture.name = options.name;
      capture.pin = options.pin;
      capture.checkpointUntil = options.checkpointDays ? new Date(Date.now() + options.checkpointDays * 86400_000).toISOString() : undefined;
      this.store.enqueue(capture, { plan, attempt: 0 });
      ids.push(capture.id);
      for (const id of plan.destinationIds.filter(id => id !== source.id && (!options.destinationId || id === options.destinationId))) {
        const copy = this.newJob("copy", this.destination(id), trigger, plan);
        copy.sourceDestinationId = source.id;
        copy.name = options.name;
        this.store.enqueue(copy, { plan, sourceDestinationId: source.id, sourceJobId: capture.id, attempt: 0 });
        ids.push(copy.id);
      }
      this.emit();
      return ids;
    }
    for (const id of [...plan.destinationIds].sort((a, b) =>
      trigger === "weather"
        ? Number(this.destination(b).kind === "gdrive") -
          Number(this.destination(a).kind === "gdrive")
        : 0,
    )) {
      if (options.destinationId && options.destinationId !== id) continue;
      if (
        this.store
          .queued()
          .some((j) => j.planId === plan.id && j.destinationId === id) ||
        (this.active?.job.planId === plan.id &&
          this.active.job.destinationId === id)
      )
        continue;
      const d = this.destination(id);
      const job = this.newJob("backup", d, trigger, plan);
      job.name = options.name;
      job.pin = options.pin;
      job.checkpointUntil = options.checkpointDays ? new Date(Date.now() + options.checkpointDays * 86400_000).toISOString() : undefined;
      this.store.enqueue(job, { plan, attempt: 0 } satisfies JobPayload);
      ids.push(job.id);
    }
    this.emit();
    return ids;
  }
  private newJob(
    kind: Job["kind"],
    d: Destination,
    trigger: string,
    p?: Plan,
  ): Job {
    return {
      id: randomUUID(),
      planId: p?.id,
      planName: p?.name ?? "Repository",
      destinationId: d.id,
      destinationName: d.name,
      kind,
      trigger,
      status: "queued",
      phase: "Queued",
      createdAt: now(),
      bytes: 0,
      transferred: 0,
      added: 0,
      changed: 0,
      deleted: 0,
      skipped: 0,
    };
  }
  private enqueueOperation(
    kind: Job["kind"],
    d: Destination,
    request: Request,
    p?: Plan,
  ): string {
    const job = this.newJob(kind, d, "manual", p);
    this.store.enqueue(job, { request, plan: p });
    this.emit();
    void this.pump();
    return job.id;
  }
  private async refreshSnapshots(
    d: Destination,
    repo: Repository,
  ): Promise<Snapshot[]> {
    const snapshots = (
      await this.engine.snapshots(repo, this.credentialsAbort.signal)
    ).map((s) => {
      const tags = s.tags ?? [];
      const tag = (prefix: string) =>
        tags.find((t) => t.startsWith(prefix))?.slice(prefix.length);
      const decode = (v: string | undefined) =>
        v ? Buffer.from(v, "base64url").toString("utf8") : undefined;
      const planId = tag("sentry:plan:") ?? "imported";
      return {
        id: s.id,
        destinationId: d.id,
        planId,
        planName:
          this.store.get<Plan>("plan", planId)?.name ??
          decode(tag("sentry:plan-name:")) ??
          "Recovered snapshot",
        time: s.time,
        paths: this.engine.mappings(s).length ? this.engine.mappings(s).map(m => m.original) : s.paths,
        name: decode(tag("sentry:name:")),
        pinned: tags.includes("sentry:pinned"),
        incomplete: tags.includes("sentry:incomplete"),
        files: number(s.summary?.total_files_processed),
        bytes: number(s.summary?.total_bytes_processed),
        checkpointUntil: tag("sentry:checkpoint:"),
        capture: tag("sentry:capture:"),
      } satisfies Snapshot;
    });
    snapshots.sort((a, b) => b.time.localeCompare(a.time));
    this.store.setSnapshots(d.id, snapshots);
    return snapshots;
  }
  private async index(d: Destination, snapshotId: string) {
    if (this.store.hasIndex(d.id, snapshotId)) return;
    this.store.resetIndex(d.id, snapshotId);
    let batch: FileEntry[] = [];
    const repo = await this.repo(d);
    const snapshot = (await this.engine.snapshots(repo, this.credentialsAbort.signal)).find(s => s.id === snapshotId);
    if (!snapshot) throw new Error("Snapshot could not be found.");
    const mappings = this.engine.mappings(snapshot);
    await this.engine.list(repo, snapshotId, (event) => {
      const mapped = mappings.find(m => m.captured === String(event.path));
      if (mappings.length && !mapped) return;
      batch.push({
        path: mapped?.original ?? String(event.path),
        type: String(event.type),
        size: number(event.size),
        mtime: typeof event.mtime === "string" ? event.mtime : undefined,
      });
      if (batch.length >= 200) {
        this.store.addFiles(d.id, snapshotId, batch);
        batch = [];
      }
    }, this.credentialsAbort.signal);
    if (batch.length) this.store.addFiles(d.id, snapshotId, batch);
    this.store.finishIndex(d.id, snapshotId);
  }
  private blocked(job: Job): string | undefined {
    if (this.settings.paused) return "Protection is paused.";
    const payload = this.store.get<JobPayload>("payload", job.id);
    if (job.kind === "copy" && payload?.sourceJobId) {
      const source = this.store.getJob(payload.sourceJobId);
      if (["queued", "running"].includes(source.status)) return "Waiting for the local snapshot.";
    }
    if (job.trigger === "manual") return undefined;
    if (this.settings.pauseOnBattery && this.power.battery)
      return "Waiting for AC power.";
    if (this.settings.idleOnly && this.power.idleSeconds < 300)
      return "Waiting until this PC has been idle for five minutes.";
    if (
      this.destination(job.destinationId).kind === "gdrive" &&
      !this.settings.allowMetered &&
      this.power.metered !== false
    )
      return this.power.metered
        ? "Waiting for an unmetered connection."
        : "Network cost is unknown. Allow metered connections or run this plan manually.";
  }
  private async pump() {
    if (this.running || this.closed || this.reserved) return;
    this.running = true;
    try {
      while (!this.closed && !this.reserved) {
        const jobs = this.store.queued();
        const job = jobs.find(
          (j) =>
            !this.blocked(j) &&
            (this.store.get<JobPayload>("payload", j.id)?.notBefore ?? 0) <=
              Date.now(),
        );
        this.policyMessage = job
          ? undefined
          : jobs[0]
            ? this.blocked(jobs[0])
            : undefined;
        if (!job) break;
        const abort = new AbortController();
        this.active = { job, abort };
        job.status = "running";
        job.startedAt = now();
        job.phase =
          job.kind === "backup"
            ? "Scanning"
            : job.kind === "restore"
              ? "Restoring"
              : job.kind === "prune"
                ? "Pruning"
                : "Verifying";
        this.store.job(job);
        this.emit();
        const payload = this.store.get<JobPayload>("payload", job.id) ?? {};
        try {
          await this.execute(job, payload, abort.signal);
          if (job.status === "running") job.status = "success";
        } catch (error) {
          job.status = abort.signal.aborted ? "cancelled" : "failed";
          job.error = this.redact(
            error instanceof Error ? error.message : "Operation failed.",
          );
          const d = this.destination(job.destinationId);
          d.status = "attention";
          d.error = job.error;
          this.store.put("destination", d.id, d);
          if (job.kind === "backup" && job.planId) {
            const p = this.plan(job.planId);
            p.pruningSuspended = true;
            this.store.put("plan", p.id, p);
          }
        }
        job.finishedAt = now();
        job.phase =
          String(job.status) === "success"
            ? "Complete"
            : String(job.status) === "partial"
              ? "Needs attention"
              : job.status;
        this.store.job(job);
        if ((job.kind === "backup" || job.kind === "copy") && job.planId) {
          const key = job.planId + ":" + job.destinationId;
          const protection: Protection = this.store.get<Protection>(
            "protection",
            key,
          ) ?? { planId: job.planId, destinationId: job.destinationId };
          protection.lastAttempt = job.finishedAt;
          protection.status = job.status;
          protection.error = job.error;
          if (String(job.status) === "success")
            protection.lastSuccess = this.store.snapshots(job.destinationId).find(s => s.id === job.snapshotId)?.time ?? job.finishedAt;
          this.store.put("protection", key, protection);
        }
        this.active = undefined;
        this.emit();
        if (
          String(job.status) === "success" &&
          (job.kind === "backup" || job.kind === "copy") &&
          job.planId
        ) {
          const p = this.plan(job.planId);
          const key = p.id + ":" + job.destinationId;
          const last = this.store.get<string>("retention", key);
          if (
            !p.pruningSuspended &&
            (!last || Date.now() - Date.parse(last) > 86400_000)
          ) {
            const maintenance = this.newJob(
              "prune",
              this.destination(job.destinationId),
              "retention",
              p,
            );
            this.store.enqueue(maintenance, {
              plan: p,
              request: {
                type: "retention",
                planId: p.id,
                destinationId: job.destinationId,
                preview: false,
              },
            });
            this.store.put("retention", key, now());
          }
        }
        // Bounded automatic retries are destination-specific. Successful destinations never repeat.
        if (
          job.status === "failed" &&
          job.trigger !== "manual" &&
          (job.kind === "backup" || job.kind === "copy") &&
          (payload.attempt ?? 0) < 2
        ) {
          const retry = {
            ...job,
            id: randomUUID(),
            status: "queued" as const,
            phase: "Waiting to retry",
            createdAt: now(),
            startedAt: undefined,
            finishedAt: undefined,
            retryOf: job.id,
            error: undefined,
          };
          this.store.enqueue(retry, {
            ...payload,
            attempt: (payload.attempt ?? 0) + 1,
            notBefore: Date.now() + 60_000 * 2 ** (payload.attempt ?? 0),
          });
        }
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }
  private async execute(job: Job, payload: JobPayload, signal: AbortSignal) {
    const d = this.destination(job.destinationId);
    const repo = await this.repo(d);
    const request = payload.request;
    await this.engine.unlockStale(repo);
    const progress = (event: EngineEvent) => {
      if (event.message_type === "status") {
        const total = number(event.total_bytes);
        job.bytes = number(event.bytes_done);
        job.progress = total ? Math.min(1, job.bytes / total) : undefined;
        job.phase = d.kind === "gdrive" ? "Transferring" : "Backing up";
        this.emit();
      }
    };
    if (job.kind === "backup") {
      const p = payload.plan;
      if (!p) throw new Error("Backup plan details are unavailable.");
      if (d.kind === "local") {
        const fs = await statfs(d.location);
        d.freeBytes = fs.bavail * fs.bsize;
        if (d.freeBytes < 32 * 1024 * 1024)
          throw new Error(
            "Destination has less than 32 MB free. Free space before retrying.",
          );
      }
      const previous = this.store
        .snapshots(d.id)
        .filter((s) => s.planId === p.id && !s.incomplete)
        .sort((a, b) => b.time.localeCompare(a.time))[0];
      const captured = p.capture === "sqlite" ? await captureDatabases(p, this.options.data, signal) : undefined;
      let result;
      try { result = await this.engine.backup(
        repo,
        {
          sources: captured?.sources ?? p.sources,
          includes: p.includes,
          excludes: p.excludes,
          planId: p.id,
          planName: p.name,
          name: job.name,
          pin: job.pin,
          checkpointUntil: job.checkpointUntil,
          vss: p.capture === "vss",
          capture: p.capture ?? "files",
          sourceMap: captured?.mappings,
        },
        progress,
        signal,
      ); } finally { await captured?.cleanup(); }
      job.bytes = number(result.summary.total_bytes_processed);
      job.transferred = number(
        result.summary.data_added_packed ?? result.summary.data_added,
      );
      job.added = number(result.summary.files_new);
      job.changed = number(result.summary.files_changed);
      job.skipped = result.warnings.length;
      const snapshots = await this.refreshSnapshots(d, repo);
      const latest = snapshots
        .filter((s) => s.planId === p.id)
        .sort((a, b) => b.time.localeCompare(a.time))[0];
      job.snapshotId = latest?.id;
      if (previous && latest) {
        await this.index(d, previous.id);
        await this.index(d, latest.id);
        const deleted = this.store.db
          .prepare(
            "SELECT COUNT(*) n FROM files a WHERE a.destination=? AND a.snapshot=? AND a.type='file' AND NOT EXISTS(SELECT 1 FROM files b WHERE b.destination=a.destination AND b.snapshot=? AND b.path=a.path)",
          )
          .get(d.id, previous.id, latest.id);
        job.deleted = Number(deleted?.n ?? 0);
        const previousFiles = Number(
          this.store.db
            .prepare(
              "SELECT COUNT(*) n FROM files WHERE destination=? AND snapshot=? AND type='file'",
            )
            .get(d.id, previous.id)?.n ?? 0,
        );
        if (
          previousFiles >= 10 &&
          (job.deleted + job.changed) / previousFiles >= 0.4
        ) {
          const current = this.plan(p.id);
          current.pruningSuspended = true;
          this.store.put("plan", p.id, current);
          job.error =
            "A large portion of this plan changed or disappeared. Pruning is suspended; review this snapshot.";
        }
      }
      if (result.code !== 0 || result.warnings.length) {
        job.status = "partial";
        job.error =
          result.warnings.slice(0, 5).join("\n") ||
          "Some source files could not be read. This snapshot is incomplete.";
        const current = this.plan(p.id);
        current.pruningSuspended = true;
        this.store.put("plan", p.id, current);
        d.status = "attention";
        d.error = job.error;
      } else {
        job.phase = "Verifying";
        this.emit();
        await this.engine.check(repo, false, signal);
        d.lastSuccess = now();
        d.lastVerified = now();
        d.verification = "Repository structure verified";
        d.status = job.error ? "attention" : "ready";
        d.error = job.error;
        job.progress = 1;
      }
    } else if (job.kind === "copy") {
      const source = this.destination(payload.sourceDestinationId ?? "");
      const sourceJob = payload.sourceJobId ? this.store.getJob(payload.sourceJobId) : undefined;
      const snapshotId = payload.snapshotId ?? sourceJob?.snapshotId;
      if (sourceJob && sourceJob.status !== "success") throw new Error("The local capture did not complete. Retry the local capture or start this plan again; no cloud protection was recorded.");
      if (!snapshotId) throw new Error("The source snapshot is unavailable.");
      job.phase = "Copying captured snapshot";
      this.emit();
      job.snapshotId = await this.engine.copy(await this.repo(source), repo, snapshotId, signal);
      const copies = await this.refreshSnapshots(d, repo);
      const copy = copies.find(s => s.id === job.snapshotId);
      job.bytes = copy?.bytes ?? 0;
      d.lastSuccess = copy?.time;
      d.lastVerified = now();
      d.verification = "Copied snapshot committed; repository structure verified";
      d.status = "ready";
      d.error = undefined;
      let previous = job.retryOf;
      while (previous) {
        const old = this.store.get<JobPayload>("payload", previous);
        if (old) this.store.put("payload", previous, { ...old, copyResolved: true });
        previous = this.store.getJob(previous).retryOf;
      }
      job.progress = 1;
    } else if (request?.type === "restore") {
      this.validateRestoreTarget(request.target);
      const result = await this.engine.restore(
        repo,
        {
          snapshotId: request.snapshotId,
          target: request.target,
          paths: request.paths,
          overwrite: request.overwrite,
        },
        progress,
        signal,
      );
      job.bytes = number(result.summary.bytes_restored);
      job.snapshotId = request.snapshotId;
      job.progress = 1;
      if (result.code !== 0) {
        job.status = "partial";
        job.skipped = number(result.summary.files_skipped);
        job.error = result.warnings.join("\n");
      }
    } else if (request?.type === "check") {
      await this.engine.check(repo, request.full, signal);
      d.lastVerified = now();
      d.verification = request.full
        ? "All stored data verified"
        : "Repository structure verified";
      d.status = "ready";
      d.error = undefined;
    } else if (request?.type === "retention") {
      const p = this.plan(request.planId);
      if (this.copyNeedsSnapshot(d.id)) throw new Error("Pruning is deferred while snapshots from this repository still need to be copied. Retry or cancel the pending copy first.");
      if (p.pruningSuspended)
        throw new Error(
          "Pruning is suspended. Review this plan before continuing.",
        );
      await this.engine.retain(
        repo,
        { planId: p.id, ...p.retention, dryRun: false },
        signal,
      );
      await this.refreshSnapshots(d, repo);
    } else if (request?.type === "test-recovery") {
      await this.index(d, request.snapshotId);
      const snapshot = this.store.snapshots(d.id).find(s => s.id === request.snapshotId);
      const key = (snapshot?.planId ?? "imported") + ":" + d.id;
      const total = Number(this.store.db.prepare("SELECT COUNT(*) n FROM files WHERE destination=? AND snapshot=? AND type='file'").get(d.id, request.snapshotId)!.n);
      const eligible = Number(this.store.db.prepare("SELECT COUNT(*) n FROM files WHERE destination=? AND snapshot=? AND type='file' AND size<=134217728").get(d.id, request.snapshotId)!.n);
      if (!eligible) throw new Error("No ordinary files under the 128 MiB per-file drill limit are available. Use full data verification for this repository.");
      const cursor = this.store.get<number>("drill-cursor", key) ?? 0;
      const samples: Array<{ path: string; size: number }> = [];
      let budget = 256 * 1024 * 1024;
      for (let i = 0; i < Math.min(12, eligible); i++) {
        const row = this.store.db.prepare("SELECT path,size FROM files WHERE destination=? AND snapshot=? AND type='file' AND size<=134217728 ORDER BY size,path LIMIT 1 OFFSET ?").get(d.id, request.snapshotId, (cursor + Math.floor(i * eligible / Math.min(12, eligible))) % eligible)!;
        if (Number(row.size) <= budget) { samples.push({ path: String(row.path), size: Number(row.size) }); budget -= Number(row.size); }
      }
      const target = join(this.options.data, "test-recovery", job.id);
      const sampleRoot = join(this.options.data, "test-recovery");
      if (!containsPath(sampleRoot, target) || target === sampleRoot) throw new Error("Unsafe recovery sample cleanup path.");
      try { const recovered = await this.engine.restore(
        repo,
        {
          snapshotId: request.snapshotId,
          target,
          paths: samples.map(s => s.path),
          overwrite: "never",
        },
        undefined,
        signal,
      );
      if (recovered.code !== 0)
        throw new Error(
          recovered.warnings.join("\n") ||
            "The recovery sample could not be fully verified.",
        );
      d.lastVerified = now();
      d.verification = `${samples.length} of ${total} files restored and verified`;
      job.recoveredFiles = samples.length;
      job.recoveryBytes = samples.reduce((sum, s) => sum + s.size, 0);
      job.snapshotId = request.snapshotId;
      this.store.put("drill", key, { planId: snapshot?.planId ?? "imported", destinationId: d.id, checkedAt: now(), snapshotId: request.snapshotId, files: samples.length, bytes: job.recoveryBytes, totalFiles: total } satisfies RecoveryDrill);
      this.store.put("drill-cursor", key, (cursor + 1) % eligible);
      } finally {
      await rm(target, { recursive: true, force: true });
      }
    } else throw new Error("Operation details are missing.");
    this.store.put("destination", d.id, d);
  }
  async weatherCheck(simulate: boolean) {
    if (simulate) {
      this.weather = {
        ...this.weather,
        simulation: simulateWeather(this.settings.weather).message,
      };
      this.emit();
      return this.weather;
    }
    if (this.weatherRunning) return this.weather;
    this.weatherRunning = true;
    try {
      const ledger = this.store.get<WeatherLedger>("weather", "ledger") ?? {
        seen: {},
      };
      const result = await checkWeather(this.settings.weather, ledger, {
        previousStatus: this.weather,
        signal: this.credentialsAbort.signal,
      });
      if (this.closed) return this.weather;
      this.weather = result.status;
      this.store.db.exec("BEGIN");
      try {
        let queued = 0;
        if (!this.settings.paused && result.eligible.length) {
          const plans = this.store
            .all<Plan>("plan")
            .filter(
              (p) => p.enabled && this.settings.weather.planIds.includes(p.id),
            )
            .sort((a, b) => b.priority - a.priority);
          for (const plan of plans)
            queued += this.enqueuePlan(plan, "weather").length;
        }
        this.store.put(
          "weather",
          "ledger",
          queued
            ? acknowledgeWeather(result.ledger, result.eligible)
            : result.ledger,
        );
        this.store.put("weather", "status", this.weather);
        this.store.db.exec("COMMIT");
      } catch (e) {
        this.store.db.exec("ROLLBACK");
        throw e;
      }
      this.emit();
      void this.pump();
      return this.weather;
    } finally {
      this.weatherRunning = false;
    }
  }
  setPolicy(policy: {
    battery: boolean;
    idleSeconds: number;
    metered?: boolean;
  }) {
    this.power = policy;
    void this.pump();
  }
  async tick() {
    if (this.closed) return;
    clearTimeout(this.timer);
    const time = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const previousZone = this.store.get<string>("settings", "zone");
    this.store.db.exec("BEGIN");
    try {
      for (const plan of this.store.all<Plan>("plan")) {
        if (!plan.enabled) continue;
        let due = this.store.get<string | null>("due", plan.id);
        if (due === undefined)
          due = nextRun(plan.schedule, time)?.toISOString() ?? null;
        if (previousZone && zone !== previousZone)
          due = reconcileTimeZone(plan.schedule, due, time);
        if (isDue(plan.schedule, due, time) && !this.settings.paused) {
          this.enqueuePlan(plan, "schedule");
          due = nextRun(plan.schedule, time)?.toISOString() ?? null;
        }
        this.store.put("due", plan.id, due);
      }
      this.store.put("settings", "zone", zone);
      for (const plan of this.store.all<Plan>("plan")) {
        if (!plan.enabled || !plan.recoveryDrillDays || this.settings.paused) continue;
        for (const id of plan.destinationIds) {
          const key = plan.id + ":" + id;
          const last = this.store.get<RecoveryDrill>("drill", key);
          const attempt = this.store.get<string>("drill-attempt", key);
          if (last && Date.now() - Date.parse(last.checkedAt) < plan.recoveryDrillDays * 86400_000) continue;
          if (attempt && Date.now() - Date.parse(attempt) < 86400_000) continue;
          if (this.store.queued().some(j => j.kind === "test-recovery" && j.destinationId === id) || this.active?.job.destinationId === id) continue;
          const snapshot = this.store.snapshots(id).find(s => s.planId === plan.id && !s.incomplete);
          if (!snapshot) continue;
          const job = this.newJob("test-recovery", this.destination(id), "recovery drill", plan);
          this.store.enqueue(job, { request: { type: "test-recovery", destinationId: id, snapshotId: snapshot.id } });
          this.store.put("drill-attempt", key, now());
        }
      }
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    if (
      this.settings.weather.enabled &&
      (!this.weather.lastCheck ||
        Date.now() - Date.parse(this.weather.lastCheck) >= 15 * 60_000)
    )
      void this.weatherCheck(false);
    void this.checkConnections();
    void this.pump();
    this.timer = setTimeout(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  async checkConnections() {
    if (this.closed || this.connectionScan || this.running || this.reserved || this.settings.paused) return;
    this.connectionScan = true;
    this.reserved = true;
    try {
      const plans = this.store.all<Plan>("plan").filter(p => p.enabled && p.backupOnConnect);
      const ids = new Set(plans.flatMap(p => p.destinationIds));
      for (const id of ids) {
        const d = this.destination(id);
        if (d.kind !== "local") continue;
        let present = false;
        try { present = (await stat(join(d.location, "config"))).isFile(); } catch { /* disconnected */ }
        const wasPresent = this.store.get<boolean>("connected", id) ?? false;
        if (!present) {
          const volume = this.store.get<VolumeIdentity>("volume", id);
          if (volume) {
            const relocated = await relocateVolume(d.location, volume.volumeId);
            if (relocated) { d.location = relocated; try { present = (await stat(join(d.location, "config"))).isFile(); } catch { /* unavailable */ } }
          }
        }
        if (present && !wasPresent) {
          try { await this.repo(d); } catch { present = false; }
          if (present) for (const p of plans.filter(p => p.destinationIds.includes(id))) {
            const copy = this.store.get<Protection>("protection", p.id + ":" + id);
            const due = this.store.get<string | null>("due", p.id);
            if (!copy?.lastSuccess || (due && Date.parse(due) <= Date.now()) || Date.now() - Date.parse(copy.lastSuccess) >= (p.schedule.kind === "interval" ? p.schedule.minutes * 60_000 : 86400_000))
              this.enqueuePlan(p, "drive connected", { destinationId: id });
          }
        }
        this.store.put("connected", id, present);
      }
    } finally { this.connectionScan = false; this.reserved = false; this.emit(); void this.pump(); }
  }
  private redact(text: string) {
    let result = text;
    for (const value of Object.values(this.secrets))
      if (value) result = result.split(value).join("[credential]");
    return result.slice(0, 4000);
  }
  private diagnostics() {
    const state = this.state();
    return JSON.stringify(
      {
        version: "0.1.0",
        platform: process.platform,
        arch: process.arch,
        engine: state.engineVersion,
        plans: state.plans.map((p) => ({
          id: p.id,
          sourceCount: p.sources.length,
          destinationCount: p.destinationIds.length,
          enabled: p.enabled,
          schedule: p.schedule,
          pruningSuspended: p.pruningSuspended,
        })),
        destinations: state.destinations.map((d) => ({
          id: d.id,
          kind: d.kind,
          status: d.status,
          lastSuccess: d.lastSuccess,
          lastVerified: d.lastVerified,
        })),
        jobs: state.jobs.map((j) => ({
          id: j.id,
          kind: j.kind,
          trigger: j.trigger,
          status: j.status,
          createdAt: j.createdAt,
          finishedAt: j.finishedAt,
          bytes: j.bytes,
          transferred: j.transferred,
          added: j.added,
          changed: j.changed,
          deleted: j.deleted,
          skipped: j.skipped,
        })),
        weather: {
          lastCheck: state.weather.lastCheck,
          lastSuccess: state.weather.lastSuccess,
        },
        note: "Paths, account details, tokens, passwords, file contents and raw engine errors are excluded.",
      },
      null,
      2,
    );
  }
  private async importLegacy(path: string) {
    if ((await stat(path)).size > 5 * 1024 * 1024)
      throw new Error("Legacy settings exceed the 5 MB import limit.");
    const data: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!data || typeof data !== "object")
      throw new Error("Choose Sentry-Old app_state.json.");
    const sets = (data as { backup_sets?: { sets?: unknown } }).backup_sets
      ?.sets;
    if (!Array.isArray(sets) || sets.length > 1000)
      throw new Error("This is not a compatible Sentry-Old settings file.");
    const destinations = this.store.all<Destination>("destination");
    if (!destinations.length)
      throw new Error(
        "Connect a new encrypted destination before importing old plans.",
      );
    let imported = 0;
    const warnings = [
      "Imported plans are disabled and manual. Review sources, exclusions and destinations before enabling. Legacy ZIP backups are unchanged and must be recovered separately.",
    ];
    for (const value of sets) {
      if (!value || typeof value !== "object") continue;
      const old = value as Record<string, unknown>;
      const sources =
        Array.isArray(old.sources) && old.sources.length
          ? old.sources
          : old.paths;
      const parsed = planSchema.safeParse({
        id: randomUUID(),
        name: old.name,
        sources,
        destinationIds: [destinations[0].id],
        enabled: false,
        includes: [],
        excludes: Array.isArray(old.exclude_patterns)
          ? old.exclude_patterns
          : [],
        schedule: { kind: "manual" },
        retention: { daily: 30, weekly: 8, monthly: 12 },
        priority: 5,
        pruningSuspended: true,
      });
      if (!parsed.success) {
        warnings.push("One invalid legacy plan was skipped.");
        continue;
      }
      this.store.put("plan", parsed.data.id, parsed.data);
      imported++;
    }
    this.emit();
    return { imported, warnings };
  }
  async prepareUpdate(): Promise<void> {
    // Drain already accepted mutations before deciding whether restart is safe.
    await this.requests.catch(() => {});
    const state = this.state();
    if (state.busy || this.store.queued().length > 0)
      throw new Error("Wait for backup work to finish before restarting to update.");
    await this.close();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.emitting);
    this.credentialsAbort.abort();
    this.active?.abort.abort();
    this.closing = (async () => {
      await this.requests.catch(() => {});
      while (this.running || this.connectionScan)
        await new Promise((resolve) => setTimeout(resolve, 25));
      this.store.close();
    })();
    return this.closing;
  }
}
