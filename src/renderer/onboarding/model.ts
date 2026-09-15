import { planSchema, type Plan, type State } from "../../shared/contracts";

export const setupSteps = [
  { id: "welcome", label: "Welcome", title: "Welcome to Sentry.", description: "A safe place for a second copy. Set up a backup for the files you’d miss most.", caption: "Your files. A separate copy. A way to recover." },
  { id: "sources", label: "Your files", title: "Start with what matters.", description: "Choose the files and folders for your first backup plan. You can add more plans later.", caption: "One plan can bring several folders together." },
  { id: "destination", label: "Destination", title: "Choose their second home.", description: "Connect a drive or choose where to keep your encrypted backups.", caption: "Keep the copy separate from the original." },
  { id: "schedule", label: "Schedule", title: "On your schedule.", description: "Choose a routine that works for you. Sentry runs backups while the app is open and your destination is available.", caption: "A repeatable routine. Recoverable versions." },
  { id: "review", label: "Review", title: "One last look.", description: "Check your plan before saving. Saving a plan does not mean your files have been backed up.", caption: "Know what is copied, where it lives, and when." },
] as const;
export type SetupStep = (typeof setupSteps)[number]["id"];
export function shouldStartOnboarding(state: State): boolean {
  return !state.settings.onboardingDismissed && !state.plans.length && !state.destinations.length && !state.jobs.length;
}
export function setupError(step: SetupStep, plan: Plan, state: State): string | undefined {
  if (step === "sources" || step === "review") {
    if (!plan.name.trim()) return "Give your backup plan a name.";
    if (!plan.sources.length) return "Choose at least one file or folder to back up.";
  }
  if (step === "destination" || step === "review") {
    if (!plan.destinationIds.length) return "Choose a destination for this plan.";
    if (plan.destinationIds.some((id) => !state.destinations.some((d) => d.id === id && d.status === "ready")))
      return "The selected destination is unavailable. Connect it or choose another destination.";
  }
  if (step === "schedule" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.schedule.time)) return "Choose a valid backup time.";
  if (step === "review") {
    const result = planSchema.safeParse(plan);
    if (!result.success) return result.error.issues[0]?.message ?? "Check your plan details.";
  }
}
