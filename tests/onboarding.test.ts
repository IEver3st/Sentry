import { expect, test } from "bun:test";
import { defaults, settingsSchema, type State } from "../src/shared/contracts";
import { setupError, shouldStartOnboarding } from "../src/renderer/onboarding/model";
import { newPlan } from "../src/renderer/PlanEditor";

const fresh = { settings: defaults, plans: [], jobs: [], destinations: [] } as unknown as State;
test("onboarding only auto-opens for an untouched installation", () => {
  expect(shouldStartOnboarding(fresh)).toBe(true);
  expect(shouldStartOnboarding({ ...fresh, settings: { ...defaults, onboardingDismissed: true } })).toBe(false);
  for (const key of ["plans", "destinations", "jobs"] as const)
    expect(shouldStartOnboarding({ ...fresh, [key]: [{}] } as State)).toBe(false);
  expect(settingsSchema.parse({ ...defaults, onboardingDismissed: true }).onboardingDismissed).toBe(true);
  expect(settingsSchema.parse(defaults).onboardingDismissed).toBeUndefined();
});
test("review rejects a missing or disconnected destination even after earlier selection", () => {
  const plan = { ...newPlan(), name: "Documents", sources: ["C:\\Documents"], destinationIds: ["drive"] };
  expect(setupError("review", plan, fresh)).toContain("unavailable");
  const state = { ...fresh, destinations: [{ id: "drive", status: "ready" }] } as State;
  expect(setupError("review", plan, state)).toBeUndefined();
  expect(setupError("review", { ...plan, sources: [] }, state)).toContain("at least one");
  expect(setupError("review", { ...plan, sources: ["bad\npath"] }, state)).toBe("Invalid path");
  expect(setupError("sources", { ...plan, name: "  " }, state)).toContain("name");
});
