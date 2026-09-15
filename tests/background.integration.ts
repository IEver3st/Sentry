import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { BackgroundClient, BackgroundServer } from "../src/main/background";
import { defaults, type State } from "../src/shared/contracts";

test("background connection authenticates both peers, excludes native actions and survives a client closing", { timeout: 15000 }, async () => {
  await mkdir("outputs/background-fixture", { recursive: true });
  const data = await mkdtemp(resolve("outputs/background-fixture/run-"));
  const state: State = { plans: [], destinations: [], jobs: [], protection: [], settings: defaults, weather: { alerts: 0 }, engineVersion: "fixture", busy: false, googleConfigured: false, googleConnected: false, update: { status: "idle" } };
  let requests = 0;
  const server = new BackgroundServer(data, "service", async () => { requests++; return state; }, () => state);
  const client = new BackgroundClient(data, () => {}, () => {});
  const second = new BackgroundClient(data, () => {}, () => {});
  await server.listen();
  try {
    assert.equal(await client.connect(), true);
    assert.equal(client.mode, "service");
    assert.equal((await client.request({ type: "state" }) as State).engineVersion, "fixture");
    await assert.rejects(client.request({ type: "window", action: "quit" }), /Unsupported/);
    assert.equal(requests, 1);
    const token = await readFile(join(data, "background-token"), "utf8");
    await writeFile(join(data, "background-token"), "0".repeat(64));
    await assert.rejects(second.connect());
    assert.equal(requests, 1);
    await writeFile(join(data, "background-token"), token);
    client.close();
    const reopened = new BackgroundClient(data, () => {}, () => {});
    try { assert.equal(await reopened.connect(), true); assert.deepEqual(await reopened.request({ type: "state" }), state); }
    finally { reopened.close(); }
  } finally { client.close(); second.close(); await server.close(); }
});

test("only one background host can own a profile", { timeout: 10000 }, async () => {
  await mkdir("outputs/background-fixture", { recursive: true });
  const data = await mkdtemp(resolve("outputs/background-fixture/owner-"));
  const first = new BackgroundServer(data, "desktop", async () => true, () => undefined);
  const second = new BackgroundServer(data, "service", async () => true, () => undefined);
  await first.listen();
  try { await assert.rejects(second.listen()); }
  finally { await first.close(); await second.close(); }
});
