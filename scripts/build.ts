import { build } from "vite";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const [entry, external] of [
  ["src/main/main.ts", ["electron"]],
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
