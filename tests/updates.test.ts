import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { SoftwareUpdates } from "../src/main/updates";
function fixture(enabled = true) {
  const driver = Object.assign(new EventEmitter(), {
    autoDownload: false, autoInstallOnAppQuit: true, allowPrerelease: true, allowDowngrade: true, logger: null,
    checks: 0,
    async checkForUpdates() { this.checks++; return null; },
    quitAndInstall() {},
  });
  const updates = new SoftwareUpdates(enabled, () => {}, driver as unknown as ConstructorParameters<typeof SoftwareUpdates>[2]);
  return { updates, driver };
}
test("development never checks; automatic installation and downgrade stay disabled", async () => {
  const { updates, driver } = fixture(false);
  await updates.check();
  expect(driver.checks).toBe(0);
  expect(updates.state.status).toBe("unavailable");
  expect(driver.autoInstallOnAppQuit).toBe(false);
  expect(driver.allowDowngrade).toBe(false);
  expect(driver.allowPrerelease).toBe(false);
});
test("download completion alone permits restart; checks cannot replace a ready update", async () => {
  const { updates, driver } = fixture();
  driver.emit("update-available", { version: "0.2.0" });
  expect(updates.state.status).toBe("downloading");
  driver.emit("download-progress", { percent: 52.1 });
  expect(updates.state.progress).toBe(52.1);
  driver.emit("update-downloaded", { version: "0.2.0" });
  await updates.check();
  expect(driver.checks).toBe(0);
  expect(updates.state).toEqual({ status: "ready", version: "0.2.0" });
});
test("network failures are retryable and raw provider errors never enter UI", async () => {
  const { updates, driver } = fixture();
  driver.emit("error", new Error("private provider details"));
  expect(updates.state.status).toBe("error");
  expect(updates.state.message).not.toContain("private provider");
  await updates.check();
  expect(driver.checks).toBe(1);
});
