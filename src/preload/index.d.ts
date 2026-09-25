import type { SentryApi } from '../shared/types'

declare global {
  interface Window {
    sentry: SentryApi
  }
}
