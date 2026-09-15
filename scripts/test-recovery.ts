import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
await mkdir("outputs", { recursive: true });
const built = await Bun.build({ entrypoints: ["tests/recovery.integration.ts"], outdir: "outputs", naming: "recovery.integration.cjs", target: "node", format: "cjs" });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const child = spawn("node", ["outputs/recovery.integration.cjs"], { stdio: "inherit", shell: false, windowsHide: true });
child.on("exit", code => process.exit(code ?? 1));
