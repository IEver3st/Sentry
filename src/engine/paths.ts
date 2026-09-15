import { lstat, realpath, opendir, mkdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import type { Preview } from "../shared/contracts";

export interface ScanEntry {
  path: string;
  relativePath: string;
  source: string;
  size: number;
  type: "file" | "directory" | "link";
  included: boolean;
  reason?: string;
}
export interface ScanResult {
  files: number;
  directories: number;
  bytes: number;
  excluded: number;
  warnings: string[];
  samples: ScanEntry[];
}
export interface SourceRules {
  sources: string[];
  includes?: string[];
  excludes?: string[];
}
export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(
    path.resolve(parent).toLowerCase(),
    path.resolve(child).toLowerCase(),
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export async function validateSources(
  sources: string[],
  destination?: string,
): Promise<string[]> {
  if (!sources.length || sources.length > 100)
    throw new Error("Choose between 1 and 100 source files or folders.");
  const canonical: string[] = [];
  for (const source of sources) {
    if (!path.isAbsolute(source) || /[\r\n\0]/.test(source))
      throw new Error(
        "Source paths must be absolute and contain no control characters.",
      );
    const info = await lstat(source);
    if (info.isSymbolicLink())
      throw new Error(
        "A source is a symbolic link or junction. Choose its actual folder.",
      );
    if (!info.isDirectory() && !info.isFile())
      throw new Error("Sources must be ordinary files or folders.");
    const resolved = await realpath(source);
    if (
      canonical.some(
        (other) =>
          containsPath(other, resolved) || containsPath(resolved, other),
      )
    )
      throw new Error("Source folders overlap or identify the same files.");
    canonical.push(resolved);
  }
  if (destination) {
    let resolvedDestination = path.resolve(destination);
    // Resolve the nearest existing ancestor so a junction cannot hide recursion.
    let ancestor = resolvedDestination;
    while (true) {
      try {
        resolvedDestination = path.join(
          await realpath(ancestor),
          path.relative(ancestor, resolvedDestination),
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    if (
      canonical.some(
        (source) =>
          containsPath(source, resolvedDestination) ||
          containsPath(resolvedDestination, source),
      )
    )
      throw new Error(
        "Backup sources and destination must be separate, non-overlapping folders.",
      );
  }
  return canonical;
}
export async function scanSources(
  rules: SourceRules,
  onEntry?: (entry: ScanEntry) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const includes = (rules.includes ?? []).map((p) =>
    picomatch(p, { dot: true, nocase: process.platform === "win32" }),
  );
  const excludes = (rules.excludes ?? []).map((p) =>
    picomatch(p, { dot: true, nocase: process.platform === "win32" }),
  );
  const result: ScanResult = {
    files: 0,
    directories: 0,
    bytes: 0,
    excluded: 0,
    warnings: [],
    samples: [],
  };
  const warn = (message: string) => {
    if (result.warnings.length < 100) result.warnings.push(message);
  };
  async function walk(
    source: string,
    current: string,
    inheritedExclusion = false,
  ): Promise<void> {
    signal?.throwIfAborted();
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      warn(`Could not read ${current}`);
      result.excluded++;
      await onEntry?.({
        path: current,
        relativePath: path.relative(source, current),
        source,
        size: 0,
        type: "file",
        included: false,
        reason: "Unreadable path",
      });
      return;
    }
    const relativePath = (
      path.relative(source, current) || path.basename(current)
    ).replaceAll("\\", "/");
    const isLink = stat.isSymbolicLink();
    const type = isLink ? "link" : stat.isDirectory() ? "directory" : "file";
    const explicitlyExcluded =
      inheritedExclusion ||
      excludes.some((m) => m(relativePath) || m(path.basename(current)));
    const included =
      !isLink &&
      !explicitlyExcluded &&
      (type === "directory" ||
        !includes.length ||
        includes.some((m) => m(relativePath) || m(path.basename(current))));
    const entry: ScanEntry = {
      path: current,
      relativePath,
      source,
      size: stat.isFile() ? stat.size : 0,
      type,
      included,
      ...(!included
        ? {
            reason: isLink
              ? "Symbolic links and junctions are excluded by policy"
              : explicitlyExcluded
                ? "Exclude rule"
                : "Outside include rules",
          }
        : {}),
    };
    if (included) {
      if (type === "file") {
        result.files++;
        result.bytes += stat.size;
      } else result.directories++;
    } else result.excluded++;
    if (isLink) warn(`Link excluded: ${current}`);
    if (result.samples.length < 200) result.samples.push(entry);
    await onEntry?.(entry);
    if (type === "directory" && !explicitlyExcluded) {
      try {
        for await (const entry of await opendir(current))
          await walk(source, path.join(current, entry.name));
      } catch (error) {
        if (signal?.aborted) throw error;
        warn(`Could not enumerate ${current}`);
      }
    }
  }
  for (const source of rules.sources) await walk(source, source);
  return result;
}
export function snapshotPath(source: string): string {
  return (
    "/" +
    source
      .replace(/^\\\\\?\\/, "")
      .replaceAll("\\", "/")
      .replace(/^([A-Za-z]):/, "$1")
      .replace(/^\/+/, "")
  );
}
export function safeSnapshotPath(value: string): string {
  if (
    !value.startsWith("/") ||
    /[\\\0\r\n:]/.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          part === ".." ||
          part === "." ||
          (process.platform === "win32" &&
            (/[. ]$/.test(part) ||
              /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))),
      )
  )
    throw new Error("Unsafe path in backup snapshot.");
  return value;
}
export async function safeRestoreTarget(target: string): Promise<string> {
  if (
    !path.isAbsolute(target) ||
    /[\0\r\n]/.test(target) ||
    path.parse(target).root === path.resolve(target)
  )
    throw new Error("Choose a separate restore folder, not a drive root.");
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error(
          "Restore destination contains a symbolic link or junction.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await mkdir(absolute, { recursive: true });
  // Existing links anywhere beneath target can redirect engine writes.
  async function rejectLinks(dir: string): Promise<void> {
    for await (const entry of await opendir(dir)) {
      const child = path.join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          "Restore folder contains a link or junction. Choose an empty folder.",
        );
      if (entry.isDirectory()) await rejectLinks(child);
    }
  }
  await rejectLinks(absolute);
  return absolute;
}
export async function previewSources(
  sources: string[],
  includes: string[],
  excludes: string[],
  destinations: string[] = [],
): Promise<Preview> {
  const canonical = await validateSources(sources);
  for (const destination of destinations)
    if (!destination.startsWith("rclone:"))
      await validateSources(sources, destination);
  const result = await scanSources({ sources: canonical, includes, excludes });
  return {
    included: result.files,
    excluded: result.excluded,
    bytes: result.bytes,
    entries: result.samples.map(({ path, included, reason, size }) => ({
      path,
      included,
      ...(reason ? { reason } : {}),
      size,
    })),
    warnings: result.warnings,
    truncated:
      result.files + result.directories + result.excluded >
      result.samples.length,
  };
}
