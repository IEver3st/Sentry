import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Pinned official Windows x64 artifacts. Bumps require reviewing upstream release notes.
const engines = [
  {
    name: "restic",
    version: "0.19.1",
    file: "restic_0.19.1_windows_amd64.zip",
    hash: "da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d",
    exe: "restic_0.19.1_windows_amd64.exe",
    base: "https://github.com/restic/restic/releases/download/v0.19.1",
    license: "https://raw.githubusercontent.com/restic/restic/v0.19.1/LICENSE",
  },
  {
    name: "rclone",
    version: "1.75.1",
    file: "rclone-v1.75.1-windows-amd64.zip",
    hash: "200eb602c126d82aa38b51e0f6b9ae837473ff99b51278d3f6f837574c494d6e",
    exe: "rclone-v1.75.1-windows-amd64/rclone.exe",
    base: "https://github.com/rclone/rclone/releases/download/v1.75.1",
    license: "https://raw.githubusercontent.com/rclone/rclone/v1.75.1/COPYING",
  },
];
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("The current package targets Windows x64.");
await mkdir("vendor/downloads", { recursive: true });
await mkdir("vendor/bin", { recursive: true });
await mkdir("vendor/notices", { recursive: true });
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Official engine download returned HTTP ${response.status}.`,
    );
  return Buffer.from(await response.arrayBuffer());
}
for (const engine of engines) {
  const archive = path.resolve("vendor/downloads", engine.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(archive);
  } catch {
    bytes = await download(`${engine.base}/${engine.file}`);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== engine.hash)
    throw new Error(`${engine.name} archive did not match its pinned SHA256.`);
  const upstream = (await download(`${engine.base}/SHA256SUMS`)).toString();
  if (
    !upstream
      .split("\n")
      .some(
        (line) =>
          line.trim() === `${engine.hash}  ${engine.file}` ||
          line.trim() === `${engine.hash} *${engine.file}`,
      )
  )
    throw new Error(
      `${engine.name} upstream checksums did not match the reviewed pin.`,
    );
  await writeFile(archive, bytes);
  await writeFile(`vendor/downloads/${engine.name}-SHA256SUMS`, upstream);
  const destination = path.resolve("vendor/downloads", engine.name);
  const extract = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:SENTRY_ENGINE_ARCHIVE -DestinationPath $env:SENTRY_ENGINE_EXTRACT -Force",
    ],
    {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        SENTRY_ENGINE_ARCHIVE: archive,
        SENTRY_ENGINE_EXTRACT: destination,
      },
      encoding: "utf8",
    },
  );
  if (extract.status !== 0)
    throw new Error(`Could not extract ${engine.name}: ${extract.stderr}`);
  await copyFile(
    path.join(destination, engine.exe),
    `vendor/bin/${engine.name}.exe`,
  );
  await writeFile(
    `vendor/notices/${engine.name}-LICENSE.txt`,
    await download(engine.license),
  );
  console.log(
    `${engine.name} ${engine.version}: verified official SHA256 and installed vendor/bin/${engine.name}.exe`,
  );
}
await writeFile(
  "vendor/notices/versions.json",
  JSON.stringify(
    engines.map(({ name, version, hash, base, file }) => ({
      name,
      version,
      sha256: hash,
      source: `${base}/${file}`,
    })),
    null,
    2,
  ) + "\n",
);
