import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
await mkdir("outputs", { recursive: true });
const built = await Bun.build({ entrypoints: ["tests/recovery.integration.ts", "tests/background.integration.ts", "tests/recovery-state.integration.ts"], outdir: "outputs", naming: "[name].cjs", target: "node", format: "cjs" });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
for (const entry of ["background.integration", "recovery-state.integration", "recovery.integration"]) {
  const code = await new Promise<number>(resolve => { const child = spawn("node", [`outputs/${entry}.cjs`], { stdio: "inherit", shell: false, windowsHide: true }); child.once("error", () => resolve(1)); child.once("exit", code => resolve(code ?? 1)); });
  if (code) process.exit(code);
}
