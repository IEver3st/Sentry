import { mkdtemp, readFile, rm, mkdir, opendir, lstat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import type { Store } from "./store";
import type { ResticEngine, Repository } from "./restic";
import { containsPath, safeSnapshotPath, scanSources } from "./paths";
import { sharesPhysicalDisk } from "./volume";
import type { Destination, FileEntry, FilePreview, GapScan, Plan, Protection, SnapshotChange, State } from "../shared/contracts";

export async function previewFile(engine: ResticEngine, repo: Repository, snapshotId: string, file: FileEntry, data: string, signal: AbortSignal): Promise<FilePreview> {
  const extension = extname(file.path).toLowerCase();
  const images: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const text = /\.(txt|md|json|js|jsx|ts|tsx|css|html|xml|yml|yaml|toml|ini|cfg|conf|log|csv|sql|lua|py|cs|cpp|h|sh|ps1|env|gitignore)$/i.test(file.path) || ["Dockerfile", "LICENSE", ".env", ".gitignore"].includes(basename(file.path));
  if (file.type !== "file" || (!images[extension] && !text)) return { kind: "unavailable", content: "", reason: "Preview supports text, code, PNG, JPEG, WebP and GIF files. Restore this file to open it in its application." };
  if (file.size > (images[extension] ? 4 * 1024 * 1024 : 256 * 1024)) return { kind: "unavailable", content: "", reason: "This file is larger than the preview limit. Restore it to view its contents." };
  const root = join(data, "previews");
  await mkdir(root, { recursive: true });
  const target = await mkdtemp(join(root, "file-"));
  try {
    const result = await engine.restore(repo, { snapshotId, target, paths: [safeSnapshotPath(file.path)], overwrite: "never" }, undefined, signal);
    if (result.code !== 0) throw new Error("The preview could not be fully restored and verified.");
    const contents = await readFile(join(target, "." + file.path));
    if (images[extension]) return { kind: "image", content: `data:${images[extension]};base64,${contents.toString("base64")}` };
    if (contents.includes(0)) return { kind: "unavailable", content: "", reason: "This file contains binary data. Restore it to open it." };
    return { kind: "text", content: contents.toString("utf8") };
  } finally { await rm(target, { recursive: true, force: true }); }
}

export async function compareSnapshots(store: Store, engine: ResticEngine, repo: Repository, destinationId: string, before: string, after: string, offset: number, limit: number, signal: AbortSignal) {
  // Stream the comparison to SQLite so a large deletion never fills renderer memory.
  store.db.exec("CREATE TEMP TABLE IF NOT EXISTS comparison(path TEXT PRIMARY KEY,change TEXT NOT NULL); DELETE FROM comparison;");
  const insert = store.db.prepare("INSERT OR REPLACE INTO comparison VALUES(?,?)");
  const metadata = await engine.snapshots(repo, signal);
  const beforeSnapshot = metadata.find(s => s.id === before);
  const afterSnapshot = metadata.find(s => s.id === after);
  if (!beforeSnapshot || !afterSnapshot) throw new Error("One of these snapshots is no longer available.");
  const mappings = engine.mappings(beforeSnapshot);
  const afterMappings = engine.mappings(afterSnapshot);
  if (JSON.stringify([...mappings].sort((a, b) => a.original.localeCompare(b.original))) !== JSON.stringify([...afterMappings].sort((a, b) => a.original.localeCompare(b.original))))
    throw new Error("These snapshots use different database capture paths. Use File history to inspect and recover their individual versions.");
  await engine.diff(repo, before, after, event => {
    if (typeof event.path !== "string" || typeof event.modifier !== "string") return;
    const modifier = event.modifier;
    const mapped = mappings.find(m => m.captured === event.path);
    if (mappings.length && !mapped) return;
    insert.run(mapped?.original ?? safeSnapshotPath(event.path), modifier.includes("+") ? "added" : modifier.includes("-") ? "deleted" : "changed");
  }, signal);
  const rows = store.db.prepare("SELECT path,change FROM comparison ORDER BY path LIMIT ? OFFSET ?").all(limit, offset);
  const changes: SnapshotChange[] = rows.map(row => ({ path: String(row.path), change: row.change as SnapshotChange["change"] }));
  return { changes, total: Number(store.db.prepare("SELECT COUNT(*) n FROM comparison").get()!.n) };
}

export function recoveryKit(state: State): string {
  return [
    "SENTRY RECOVERY KIT", `Created ${new Date().toISOString()}`, "",
    "Keep this file somewhere you can reach if this PC is lost. It lists private folder and repository locations. Passwords and cloud tokens are deliberately excluded. Store recovery passwords separately, outside this PC.", "",
    "ON A REPLACEMENT WINDOWS PC", "1. Install Sentry from https://github.com/IEver3st/Sentry/releases or obtain restic from https://restic.net/.",
    "2. Attach your backup drive or reconnect your Google account. In Sentry, open Settings > Destinations > Add destination > Connect an existing repository.",
    "3. Enter the repository location and its recovery password. Do not create a new repository over the old one.",
    "4. Open Restore, select a dated version, preview the files, and restore into a separate empty folder. Check Activity for verified completion and any skipped files.",
    "5. Open the recovered files in their applications before replacing current work. SQLite databases were captured independently, not as one cross-database transaction.", "",
    "WITHOUT SENTRY", "Restic can recover every repository without Sentry's application database. Run restic --repo <repository> snapshots, then restic --repo <repository> restore <snapshot-id> --target <empty-folder> --verify. Supply the password at restic's prompt, never on the command line. Replace placeholders with your values.",
    "Google Drive repositories additionally require rclone with your own authorized Drive remote. Use rclone:<remote-name>:<folder> as the repository. See https://rclone.org/drive/ and https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html.",
    "SQLite captures use staged paths in restic. Snapshot tags beginning sentry:map: contain base64url JSON mapping original and captured paths; Sentry applies this mapping automatically. A direct restic restore still recovers the database bytes under their captured paths.", "",
    "REPOSITORIES",
    ...state.destinations.flatMap(d => [d.name, `Storage: ${d.kind === "local" ? "Drive or network share" : "Google Drive"}`, `Location: ${d.location}`, `Repository identity: ${d.repositoryId}`, `Last complete operation: ${d.lastSuccess ?? "No complete backup recorded"}`, "Recovery password: stored separately", ""]),
    "PLANS", ...state.plans.flatMap(p => [p.name, ...p.sources.map(s => `  ${s}`), `Capture: ${p.capture ?? "files"}`, ""]),
    "PRACTICE", "Before a disaster, use Settings > Recovery > Practice recovery. Enter your repository password again. Sentry will read a fresh repository catalog and restore a sample into the folder you choose without relying on the saved catalog or saved password. A sample is evidence for those files only.",
  ].join("\r\n");
}

export async function scanGaps(plans: Plan[], destinations: Destination[], protection: Protection[], roots: string[], signal: AbortSignal): Promise<GapScan> {
  const result: GapScan = { checkedAt: new Date().toISOString(), gaps: [], truncated: false };
  const add = (gap: Omit<GapScan["gaps"][number], "id">) => { if (result.gaps.length < 200) result.gaps.push({ ...gap, id: String(result.gaps.length) }); else result.truncated = true; };
  for (const plan of plans) {
    signal.throwIfAborted();
    if (!plan.enabled) { add({ title: `${plan.name} is disabled`, detail: "Its files receive no automatic backups.", planId: plan.id, severity: "attention" }); continue; }
    for (const id of plan.destinationIds) {
      const d = destinations.find(d => d.id === id);
      const copy = protection.find(p => p.planId === plan.id && p.destinationId === id);
      if (!copy?.lastSuccess || Date.now() - Date.parse(copy.lastSuccess) > 7 * 86400_000)
        add({ title: `${plan.name} has ${copy?.lastSuccess ? "an old" : "no recorded complete"} copy on ${d?.name ?? "a missing destination"}`, detail: copy?.lastSuccess ? `Last complete capture: ${copy.lastSuccess}. Review its schedule and destination.` : "Run this plan and check that this destination completes.", planId: plan.id, severity: "attention" });
    }
    const local = destinations.filter(d => d.kind === "local" && plan.destinationIds.includes(d.id));
    for (const source of plan.sources) {
      for (const d of local) if (await sharesPhysicalDisk(source, d.location)) add({ title: "Source and backup share a physical disk", detail: `${d.name} cannot protect ${source} from failure of that disk.`, path: source, planId: plan.id, severity: "attention" });
    }
    for (let i = 0; i < local.length; i++) for (let j = i + 1; j < local.length; j++)
      if (await sharesPhysicalDisk(local[i].location, local[j].location)) add({ title: "Two backup destinations share a physical disk", detail: `${local[i].name} and ${local[j].name} are not independent disk copies.`, planId: plan.id, severity: "attention" });
    if (plan.includes.length || plan.excludes.length) {
      const scan = await scanSources(plan, entry => {
        if (!entry.included && (entry.type === "directory" || /\.(docx?|pdf|xlsx?|pptx?|db|sqlite|psd|blend|kra|env)$/i.test(entry.path))) add({ title: "Review an excluded path", detail: `${entry.reason}. Check whether this belongs in ${plan.name}.`, path: entry.path, planId: plan.id, severity: "info" });
      }, signal);
      for (const warning of scan.warnings) add({ title: "A source could not be fully inspected", detail: warning, planId: plan.id, severity: "attention" });
    }
  }
  // Discovery is deliberately shallow and opt-in. Never crawl the entire user profile.
  for (const root of roots) {
    signal.throwIfAborted();
    try {
      if ((await lstat(root)).isSymbolicLink()) throw new Error("Choose the actual folder instead of a link.");
      const candidates = [root];
      for await (const entry of await opendir(root)) {
        if (candidates.length >= 201) { result.truncated = true; break; }
        if (entry.isDirectory() && !entry.isSymbolicLink()) candidates.push(join(root, entry.name));
      }
      for (const candidate of candidates) if (!plans.some(p => p.enabled && p.sources.some(s => containsPath(s, candidate))))
        add({ title: "Folder is outside enabled plans", detail: "Review this folder and choose whether to protect it. No plan was changed.", path: candidate, severity: "info" });
    } catch (error) { add({ title: "Discovery folder unavailable", detail: error instanceof Error ? error.message : "Could not read folder.", path: root, severity: "attention" }); }
  }
  return result;
}
