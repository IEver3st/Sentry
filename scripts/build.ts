import { build } from "vite";
import { mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
await mkdir("dist", { recursive: true });
if (process.platform === "win32") {
  await mkdir("dist/service", { recursive: true });
  const compiler = join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const native = spawnSync(compiler, ["/nologo", "/target:winexe", "/out:dist\\service\\SentryService.exe", "/reference:System.ServiceProcess.dll", "/reference:System.Web.Extensions.dll", "native\\SentryService.cs"], { shell: false, windowsHide: true, encoding: "utf8" });
  if (native.status !== 0) throw new Error(`Service host build failed: ${native.stdout} ${native.stderr}`);
  await copyFile("native/service-setup.ps1", "dist/service/service-setup.ps1");
}
for (const [entry, external] of [
  ["src/main/main.ts", ["electron", "electron-updater"]],
  ["src/main/preload.ts", ["electron"]],
  ["src/engine/worker.ts", []],
] as const) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "node",
    format: "cjs",
    outdir: "dist",
    external: [...external],
    naming: "[name].cjs",
    minify: false,
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
}
await build();
