import { randomUUID } from "node:crypto";
import { BackupService, type ServiceOptions } from "./service";
let service: BackupService | undefined;
const hostPending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
function host(kind: string, data: Record<string, unknown>): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    hostPending.set(id, { resolve, reject });
    process.send?.({ kind, id, ...data });
  });
}
process.on("message", async (raw: unknown) => {
  const message = raw as Record<string, unknown>;
  if (message.kind === "host-response") {
    const id = String(message.id);
    const p = hostPending.get(id);
    hostPending.delete(id);
    if (message.error) p?.reject(new Error(String(message.error)));
    else p?.resolve(message.value);
    return;
  }
  if (message.kind === "init") {
    const options = message as unknown as Omit<ServiceOptions, "host">;
    service = new BackupService({
      ...options,
      host: {
        saveSecret: async (key, secret) => {
          await host("secret", { key, secret });
        },
        authorize: async (url) => {
          await host("authorize", { url });
        },
        publish: (state) => process.send?.({ kind: "state", value: state }),
      },
    });
    await service.start();
    return;
  }
  if (message.kind === "shutdown") {
    await service?.close();
    process.exit(0);
  }
  if (message.kind === "resume") {
    await service?.tick();
    return;
  }
  if (message.kind === "policy") {
    service?.setPolicy({
      battery: message.battery === true,
      idleSeconds: Number(message.idleSeconds),
      metered:
        typeof message.metered === "boolean" ? message.metered : undefined,
    });
    return;
  }
  if (message.kind === "request") {
    try {
      if (!service)
        throw new Error("Backup worker is starting. Try again shortly.");
      if ((message.request as { type?: string })?.type === "prepare-update") {
        await service.prepareUpdate();
        process.send?.({ kind: "response", id: message.id, value: true });
        return;
      }
      const value = await service.request(message.request);
      process.send?.({ kind: "response", id: message.id, value });
    } catch (error) {
      process.send?.({
        kind: "response",
        id: message.id,
        error: error instanceof Error ? error.message : "Operation failed.",
      });
    }
  }
});
process.on("disconnect", () => {
  void service?.close().finally(() => process.exit(0));
});
