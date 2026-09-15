import { expect, test } from "bun:test";
import { defaults, settingsSchema } from "../src/shared/contracts";
test("existing settings migrate to default scale without changing backup preferences", () => {
  const legacy = { ...defaults, paused: true, bandwidthKiB: 512, uiScale: undefined };
  const migrated = settingsSchema.parse(legacy);
  expect(migrated.uiScale).toBe(100);
  expect(migrated.paused).toBe(true);
  expect(migrated.bandwidthKiB).toBe(512);
});
test("scale rejects invalid and unsafe values at the settings boundary", () => {
  for (const uiScale of [0, 79, 201, 125.5, Infinity, NaN, "150"])
    expect(settingsSchema.safeParse({ ...defaults, uiScale }).success).toBe(false);
  for (const uiScale of [80, 100, 115, 125, 200])
    expect(settingsSchema.parse({ ...defaults, uiScale }).uiScale).toBe(uiScale);
});
