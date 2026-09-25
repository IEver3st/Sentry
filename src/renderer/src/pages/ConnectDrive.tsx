import { useState } from 'react'
import { CloudDownload, CloudUpload, LayoutGrid, Link2 } from 'lucide-react'
import { api, connectDrive, go, useApp } from '@/lib/store'
import { useSize } from '@/lib/hooks'
import { Mosaic } from '@/components/Mosaic'
import { GoogleButton, GoogleSetupNote } from '@/components/GoogleButton'
import { Button } from '@/components/ui'

const PERKS = [
  { icon: CloudUpload, text: 'Drop files into Drive from anywhere, including right-click in File Explorer' },
  { icon: CloudDownload, text: 'Pull anything back down to this PC' },
  { icon: Link2, text: 'Share a link in two clicks, and keep track of every live link' },
  { icon: LayoutGrid, text: 'See what fills your Google plan with the same map as this PC' }
]

/** Shown in local-only mode wherever a Drive feature would be. Adding Drive is always optional. */
export function ConnectDrive() {
  const status = useApp((s) => s.status)!
  const [busy, setBusy] = useState<'google' | 'demo' | null>(null)
  const [ref, size] = useSize<HTMLDivElement>()

  const connect = async (provider: 'google' | 'demo'): Promise<void> => {
    setBusy(provider)
    await connectDrive(provider)
    setBusy(null)
  }

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <section className="flex flex-col justify-center overflow-y-auto px-12 py-10">
        <div className="max-w-[460px]">
          <p className="text-[12px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Google Drive · optional</p>
          <h1 className="mt-3 text-[34px] leading-[1.1] font-semibold tracking-[-0.025em]">Bring your Drive in alongside this PC</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fog-300">
            Sentry maps this PC on its own. Connect Google Drive when you want your cloud storage here too.
          </p>

          <ul className="mt-7 flex flex-col gap-3.5">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-[14px] text-fog-300">
                <Icon size={17} className="mt-0.5 shrink-0 text-amber" strokeWidth={1.8} />
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-col items-start gap-3">
            <GoogleButton busy={busy === 'google'} disabled={!status.googleConfigured || busy !== null} onClick={() => connect('google')} />
            {!status.googleConfigured && <GoogleSetupNote disabled={busy !== null} />}
            {busy === 'google' && (
              <span className="flex items-center gap-3 text-[13px] text-fog-400">
                Finish signing in in your browser.
                <Button variant="ghost" size="sm" onClick={() => void api().cancelGoogleSignIn()}>
                  Cancel
                </Button>
              </span>
            )}
          </div>

          <div className="mt-8 flex items-center gap-5 border-t border-white/[0.06] pt-5 text-[13.5px]">
            <button onClick={() => connect('demo')} disabled={busy !== null} className="text-fog-300 hover:text-fog-100 hover:underline hover:underline-offset-4 disabled:opacity-40">
              Explore a demo drive
            </button>
            <button onClick={() => go('map')} className="text-fog-400 hover:text-fog-100 hover:underline hover:underline-offset-4">
              Back to This PC
            </button>
          </div>
        </div>
      </section>
      <section className="hidden flex-col bg-ink-850 p-8 lg:flex">
        <div ref={ref} className="relative min-h-0 flex-1">
          {size.width > 0 && <Mosaic emphasis={['media', 'documents', 'archives']} width={size.width} height={size.height} />}
        </div>
      </section>
    </div>
  )
}
