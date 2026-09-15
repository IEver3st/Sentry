import type { DiagnosticsSnapshot } from "./diagnostics";
export type { DiagnosticsSnapshot, DiagnosticEvent } from "./diagnostics";
import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const path = z
  .string()
  .min(1)
  .max(32760)
  .refine(
    (s) => !s.includes("\0") && !s.includes("\n") && !s.includes("\r"),
    "Invalid path",
  );
export const scheduleSchema = z.object({
  kind: z.enum(["manual", "interval", "daily", "weekly", "monthly"]),
  minutes: z.number().int().min(15).max(525600).default(60),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("18:00"),
  weekday: z.number().int().min(0).max(6).default(0),
  day: z.number().int().min(1).max(31).default(1),
});
export const planSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  sources: z.array(path).min(1).max(64),
  destinationIds: z.array(id).min(1).max(16),
  enabled: z.boolean(),
  includes: z.array(z.string().max(500)).max(100),
  excludes: z.array(z.string().max(500)).max(100),
  schedule: scheduleSchema,
  retention: z.object({
    daily: z.number().int().min(1).max(3650),
    weekly: z.number().int().min(0).max(520),
    monthly: z.number().int().min(0).max(120),
  }),
  priority: z.number().int().min(0).max(10).default(5),
  pruningSuspended: z.boolean().default(false),
  capture: z.enum(["files", "vss", "sqlite"]).optional(),
  replicateFrom: id.optional(),
  backupOnConnect: z.boolean().optional(),
  recoveryDrillDays: z.number().int().min(0).max(90).optional(),
});
export type Plan = z.infer<typeof planSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export interface Destination {
  id: string;
  name: string;
  kind: "local" | "gdrive";
  location: string;
  repositoryId: string;
  lastSuccess?: string;
  lastVerified?: string;
  verification?: string;
  status: "ready" | "unavailable" | "attention";
  error?: string;
  accountId?: string;
  freeBytes?: number;
}
export const weatherSchema = z.object({
  enabled: z.boolean(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationName: z.string().max(120),
  events: z.array(z.string().max(100)).max(30),
  severities: z.array(
    z.enum(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]),
  ),
  planIds: z.array(id).max(100),
  cooldownMinutes: z.number().int().min(15).max(10080),
});
export const overviewSchema = z.object({
  days: z.union([z.literal(7), z.literal(30)]),
  widgets: z.array(z.enum(["activity", "outcomes", "data", "ledger", "recent"])).max(5)
    .refine((items) => new Set(items).size === items.length, "Choose each section once"),
});
export type OverviewPreferences = z.infer<typeof overviewSchema>;
export const defaultOverview: OverviewPreferences = {
  days: 7,
  widgets: ["activity", "outcomes", "ledger", "recent"],
};
export const settingsSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  uiScale: z.number().int().min(80).max(200).default(100),
  startAtLogin: z.boolean(),
  pauseOnBattery: z.boolean(),
  idleOnly: z.boolean(),
  allowMetered: z.boolean(),
  bandwidthKiB: z.number().int().min(0).max(1048576),
  paused: z.boolean(),
  weather: weatherSchema,
  discoveryRoots: z.array(path).max(16).optional(),
  overview: overviewSchema.optional(),
  onboardingDismissed: z.boolean().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  theme: "dark",
  uiScale: 100,
  startAtLogin: false,
  pauseOnBattery: true,
  idleOnly: false,
  allowMetered: false,
  bandwidthKiB: 0,
  paused: false,
  weather: {
    enabled: false,
    latitude: 32.78,
    longitude: -96.8,
    locationName: "",
    events: [
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Flash Flood Warning",
    ],
    severities: ["Extreme", "Severe"],
    planIds: [],
    cooldownMinutes: 180,
  },
};
export interface Job {
  id: string;
  planId?: string;
  planName: string;
  destinationId: string;
  destinationName: string;
  kind: "backup" | "restore" | "check" | "prune" | "test-recovery" | "copy";
  trigger: string;
  status:
    | "queued"
    | "running"
    | "success"
    | "partial"
    | "failed"
    | "cancelled"
    | "interrupted";
  phase: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  progress?: number;
  bytes: number;
  transferred: number;
  added: number;
  changed: number;
  deleted: number;
  skipped: number;
  snapshotId?: string;
  name?: string;
  pin?: boolean;
  retryOf?: string;
  checkpointUntil?: string;
  recoveredFiles?: number;
  recoveryBytes?: number;
  sourceDestinationId?: string;
}
export interface Snapshot {
  id: string;
  destinationId: string;
  planId: string;
  planName: string;
  time: string;
  paths: string[];
  name?: string;
  pinned: boolean;
  incomplete: boolean;
  files?: number;
  bytes?: number;
  checkpointUntil?: string;
  capture?: string;
}
export interface FileEntry {
  path: string;
  type: string;
  size: number;
  mtime?: string;
  contentId?: string;
}
export interface FileVersion { snapshot: Snapshot; file?: FileEntry }
export interface SnapshotChange { path: string; change: "added" | "changed" | "deleted"; before?: FileEntry; after?: FileEntry }
export interface FilePreview { kind: "text" | "image" | "unavailable"; content: string; reason?: string }
export interface ProtectionGap { id: string; title: string; detail: string; path?: string; planId?: string; severity: "attention" | "info" }
export interface GapScan { checkedAt: string; gaps: ProtectionGap[]; truncated: boolean }
export interface RecoveryDrill { planId: string; destinationId: string; checkedAt: string; snapshotId: string; files: number; bytes: number; totalFiles: number }
export interface BackgroundStatus { mode: "desktop" | "service"; installed: boolean; detail: string }
export interface Preview {
  included: number;
  excluded: number;
  bytes: number;
  entries: Array<{
    path: string;
    included: boolean;
    reason?: string;
    size: number;
  }>;
  warnings: string[];
  truncated: boolean;
}
export interface WeatherStatus {
  lastCheck?: string;
  lastSuccess?: string;
  error?: string;
  alerts: number;
  simulation?: string;
}
export interface Protection {
  planId: string;
  destinationId: string;
  lastSuccess?: string;
  lastAttempt?: string;
  status?: Job["status"];
  error?: string;
}
export interface State {
  plans: Plan[];
  destinations: Destination[];
  jobs: Job[];
  protection: Protection[];
  settings: Settings;
  weather: WeatherStatus;
  engineVersion: string;
  busy: boolean;
  googleConfigured: boolean;
  googleConnected: boolean;
  update: UpdateState;
  policy?: string;
  recoveryDrills?: RecoveryDrill[];
  gaps?: GapScan;
  historyPath?: string;
  background?: BackgroundStatus;
}
export interface UpdateState {
  status: "idle" | "unavailable" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "error";
  version?: string;
  progress?: number;
  message?: string;
}
export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }),
  z.object({ type: z.literal("save-plan"), plan: planSchema }),
  z.object({ type: z.literal("delete-plan"), id }),
  z.object({
    type: z.literal("preview"),
    sources: z.array(path).min(1).max(64),
    includes: z.array(z.string().max(500)).max(100),
    excludes: z.array(z.string().max(500)).max(100),
    destinationIds: z.array(id).max(16),
  }),
  z
    .object({
      type: z.literal("add-destination"),
      id,
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["local", "gdrive"]),
      location: path,
      password: z.string().min(1).max(1024),
      existing: z.boolean(),
    })
    .refine((v) => v.existing || v.password.length >= 8, {
      message: "Use at least eight characters for a new recovery password.",
      path: ["password"],
    }),
  z.object({
    type: z.literal("reconnect-destination"),
    id,
    location: path,
    password: z.string().min(1).max(1024).optional(),
  }),
  z.object({ type: z.literal("delete-destination"), id }),
  z.object({
    type: z.literal("run"),
    planId: id.optional(),
    name: z.string().max(120).optional(),
    pin: z.boolean().optional(),
    destinationId: id.optional(),
    checkpointDays: z.number().int().min(1).max(365).optional(),
  }),
  z.object({ type: z.literal("cancel"), id }),
  z.object({ type: z.literal("file-history"), destinationId: id, path, offset: z.number().int().min(0), limit: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal("file-preview"), destinationId: id, snapshotId: id, path }),
  z.object({ type: z.literal("snapshot-diff"), destinationId: id, before: id, after: id, offset: z.number().int().min(0), limit: z.number().int().min(1).max(200) }),
  z.object({ type: z.literal("copy-snapshot"), sourceDestinationId: id, destinationId: id, snapshotId: id }),
  z.object({ type: z.literal("scan-gaps") }),
  z.object({ type: z.literal("recovery-kit") }),
  z.object({ type: z.literal("practice-recovery"), destinationId: id, password: z.string().min(1).max(1024), target: path }),
  z.object({ type: z.literal("explorer-integration"), enabled: z.boolean() }),
  z.object({ type: z.literal("background-service"), action: z.enum(["status", "export-setup"]) }),
  z.object({ type: z.literal("retry"), id }),
  z.object({
    type: z.literal("snapshots"),
    destinationId: id,
    planId: id.optional(),
  }),
  z.object({
    type: z.literal("files"),
    destinationId: id,
    snapshotId: id,
    search: z.string().max(500),
    offset: z.number().int().min(0).max(100000000),
    limit: z.number().int().min(1).max(500),
  }),
  z.object({
    type: z.literal("restore"),
    destinationId: id,
    snapshotId: id,
    target: path,
    paths: z.array(path).max(1000),
    overwrite: z.enum(["never", "always"]),
  }),
  z.object({
    type: z.literal("pin"),
    destinationId: id,
    snapshotId: id,
    pinned: z.boolean(),
  }),
  z.object({ type: z.literal("check"), destinationId: id, full: z.boolean() }),
  z.object({
    type: z.literal("test-recovery"),
    destinationId: id,
    snapshotId: id,
  }),
  z.object({
    type: z.literal("retention"),
    planId: id,
    destinationId: id,
    preview: z.boolean(),
  }),
  z.object({
    type: z.literal("verify-password"),
    destinationId: id,
    password: z.string().min(1).max(1024),
  }),
  z.object({ type: z.literal("settings"), settings: settingsSchema }),
  z.object({ type: z.literal("weather-check"), simulate: z.boolean() }),
  z.object({ type: z.literal("google-connect") }),
  z.object({ type: z.literal("google-disconnect") }),
  z.object({ type: z.literal("google-quota") }),
  z.object({ type: z.literal("diagnostics") }),
  z.object({ type: z.literal("diagnostics-snapshot") }),
  z.object({ type: z.literal("legacy-import"), path }),
  z.object({
    type: z.literal("choose-path"),
    kind: z.enum(["sources", "folder", "file", "save"]),
  }),
  z.object({
    type: z.literal("window"),
    action: z.enum(["minimize", "maximize", "close", "quit"]),
  }),
  z.object({
    type: z.literal("updates"),
    action: z.enum(["check", "download", "install"]),
  }),
  z.object({
    type: z.literal("history"),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(200),
  }),
]);
export type Request = z.infer<typeof requestSchema>;
export interface ResponseMap {
  state: State;
  "save-plan": Plan;
  "delete-plan": boolean;
  preview: Preview;
  "add-destination": Destination;
  "reconnect-destination": Destination;
  "delete-destination": boolean;
  run: string[];
  cancel: boolean;
  retry: string;
  snapshots: Snapshot[];
  files: { entries: FileEntry[]; total: number };
  restore: string;
  pin: boolean;
  check: string;
  "test-recovery": string;
  retention: unknown;
  "verify-password": boolean;
  settings: Settings;
  "weather-check": WeatherStatus;
  "google-connect": boolean;
  "google-disconnect": boolean;
  "google-quota": { used: number; limit?: number };
  diagnostics: string;
  "diagnostics-snapshot": DiagnosticsSnapshot;
  "legacy-import": { imported: number; warnings: string[] };
  "choose-path": string[];
  window: boolean;
  updates: State["update"];
  history: { jobs: Job[]; total: number };
  "file-history": { versions: FileVersion[]; total: number };
  "file-preview": FilePreview;
  "snapshot-diff": { changes: SnapshotChange[]; total: number };
  "copy-snapshot": string;
  "scan-gaps": GapScan;
  "recovery-kit": string;
  "practice-recovery": { files: number; bytes: number; snapshotId: string; target: string };
  "explorer-integration": boolean;
  "background-service": BackgroundStatus;
}
export interface SentryBridge {
  request<T extends Request>(request: T): Promise<ResponseMap[T["type"]]>;
  subscribe(callback: (state: State) => void): () => void;
}
declare global {
  interface Window {
    sentry: SentryBridge;
  }
}
