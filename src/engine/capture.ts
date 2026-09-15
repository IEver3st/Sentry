import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { validateSources, containsPath } from "./paths";
import type { Plan } from "../shared/contracts";

// SQLite's online backup API includes committed WAL data while the source stays open.
// Each database is independently consistent; this is not a transaction across databases.
export async function captureDatabases(plan: Plan, data: string, signal: AbortSignal) {
  const sources = await validateSources(plan.sources);
  const root = join(data, "database-captures");
  const directory = join(root, plan.id);
  if (!containsPath(root, directory) || root === directory) throw new Error("Invalid capture directory.");
  await mkdir(directory, { recursive: true });
  const mappings: Array<{ original: string; captured: string }> = [];
  try {
    for (const [index, source] of sources.entries()) {
      signal.throwIfAborted();
      const folder = join(directory, String(index));
      await mkdir(folder, { recursive: true });
      const captured = join(folder, basename(source));
      const db = new DatabaseSync(source, { readOnly: true, allowExtension: false });
      try {
        await backup(db, captured, { rate: 128, progress: () => { signal.throwIfAborted(); } });
      } finally { db.close(); }
      const check = new DatabaseSync(captured, { readOnly: true, allowExtension: false });
      try {
        const rows = check.prepare("PRAGMA quick_check").all();
        if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok")
          throw new Error("The captured database did not pass SQLite's consistency check.");
      } finally { check.close(); }
      mappings.push({ original: source, captured });
    }
    return { sources: mappings.map(m => m.captured), mappings, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
