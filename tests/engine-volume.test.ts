import { test, expect } from "bun:test";
import path from "node:path";
import {
  inspectVolume,
  relocateVolume,
  sharesPhysicalDisk,
} from "../src/engine/volume";

test("Windows volume discovery is read-only and reconnects only the recorded identity", async () => {
  const location = path.resolve(".");
  const volume = await inspectVolume(location);
  console.log(
    "Read-only Windows volume result:",
    volume ?? "platform did not expose a volume identity",
  );
  if (volume) {
    expect(await relocateVolume(location, volume.volumeId)).toBe(location);
    expect(
      await relocateVolume(location, "not-a-real-volume-id"),
    ).toBeUndefined();
    if (volume.diskNumber !== undefined)
      expect(
        await sharesPhysicalDisk(location, path.join(location, "fixture")),
      ).toBe(true);
  }
  expect(await inspectVolume("\\\\server\\share")).toBeUndefined();
  expect(
    await sharesPhysicalDisk(location, "\\\\server\\share"),
  ).toBeUndefined();
}, 40_000);
