import { spawn } from "node:child_process";
import type { BackgroundStatus } from "../shared/contracts";
import { serviceName } from "./background";

function native(program: string, args: string[], env?: Record<string, string>): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, shell: false, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Windows integration timed out.")); }, 10000);
    child.stdout.on("data", b => { output = (output + String(b)).slice(-16384); });
    child.stderr.on("data", () => {});
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("close", code => { clearTimeout(timer); resolve({ code: code ?? 1, text: output.trim() }); });
  });
}
export async function explorerIntegration(executable: string, enabled: boolean) {
  if (process.platform !== "win32") throw new Error("Explorer integration requires Windows.");
  const script = `
$ErrorActionPreference = 'Stop'
$sentryKey = 'HKCU:\\Software\\Classes\\*\\shell\\SentryHistory'
if ($env:SENTRY_EXPLORER_ENABLED -eq '1') {
  New-Item -Path $sentryKey -Force | Out-Null
  Set-Item -LiteralPath $sentryKey -Value 'View history in Sentry'
  Set-ItemProperty -LiteralPath $sentryKey -Name Icon -Value $env:SENTRY_EXECUTABLE
  New-Item -Path ($sentryKey + '\\command') -Force | Out-Null
  Set-Item -LiteralPath ($sentryKey + '\\command') -Value ('"' + $env:SENTRY_EXECUTABLE + '" --history "%1"')
} elseif (Test-Path -LiteralPath $sentryKey) { Remove-Item -LiteralPath $sentryKey -Recurse }
`;
  const result = await native("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { SENTRY_EXECUTABLE: executable, SENTRY_EXPLORER_ENABLED: enabled ? "1" : "0" });
  if (result.code !== 0) throw new Error("Explorer integration could not be updated.");
  return true;
}
export async function backgroundStatus(data: string, connected: boolean): Promise<BackgroundStatus> {
  if (connected) return { mode: "service", installed: true, detail: "Connected to the Windows service. Protection continues after the desktop app closes and while signed out." };
  const result = await native("sc.exe", ["query", serviceName(data)]);
  return { mode: "desktop", installed: result.code === 0, detail: result.code === 0 ? "A service is installed, but this window is using desktop protection. Quit Sentry, start the service, then reopen Sentry." : "Desktop protection stops when Sentry quits or you sign out. Export setup to install the optional Windows service." };
}
