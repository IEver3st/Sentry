import { go, useApp } from './store'

/** Exposes app state to the headless capture harness (npm run capture). Inert otherwise. */
export function installCaptureHooks(): void {
  if (!new URLSearchParams(location.search).has('capture')) return
  ;(window as unknown as { __sentry: unknown }).__sentry = { useApp, go }
}
