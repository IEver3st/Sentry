import { createServer, createConnection, type Socket, type Server } from "node:net";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Request, State } from "../shared/contracts";
import { requestSchema } from "../shared/contracts";

export function serviceName(data: string) { return "Sentry-" + createHash("sha256").update(data.toLowerCase()).digest("hex").slice(0, 16); }
const endpoint = (data: string) => process.platform === "win32" ? `\\\\.\\pipe\\${serviceName(data)}` : join(data, "background.sock");
const tokenPath = (data: string) => join(data, "background-token");
const MAX_MESSAGE = 16 * 1024 * 1024;
async function protectToken(file: string) {
  if (process.platform !== "win32") return;
  const script = `$ErrorActionPreference='Stop'; $sentryAcl=[IO.File]::GetAccessControl($env:SENTRY_TOKEN_FILE); $sentryUser=[Security.Principal.WindowsIdentity]::GetCurrent().User; $sentryAcl.SetAccessRuleProtection($true,$false); foreach($sentryExisting in @($sentryAcl.Access)) { [void]$sentryAcl.RemoveAccessRuleAll($sentryExisting) }; foreach($sentrySid in @($sentryUser.Value,'S-1-5-18','S-1-5-32-544')) { $sentryRule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sentrySid),'FullControl','Allow'); $sentryAcl.AddAccessRule($sentryRule) }; [IO.File]::SetAccessControl($env:SENTRY_TOKEN_FILE,$sentryAcl)`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { shell: false, windowsHide: true, env: { ...process.env, SENTRY_TOKEN_FILE: file }, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Could not secure background authentication.")); }, 10000);
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("Could not secure background authentication.")); });
  });
}
const proof = (token: string, challenge: string) => createHmac("sha256", token).update(challenge).digest("hex");
function equalProof(expected: string, value: unknown) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(expected), Buffer.from(value)); }
function reader(socket: Socket, receive: (value: Record<string, unknown>) => void) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", chunk => {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer) > MAX_MESSAGE) { socket.destroy(); return; }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const value = JSON.parse(line) as Record<string, unknown>; if (!value || typeof value !== "object") throw new Error(); receive(value); }
      catch { socket.destroy(); return; }
    }
  });
}
function send(socket: Socket, value: unknown) {
  if (!socket.destroyed && socket.writableLength < MAX_MESSAGE) socket.write(JSON.stringify(value) + "\n");
  else socket.destroy();
}
export class BackgroundServer {
  private server?: Server;
  private clients = new Set<Socket>();
  constructor(private data: string, private mode: "desktop" | "service", private request: (request: Request) => Promise<unknown>, private state: () => State | undefined) {}
  async listen() {
    await mkdir(this.data, { recursive: true });
    let token: string;
    try { token = await readFile(tokenPath(this.data), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; token = randomBytes(32).toString("hex"); try { await writeFile(tokenPath(this.data), token, { flag: "wx", mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; token = await readFile(tokenPath(this.data), "utf8"); } }
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Background authentication file is invalid. Original file was preserved.");
    await protectToken(tokenPath(this.data));
    this.server = createServer(socket => {
      let authenticated = false;
      let challenge: string | undefined;
      const timer = setTimeout(() => { if (!authenticated) socket.destroy(); }, 3000);
      socket.on("error", () => {});
      socket.on("close", () => { clearTimeout(timer); this.clients.delete(socket); });
      reader(socket, message => {
        if (!authenticated) {
          if (!challenge && typeof message.nonce === "string" && /^[a-f0-9]{64}$/.test(message.nonce)) {
            challenge = randomBytes(32).toString("hex");
            send(socket, { kind: "challenge", nonce: challenge, proof: proof(token, message.nonce + ":server") }); return;
          }
          if (!challenge || !equalProof(proof(token, challenge + ":client"), message.proof)) { socket.destroy(); return; }
          authenticated = true; clearTimeout(timer); this.clients.add(socket);
          send(socket, { kind: "hello", mode: this.mode, state: this.state() });
          return;
        }
        if (typeof message.id !== "string" || message.id.length > 64) { socket.destroy(); return; }
        const id = message.id;
        const parsed = requestSchema.safeParse(message.request);
        if (!parsed.success || ["window", "choose-path", "updates", "background-service", "explorer-integration"].includes(parsed.data.type)) { send(socket, { kind: "response", id, error: "Unsupported background request." }); return; }
        void this.request(parsed.data).then(value => send(socket, { kind: "response", id, value })).catch(() => send(socket, { kind: "response", id, error: "The background operation failed. Check Activity or reconnect the repository." }));
      });
    });
    await new Promise<void>((resolve, reject) => { this.server!.once("error", reject); this.server!.listen(endpoint(this.data), () => { this.server!.removeListener("error", reject); this.server!.on("error", () => {}); resolve(); }); });
  }
  publish(state: State) { for (const socket of this.clients) send(socket, { kind: "state", value: state }); }
  async close() { for (const socket of this.clients) socket.destroy(); if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve())); }
}

export class BackgroundClient {
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private socket?: Socket;
  mode: "desktop" | "service" = "service";
  connected = false;
  constructor(private data: string, private publish: (state: State) => void, private disconnected: () => void) {}
  async connect(): Promise<boolean> {
    let token: string;
    try { token = await readFile(tokenPath(this.data), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    return new Promise<boolean>((resolve, reject) => {
      const socket = createConnection(endpoint(this.data)); this.socket = socket;
      let settled = false;
      let verifiedServer = false;
      const nonce = randomBytes(32).toString("hex");
      const timer = setTimeout(() => { if (!settled) { settled = true; socket.destroy(); reject(new Error("Background service did not authenticate. It may still own your backup catalog.")); } }, 4000);
      socket.on("connect", () => send(socket, { nonce }));
      socket.on("error", (error: NodeJS.ErrnoException) => {
        if (!settled) { settled = true; clearTimeout(timer); if (["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")) resolve(false); else reject(error); }
      });
      socket.on("close", () => {
        this.connected = false;
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error("Background service rejected authentication.")); }
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("Background service disconnected. Reopen Sentry to reconnect.")); } this.pending.clear();
        this.disconnected();
      });
      reader(socket, message => {
        if (message.kind === "challenge" && !verifiedServer && typeof message.nonce === "string" && /^[a-f0-9]{64}$/.test(message.nonce) && equalProof(proof(token, nonce + ":server"), message.proof)) { verifiedServer = true; send(socket, { proof: proof(token, message.nonce + ":client") }); return; }
        if (!verifiedServer) { socket.destroy(); return; }
        if (message.kind === "hello" && !settled) { settled = true; clearTimeout(timer); this.connected = true; this.mode = message.mode === "service" ? "service" : "desktop"; if (message.state) this.publish(message.state as State); resolve(true); }
        if (message.kind === "state") this.publish(message.value as State);
        if (message.kind === "response") { const p = this.pending.get(String(message.id)); if (!p) return; clearTimeout(p.timer); this.pending.delete(String(message.id)); if (message.error) p.reject(new Error(String(message.error))); else p.resolve(message.value); }
      });
    });
  }
  request(request: Request): Promise<unknown> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("Background service is disconnected. Reopen Sentry to reconnect."));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("The background request timed out. Check Activity before retrying.")); }, 10 * 60_000); this.pending.set(id, { resolve, reject, timer }); send(this.socket!, { id, request }); });
  }
  close() { this.socket?.destroy(); }
}

export async function exportServiceSetup(folder: string, resources: string, data: string, executable: string) {
  // The setup installs under the same Windows account, preserving user-scoped DPAPI.
  // It never serializes credentials or changes the system just by exporting.
  await mkdir(folder, { recursive: true });
  if ((await readdir(folder)).length) throw new Error("Choose an empty folder for the service setup export.");
  await copyFile(join(resources, "SentryService.exe"), join(folder, "SentryService.exe"));
  await copyFile(join(resources, "service-setup.ps1"), join(folder, "service-setup.ps1"));
  await writeFile(join(folder, "service-config.json"), JSON.stringify({ name: serviceName(data), data, executable }, null, 2), { flag: "wx" });
}
