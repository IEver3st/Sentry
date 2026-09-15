import { spawn } from "node:child_process";
import path from "node:path";

export interface VolumeIdentity {
  volumeId: string;
  driveLetter: string;
  diskNumber?: number;
}
// This is deliberately a fixed script. Paths and IDs are environment values, never PowerShell source.
const inspectScript = `
$ErrorActionPreference = 'Stop'
try {
  $sentryVolume = Get-Volume -DriveLetter $env:SENTRY_VOLUME_LETTER
  if (-not $sentryVolume.UniqueId -or -not $sentryVolume.DriveLetter) { exit 0 }
  $sentryResult = @{ volumeId = [string]$sentryVolume.UniqueId; driveLetter = [string]$sentryVolume.DriveLetter }
  try {
    $sentryPartition = Get-Partition -DriveLetter $env:SENTRY_VOLUME_LETTER
    $sentryDisk = Get-Disk -Number $sentryPartition.DiskNumber
    if ([string]$sentryDisk.BusType -in @('SATA','ATA','NVMe','USB','SAS') -and [string]$sentryDisk.FriendlyName -notmatch 'virtual|vmware|qemu|storage space') { $sentryResult.diskNumber = [int]$sentryDisk.Number }
  } catch {}
  $sentryResult | ConvertTo-Json -Compress
} catch { exit 0 }
`;
const relocateScript = `
$ErrorActionPreference = 'Stop'
try {
  $sentryMatches = @(Get-Volume | Where-Object { $_.UniqueId -eq $env:SENTRY_VOLUME_ID -and $_.DriveLetter })
  if ($sentryMatches.Count -eq 1) { @{ driveLetter = [string]$sentryMatches[0].DriveLetter } | ConvertTo-Json -Compress }
} catch { exit 0 }
`;
async function query(
  script: string,
  env: Record<string, string>,
): Promise<Record<string, unknown> | undefined> {
  if (process.platform !== "win32") return undefined;
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        shell: false,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let output = "";
    let settled = false;
    const finish = (value?: Record<string, unknown>) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      }
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish();
    }, 10_000);
    child.once("error", () => finish());
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 16_384) {
        child.kill();
        finish();
      }
    });
    child.once("close", (code) => {
      if (code !== 0 || !output.trim()) {
        finish();
        return;
      }
      try {
        const parsed: unknown = JSON.parse(output);
        finish(
          typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined,
        );
      } catch {
        finish();
      }
    });
  });
}
function letter(location: string): string | undefined {
  return /^([a-z]):[\\/]/i.exec(location)?.[1]?.toUpperCase();
}
export async function inspectVolume(
  location: string,
): Promise<VolumeIdentity | undefined> {
  const driveLetter = letter(location);
  if (!driveLetter) return undefined;
  const value = await query(inspectScript, {
    SENTRY_VOLUME_LETTER: driveLetter,
  });
  if (
    !value ||
    typeof value.volumeId !== "string" ||
    typeof value.driveLetter !== "string" ||
    !/^[a-z]$/i.test(value.driveLetter)
  )
    return undefined;
  return {
    volumeId: value.volumeId,
    driveLetter: value.driveLetter.toUpperCase(),
    ...(typeof value.diskNumber === "number" &&
    Number.isSafeInteger(value.diskNumber) &&
    value.diskNumber >= 0
      ? { diskNumber: value.diskNumber }
      : {}),
  };
}
export async function relocateVolume(
  location: string,
  volumeId: string,
): Promise<string | undefined> {
  if (
    !letter(location) ||
    !volumeId ||
    volumeId.length > 1024 ||
    /[\0\r\n]/.test(volumeId)
  )
    return undefined;
  const result = await query(relocateScript, { SENTRY_VOLUME_ID: volumeId });
  if (
    typeof result?.driveLetter !== "string" ||
    !/^[a-z]$/i.test(result.driveLetter)
  )
    return undefined;
  return path.win32.join(
    `${result.driveLetter.toUpperCase()}:\\`,
    location.slice(3),
  );
}
export async function sharesPhysicalDisk(
  source: string,
  destination: string,
): Promise<boolean | undefined> {
  const sourceLetter = letter(source);
  const destinationLetter = letter(destination);
  if (!sourceLetter || !destinationLetter) return undefined;
  const [a, b] = await Promise.all([
    inspectVolume(source),
    sourceLetter === destinationLetter
      ? Promise.resolve(undefined)
      : inspectVolume(destination),
  ]);
  if (a?.diskNumber === undefined) return undefined;
  if (sourceLetter === destinationLetter) return true;
  if (b?.diskNumber === undefined) return undefined;
  return a.diskNumber === b.diskNumber;
}
