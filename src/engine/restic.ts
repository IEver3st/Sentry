import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { mkdtemp, writeFile, rm, mkdir, opendir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  scanSources,
  validateSources,
  safeRestoreTarget,
  safeSnapshotPath,
  snapshotPath,
  type SourceRules,
} from "./paths";

export interface Repository {
  location: string;
  password: string;
  env?: Record<string, string>;
  bandwidthKiB?: number;
}
export type EngineEvent = Record<string, unknown>;
export interface ResticSnapshot {
  id: string;
  short_id?: string;
  time: string;
  paths: string[];
  tags?: string[];
  hostname?: string;
  summary?: Record<string, number | string>;
}
export interface EngineResult {
  code: number;
  summary: EngineEvent;
  warnings: string[];
}
export interface BackupOptions extends SourceRules {
  planId: string;
  planName?: string;
  name?: string;
  pin?: boolean;
  vss?: boolean;
}
export interface RestoreOptions {
  snapshotId: string;
  target: string;
  paths?: string[];
  overwrite: "never" | "always";
}
export interface RetentionOptions {
  planId: string;
  daily: number;
  weekly: number;
  monthly: number;
  dryRun: boolean;
}
export interface EngineOptions {
  executable: string;
  rcloneExecutable?: string;
  cacheDir?: string;
}
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
type Listener = (event: EngineEvent) => void | Promise<void>;
function snapshotId(id: string): string {
  if (!/^[a-f0-9]{8,64}$/.test(id))
    throw new Error("Invalid snapshot identity.");
  return id;
}
function literalPattern(value: string): string {
  return value.replace(/[\\*?[\]]/g, "\\$&");
}
function safeTag(value: string): string {
  return Buffer.from(value).toString("base64url");
}
function redact(message: string, repo: Repository): string {
  const secrets = [repo.password];
  for (const [key, value] of Object.entries(repo.env ?? {})) {
    if (/SECRET|PASSWORD/i.test(key)) secrets.push(value);
    if (/TOKEN/i.test(key)) {
      secrets.push(value);
      try {
        const token = JSON.parse(value) as Record<string, unknown>;
        for (const [name, content] of Object.entries(token))
          if (/token|secret/i.test(name) && typeof content === "string")
            secrets.push(content);
      } catch {
        /* Token may be a plain string. */
      }
    }
  }
  let sanitized = message;
  for (const secret of secrets)
    if (secret) sanitized = sanitized.replaceAll(secret, "[redacted]");
  return sanitized.replace(
    /((?:access_token|refresh_token|client_secret|password)\s*[=:]\s*)[^\s&,]+/gi,
    "$1[redacted]",
  );
}
function redactEvent(value: unknown, repo: Repository): unknown {
  if (typeof value === "string") return redact(value, repo);
  if (Array.isArray(value)) return value.map((item) => redactEvent(item, repo));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactEvent(item, repo),
      ]),
    );
  return value;
}
export class ResticEngine {
  constructor(private readonly options: EngineOptions) {}
  private async run(
    repo: Repository,
    args: string[],
    onEvent?: Listener,
    signal?: AbortSignal,
    allowPartial = false,
  ): Promise<EngineResult> {
    signal?.throwIfAborted();
    if (!repo.password)
      throw new Error("Repository recovery password is required.");
    const common = [
      "--json",
      "--repo",
      repo.location,
      "--pack-size",
      "16",
      "--compression",
      "auto",
      "--retry-lock",
      "5s",
      "--stuck-request-timeout",
      "30s",
    ];
    if (this.options.cacheDir)
      common.push("--cache-dir", this.options.cacheDir);
    if (repo.bandwidthKiB)
      common.push(
        "--limit-upload",
        String(repo.bandwidthKiB),
        "--limit-download",
        String(repo.bandwidthKiB),
      );
    if (repo.location.startsWith("rclone:")) {
      if (!this.options.rcloneExecutable)
        throw new Error("Google Drive transport executable is unavailable.");
      // Restic's -o flag parses CSV before its executable command parser.
      const program = `rclone.program=${JSON.stringify(this.options.rcloneExecutable.replaceAll("\\", "/"))}`;
      common.push("-o", '"' + program.replaceAll('"', '""') + '"');
    }
    const env = {
      ...process.env,
      ...repo.env,
      RESTIC_PASSWORD: repo.password,
      GOMAXPROCS: "2",
      GOMEMLIMIT: "128MiB",
      RESTIC_READ_CONCURRENCY: "2",
      RCLONE_CONFIG: process.platform === "win32" ? "NUL" : "/dev/null",
      RCLONE_LOG_LEVEL: "ERROR",
      RCLONE_LOG_FILE: "",
      RCLONE_TRANSFERS: "2",
      RCLONE_CHECKERS: "2",
      RCLONE_BUFFER_SIZE: "4M",
      RCLONE_RETRIES: "3",
      RCLONE_LOW_LEVEL_RETRIES: "5",
    };
    // Never inherit alternative credential/command configuration from a user's shell.
    for (const key of [
      "RESTIC_PASSWORD_COMMAND",
      "RESTIC_PASSWORD_FILE",
      "RESTIC_REPOSITORY_FILE",
    ])
      delete (env as Record<string, string | undefined>)[key];
    const child = spawn(this.options.executable, [...common, ...args], {
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const warnings: string[] = [];
    let summary: EngineEvent = {};
    let diagnostic = "";
    let parseError: unknown;
    let document = "";
    let termination: Promise<void> | undefined;
    const abort = () => {
      if (termination) return;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { shell: false, windowsHide: true, stdio: "ignore" },
        );
        termination = new Promise((resolve) => {
          killer.once("error", () => {
            child.kill();
            resolve();
          });
          killer.once("close", () => resolve());
        });
      } else child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });
    const done = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    const consume = async (stream: NodeJS.ReadableStream, stderr: boolean) => {
      // Bound a line before readline can allocate an arbitrarily large string.
      let lineBytes = 0;
      const bounded = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          for (const byte of chunk) {
            if (byte === 10) lineBytes = 0;
            else if (++lineBytes > (stderr ? 65536 : 16 * 1024 * 1024)) {
              callback(
                new Error("Engine metadata page exceeded its safety limit."),
              );
              return;
            }
          }
          callback(null, chunk);
        },
      });
      stream.pipe(bounded);
      const lines = createInterface({ input: bounded, crlfDelay: Infinity });
      bounded.once("error", (error) => {
        parseError = error;
        abort();
        lines.close();
      });
      try {
        for await (const line of lines) {
          if (line.length > 16 * 1024 * 1024)
            throw new Error("Engine metadata page exceeded its safety limit.");
          if (!line.trim()) continue;
          if (!stderr && args[0] === "cat") {
            document += line;
            if (document.length > 65536)
              throw new Error(
                "Repository configuration exceeded safety limit.",
              );
            continue;
          }
          let event: EngineEvent;
          try {
            const value: unknown = JSON.parse(line);
            event = Array.isArray(value)
              ? { message_type: "array", value }
              : (value as EngineEvent);
          } catch {
            if (stderr)
              diagnostic = (diagnostic + "\n" + redact(line, repo)).slice(
                -4096,
              );
            continue;
          }
          if (event.message_type === "summary") summary = event;
          if (
            event.message_type === "error" ||
            event.message_type === "exit_error"
          ) {
            const message =
              typeof event.message === "string"
                ? event.message
                : typeof event.error === "object" && event.error !== null
                  ? String(
                      (event.error as EngineEvent).message ??
                        "Engine could not process a file",
                    )
                  : "Engine could not process a file";
            if (warnings.length < 100) warnings.push(redact(message, repo));
          }
          if (stderr) event = redactEvent(event, repo) as EngineEvent;
          await onEvent?.(event);
        }
      } catch (error) {
        parseError = error;
        abort();
      }
    };
    try {
      const [code] = await Promise.all([
        done,
        consume(child.stdout, false),
        consume(child.stderr, true),
      ]);
      await termination;
      signal?.throwIfAborted();
      if (parseError) throw parseError;
      if (document) await onEvent?.(JSON.parse(document) as EngineEvent);
      if (code !== 0 && !(code === 3 && allowPartial)) {
        const messages: Record<number, string> = {
          10: "Backup destination is unavailable or is not a repository.",
          11: "Repository is busy or has a lock from an interrupted operation. Check no other backup program is using it before recovery.",
          12: "The recovery password does not unlock this repository.",
        };
        throw new EngineError(
          messages[code] ??
            warnings.at(-1) ??
            (diagnostic.trim() || `Backup engine exited with code ${code}.`),
          code,
        );
      }
      return { code, summary, warnings };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async version(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.executable, ["version"], {
        windowsHide: true,
        shell: false,
      });
      let text = "";
      child.stdout.on("data", (chunk: Buffer) => {
        text = (text + chunk.toString()).slice(0, 1000);
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(text.trim())
          : reject(new Error("Backup engine is unavailable.")),
      );
    });
  }
  async init(repo: Repository, signal?: AbortSignal): Promise<string> {
    await this.run(
      repo,
      ["init", "--repository-version", "2"],
      undefined,
      signal,
    );
    return this.identity(repo, signal);
  }
  async identity(repo: Repository, signal?: AbortSignal): Promise<string> {
    let id = "";
    await this.run(
      repo,
      ["cat", "config"],
      (event) => {
        if (typeof event.id === "string") id = event.id;
      },
      signal,
    );
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new Error("Repository identity could not be verified.");
    return id;
  }
  async backup(
    repo: Repository,
    options: BackupOptions,
    onEvent?: Listener,
    signal?: AbortSignal,
  ): Promise<EngineResult> {
    const sources = await validateSources(
      options.sources,
      repo.location.startsWith("rclone:") ? undefined : repo.location,
    );
    const scratch = await mkdtemp(path.join(tmpdir(), "sentry-selection-"));
    const excludes: string[] = []; // Manifest paths only; never file contents. Bounded by disk below.
    const excludedFile = path.join(scratch, "excluded.txt");
    await writeFile(excludedFile, "");
    const selectedFile = path.join(scratch, "selected.raw");
    await writeFile(selectedFile, "");
    const exactSelection = Boolean(options.includes?.length);
    let selectedCount = 0;
    const { appendFile } = await import("node:fs/promises");
    try {
      const scan = await scanSources(
        { ...options, sources },
        async (entry) => {
          if (!entry.included) {
            excludes.push(literalPattern(entry.path.replaceAll("\\", "/")));
            if (excludes.length >= 256) {
              await appendFile(excludedFile, excludes.join("\n") + "\n");
              excludes.length = 0;
            }
          }
          if (exactSelection && entry.included) {
            let select = entry.type === "file";
            if (entry.type === "directory") {
              const dir = await opendir(entry.path);
              try {
                select = (await dir.read()) === null;
              } finally {
                await dir.close();
              }
            }
            if (select) {
              await appendFile(selectedFile, entry.path + "\0");
              selectedCount++;
              // A folder that was empty at scan time must not recursively admit new unmatched files.
              if (entry.type === "directory")
                excludes.push(
                  literalPattern(entry.path.replaceAll("\\", "/")) + "/*",
                );
            }
          }
        },
        signal,
      );
      if (excludes.length)
        await appendFile(excludedFile, excludes.join("\n") + "\n");
      if (scan.warnings.some((w) => !w.startsWith("Link excluded:")))
        throw new Error(
          `Source scan could not read every path. ${scan.warnings[0]}`,
        );
      await onEvent?.({
        message_type: "scan_summary",
        total_files: scan.files,
        total_bytes: scan.bytes,
        excluded: scan.excluded,
      });
      const args = [
        "backup",
        "--read-concurrency",
        "2",
        "--tag",
        `sentry:plan:${options.planId}`,
        "--tag",
        "sentry:incomplete",
        "--exclude-file",
        excludedFile,
      ];
      for (const source of sources)
        args.push("--tag", `sentry:source:${safeTag(source)}`);
      if (options.planName)
        args.push("--tag", `sentry:plan-name:${safeTag(options.planName)}`);
      if (options.name)
        args.push("--tag", `sentry:name:${safeTag(options.name)}`);
      if (options.pin) args.push("--tag", "sentry:pinned");
      if (options.vss) args.push("--use-fs-snapshot");
      // Explicit rules remain active during backup, including files created after preview.
      for (const pattern of options.excludes ?? [])
        args.push("--exclude", pattern);
      if (exactSelection) {
        if (!selectedCount)
          throw new Error("No files or empty folders match the include rules.");
        args.push("--files-from-raw", selectedFile);
      } else args.push("--", ...sources);
      const result = await this.run(repo, args, onEvent, signal, true);
      result.warnings.push(...scan.warnings);
      if (scan.warnings.length && result.code === 0) result.code = 3;
      // A committed snapshot remains marked incomplete if the worker dies before confirming success.
      if (result.code === 0 && typeof result.summary.snapshot_id === "string")
        await this.run(
          repo,
          [
            "tag",
            "--remove",
            "sentry:incomplete",
            snapshotId(result.summary.snapshot_id),
          ],
          (event) => {
            if (typeof event.new_snapshot_id === "string")
              result.summary.snapshot_id = event.new_snapshot_id;
          },
          signal,
        );
      return result;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  async snapshots(
    repo: Repository,
    signal?: AbortSignal,
  ): Promise<ResticSnapshot[]> {
    let snapshots: ResticSnapshot[] = [];
    await this.run(
      repo,
      ["snapshots"],
      (event) => {
        if (Array.isArray(event.value))
          snapshots = event.value as ResticSnapshot[];
      },
      signal,
    );
    return snapshots;
  }
  async list(
    repo: Repository,
    id: string,
    onEntry: Listener,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run(
      repo,
      ["ls", snapshotId(id)],
      async (event) => {
        if (typeof event.path === "string") {
          safeSnapshotPath(event.path);
          await onEntry(event);
        }
      },
      signal,
    );
  }
  async restore(
    repo: Repository,
    options: RestoreOptions,
    onEvent?: Listener,
    signal?: AbortSignal,
  ): Promise<EngineResult> {
    const target = await safeRestoreTarget(options.target);
    const snapshot = (await this.snapshots(repo, signal)).find((s) =>
      s.id.startsWith(snapshotId(options.snapshotId)),
    );
    if (!snapshot) throw new Error("Snapshot could not be found.");
    const savedSources = snapshot.tags
      ?.filter((t) => t.startsWith("sentry:source:"))
      .map((t) =>
        Buffer.from(t.slice("sentry:source:".length), "base64url").toString(),
      );
    const selected = options.paths?.length
      ? options.paths.map(safeSnapshotPath)
      : (savedSources?.length ? savedSources : snapshot.paths).map(
          snapshotPath,
        );
    // Reject source links, even for repositories imported from other programs.
    await this.list(
      repo,
      snapshot.id,
      (entry) => {
        if (
          entry.type === "symlink" &&
          selected.some(
            (p) =>
              String(entry.path) === p ||
              String(entry.path).startsWith(p + "/"),
          )
        )
          throw new Error(
            "This selection contains links. Choose individual ordinary files or folders without links.",
          );
      },
      signal,
    );
    const result: EngineResult = { code: 0, summary: {}, warnings: [] };
    const roots = selected.filter(
      (entry, i) =>
        !selected.some(
          (parent, j) =>
            i !== j &&
            (entry.startsWith(parent + "/") || (entry === parent && j < i)),
        ),
    );
    for (const root of roots) {
      signal?.throwIfAborted();
      const parent = path.posix.dirname(root);
      const name = path.posix.basename(root);
      const subtarget = path.resolve(target, "." + parent);
      if (
        !subtarget.toLowerCase().startsWith(target.toLowerCase() + path.sep) &&
        subtarget !== target
      )
        throw new Error("Unsafe restore destination.");
      await mkdir(subtarget, { recursive: true });
      const current = await this.run(
        repo,
        [
          "restore",
          `${snapshot.id}:${parent}`,
          "--target",
          subtarget,
          "--include",
          "/" + literalPattern(name),
          "--overwrite",
          options.overwrite,
          "--verify",
        ],
        onEvent,
        signal,
      );
      for (const [key, value] of Object.entries(current.summary))
        if (typeof value === "number")
          result.summary[key] = Number(result.summary[key] ?? 0) + value;
      result.warnings.push(...current.warnings);
    }
    if (Number(result.summary.files_skipped ?? 0) > 0) {
      result.code = 3;
      result.warnings.push(
        "Existing files were left unchanged. Skipped files are not verified as matching this snapshot.",
      );
    }
    return result;
  }
  async check(
    repo: Repository,
    readData = false,
    signal?: AbortSignal,
  ): Promise<EngineResult> {
    return this.run(
      repo,
      ["check", ...(readData ? ["--read-data"] : [])],
      undefined,
      signal,
    );
  }
  async unlockStale(repo: Repository, signal?: AbortSignal): Promise<void> {
    await this.run(repo, ["unlock"], undefined, signal);
  }
  async retain(
    repo: Repository,
    options: RetentionOptions,
    signal?: AbortSignal,
  ): Promise<EngineEvent[]> {
    const events: EngineEvent[] = [];
    const args = [
      "forget",
      "--tag",
      `sentry:plan:${options.planId}`,
      "--group-by",
      "host,paths",
      "--keep-tag",
      "sentry:pinned",
      "--keep-daily",
      String(options.daily),
      "--keep-weekly",
      String(options.weekly),
      "--keep-monthly",
      String(options.monthly),
      ...(options.dryRun
        ? ["--dry-run"]
        : ["--prune", "--max-unused", "5%", "--max-repack-size", "256M"]),
    ];
    await this.run(
      repo,
      args,
      (event) => {
        events.push(event);
      },
      signal,
    );
    return events;
  }
  async pin(
    repo: Repository,
    id: string,
    pinned: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run(
      repo,
      ["tag", pinned ? "--add" : "--remove", "sentry:pinned", snapshotId(id)],
      undefined,
      signal,
    );
  }
}
