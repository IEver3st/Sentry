import { useState } from 'react'
import { api, errorMessage, useApp } from '@/lib/store'
import { Spinner } from './ui'

/** Google's own sign-in button shape: white, G mark, plain label. */
export function GoogleButton({ onClick, disabled, busy, label = 'Continue with Google' }: { onClick: () => void; disabled?: boolean; busy?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 items-center gap-3 rounded-lg bg-white pr-5 pl-3.5 text-[14.5px] font-medium text-[#1f1f1f] transition-colors hover:bg-[#f1f3f4] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35"
    >
      {busy ? <Spinner size={18} /> : <GoogleMark />}
      {label}
    </button>
  )
}

export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <span className="grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  )
}

/**
 * Google sign-in needs a Desktop OAuth client file once. This is the quiet inline way to add it,
 * shown next to a disabled Google button instead of a separate setup screen.
 */
export function GoogleSetupNote({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importClient = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      useApp.setState({ status: await api().importGoogleClient() })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="text-[12.5px] text-fog-500">
      Needs a one-time Google setup file.{' '}
      <button onClick={importClient} disabled={disabled || busy} className="font-medium text-amber hover:underline hover:underline-offset-4 disabled:opacity-50">
        {busy ? 'Importing…' : 'Import client JSON'}
      </button>
      {error && <span className="mt-1 block text-rose">{error}</span>}
    </span>
  )
}
