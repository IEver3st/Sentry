# Onboarding

## Visual contract

Surface/job: guide a new installation through its first real backup plan. Authority: the user's revised Apple-informed brief and Switchboard onboarding reference supersede the initial split-panel blueprint direction. DESIGN.md still owns theme, Windows typography and native shell. First viewport: a bounded, centered setup composition with a quiet horizontal progress trail, one focused task and an adjacent action. Five steps: welcome, sources, destination, schedule, review; a saved-plan handoff distinguishes configuration from completed protection.

Composition: one centered 570px form workspace, 640px welcome composition, 480px form measure. Welcome uses 42px type, dimensional Sentry ribbon artwork flanked by document/photo sheets, one short description, three compact capability labels and a centered Get started action. Subsequent steps use 32px headings, small custom material SVGs and labeled controls. Blue accent and graphite surfaces continue the app identity; light mode changes paper and ink tokens. Two low-contrast curved ribbon groups drift behind the workspace, with staged transform/opacity artwork entrances. No split panel, blueprint grid, duplicated branding, giant heading focus box, or distant viewport-edge action. No new dependency or invented operational data.

Critical states: empty sources, unavailable destination, repository errors, save pending/failure, skipped setup, saved but not backed up, long paths, dark/light. At 1180×780, 820×600, 2560×1390 and 200% zoom, the bounded composition remains centered when it fits and a single content owner scrolls when it does not. Actions follow content; repository creation owns its own save/cancel controls. Motion uses CSS transform/opacity, an explicit pause control, reduced-motion equivalence and hidden-document pause.

## Primary design references

- [Apple: Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding): brief, optional, interactive setup and deferred nonessential customization.
- [Apple: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles): focused hierarchy, agency, concise language and deliberate craft.
- [Apple: Motion](https://developer.apple.com/design/human-interface-guidelines/motion): purposeful, interruptible and optional motion.
- [Apple: Layout](https://developer.apple.com/design/human-interface-guidelines/layout): bounded reading measures, related controls grouped together and adaptation across window sizes.
- Switchboard `design-qa/onboarding-redesign/welcome-1420x900.png` and `onboarding-flow.tsx`: a centered setup workspace and brief forward reveals. Inspected read-only.

Apple documentation was read from its official DocC JSON after the standard HTML pages returned a JavaScript-required shell.

## Module boundaries

- `model.ts`: ordered step definitions, validation and fresh-install eligibility.
- `Onboarding.tsx`: draft lifecycle, navigation, validated IPC and handoff.
- `steps.tsx`: focused step components; destination credentials stay in the existing `DestinationForm`.
- `SetupIllustration.tsx`: decorative SVG scenes, independent of operational state.
- `onboarding.css`: scoped layout, theme-aware materials and motion.

Adding a step means updating the typed step registry, its content renderer and any forward validation. Draft plan fields stay in the controller when moving backward. Unsaved drafts are intentionally discarded on exit; created repositories remain connected. The persisted dismissal preference uses existing engine-owned settings. Existing plans, destinations or job history suppress automatic onboarding. No repository creation, plan save or job is represented as completed protection.
