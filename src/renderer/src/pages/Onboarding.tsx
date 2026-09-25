import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Lock, Monitor } from 'lucide-react'
import type { MapCategory } from '@shared/types'
import { api, errorMessage, scanMap, useApp } from '@/lib/store'
import { useSize } from '@/lib/hooks'
import { Mosaic } from '@/components/Mosaic'
import { GoogleMark, GoogleSetupNote } from '@/components/GoogleButton'
import { Button, cx, Logo, Spinner } from '@/components/ui'

const STEPS = ['welcome', 'name', 'connect', 'setup', 'ready'] as const
type Step = (typeof STEPS)[number]

const EMPHASIS: Record<Step, MapCategory[] | 'all'> = {
  welcome: 'all',
  name: ['media', 'documents'],
  connect: ['documents', 'media', 'archives'],
  setup: ['cache', 'code', 'games'],
  ready: 'all'
}

const CAPTION: Record<Step, { title: string; body: string }> = {
  welcome: { title: 'Every box is space', body: 'Bigger tile, more room it takes. That’s the whole map.' },
  name: { title: 'Your stuff, at a glance', body: 'Photos, documents, projects. Grouped the way you’d think about them.' },
  connect: { title: 'This PC, the cloud, or both', body: 'Sentry maps your PC on its own. Google Drive is an optional extra you can add anytime.' },
  setup: { title: 'Striped means safe to clear', body: 'Caches and build output on this PC show up hatched so they’re easy to spot.' },
  ready: { title: 'All yours', body: 'Drop files in, pull them out, share links. That’s it.' }
}

const slide = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  animate: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28 })
}

export function Onboarding() {
  const boot = useApp((s) => s.boot)!
  const settings = useApp((s) => s.settings)!
  const status = useApp((s) => s.status)!
  const [index, setIndex] = useState(settings.onboarded && !status.connected ? 2 : 0)
  const [dir, setDir] = useState(1)
  const [name, setName] = useState(settings.name)
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir)
  const [scanRoot, setScanRoot] = useState(settings.scanRoot)
  const [connecting, setConnecting] = useState<'google' | 'demo' | 'local' | null>(null)
  /** Which path the user took at the fork: a drive, or this PC only. */
  const [mode, setMode] = useState<'drive' | 'local'>(status.connected ? 'drive' : 'local')
  const [connectError, setConnectError] = useState<string | null>(status.connectionError ?? null)
  const [visualRef, size] = useSize<HTMLDivElement>()

  const step = STEPS[index]
  const move = (d: number): void => {
    setDir(d)
    setIndex((i) => Math.max(0, Math.min(STEPS.length - 1, i + d)))
  }

  const connect = async (provider: 'google' | 'demo'): Promise<void> => {
    setConnecting(provider)
    setConnectError(null)
    try {
      await api().updateSettings({ name: name.trim() })
      const s = await api().connect(provider)
      if (!s.connected) throw new Error('Connected, but Drive didn’t answer. Try again in a moment.')
      const next = await api().bootstrap()
      useApp.setState({ boot: next, settings: next.settings, status: s, maps: { drive: null, local: null }, quota: null, folderId: null })
      if (s.account && !name.trim()) setName(s.account.displayName.split(' ')[0])
      setMode('drive')
      move(1)
    } catch (error) {
      setConnectError(errorMessage(error))
    } finally {
      setConnecting(null)
    }
  }

  /** No drive: Sentry maps this PC. Clears a stale drive session so nothing half-connected lingers. */
  const chooseLocal = async (): Promise<void> => {
    setConnecting('local')
    setConnectError(null)
    try {
      await api().updateSettings({ name: name.trim() })
      if (status.provider) {
        const s = await api().disconnect()
        useApp.setState({ status: s, quota: null, maps: { drive: null, local: null } })
      }
      setMode('local')
      move(1)
    } catch (error) {
      setConnectError(errorMessage(error))
    } finally {
      setConnecting(null)
    }
  }

  const finish = async (): Promise<void> => {
    const next = await api().updateSettings({ onboarded: true, name: name.trim(), downloadDir, scanRoot })
    const local = mode === 'local'
    useApp.setState({ settings: next, justOnboarded: true, route: local ? 'map' : (next.startPage ?? 'home'), maps: { ...useApp.getState().maps, local: null } })
    // Start mapping straight away so the first screen has something real on it.
    if (local) void scanMap('local')
  }

  const disconnectGoogle = async (): Promise<void> => {
    setConnecting('google')
    setConnectError(null)
    try {
      await api().disconnect()
      const next = await api().bootstrap()
      useApp.setState({ boot: next, settings: next.settings, status: next.status, quota: null, maps: { drive: null, local: null }, folderId: null })
    } catch (error) { setConnectError(errorMessage(error)) }
    finally { setConnecting(null) }
  }

  const pick = async (current: string, set: (v: string) => void): Promise<void> => {
    const p = await api().pickDirectory(current)
    if (p) set(p)
  }

  const firstName = name.trim() || status.account?.displayName.split(' ')[0] || ''

  return (
    <div className="grid h-full grid-cols-[minmax(420px,5fr)_7fr] bg-ink-950">
      {/* Left: the conversation */}
      <section className="relative flex flex-col px-14 pt-5 pb-10">
        <div className="drag flex h-8 items-center gap-2.5">
          <Logo size={18} animate />
          <span className="text-[14.5px] font-semibold tracking-tight">Sentry</span>
        </div>

        <div className="mt-10 flex gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <motion.span
              key={s}
              className={cx('h-1 rounded-full transition-colors duration-300', i <= index ? 'bg-amber' : 'bg-white/10')}
              animate={{ width: i === index ? 28 : 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          ))}
        </div>

        <div className="relative flex flex-1 flex-col justify-center">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-[440px]"
            >
              {step === 'welcome' && (
                <>
                  <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.03em]">
                    Your Drive,
                    <br />
                    <span className="text-amber">right here.</span>
                  </h1>
                  <p className="mt-5 text-[16px] leading-relaxed text-fog-300">
                    Sentry puts the Google Drive storage you already pay for on your desktop. Drop files in, pull them back, share a link,
                    and see exactly where your space goes.
                  </p>
                  <Button variant="primary" size="lg" className="mt-9" onClick={() => move(1)} autoFocus>
                    Let’s go <ArrowRight size={17} />
                  </Button>
                </>
              )}

              {step === 'name' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    move(1)
                  }}
                >
                  <h1 className="text-[34px] leading-tight font-semibold tracking-[-0.02em]">What should we call you?</h1>
                  <p className="mt-3 text-fog-400">Just for the greeting. It stays on this computer.</p>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your first name"
                    maxLength={40}
                    aria-label="Your first name"
                    className="mt-8 h-14 w-full rounded-xl border border-white/[0.08] bg-ink-800 px-4 text-[20px] font-medium outline-none placeholder:text-fog-500 focus:border-amber/50"
                  />
                  <div className="mt-8 flex items-center gap-3">
                    <Button type="button" variant="ghost" size="lg" onClick={() => move(-1)} aria-label="Back">
                      <ArrowLeft size={17} />
                    </Button>
                    <Button type="submit" variant="primary" size="lg">
                      {name.trim() ? `Nice to meet you, ${name.trim()}` : 'Skip for now'} <ArrowRight size={17} />
                    </Button>
                  </div>
                </form>
              )}

              {step === 'connect' && (
                <>
                  <h1 className="text-[34px] leading-tight font-semibold tracking-[-0.02em]">How do you want to start?</h1>
                  <p className="mt-3 text-[15px] leading-relaxed text-fog-400">Pick one. You can add or remove Google Drive anytime.</p>

                  <div className="mt-8 flex flex-col gap-3">
                    <StartOption
                      icon={<Monitor size={24} strokeWidth={1.6} className="text-fog-300" />}
                      title="This PC only"
                      body="Map your disk, see what’s eating space, and clean it up safely."
                      busy={connecting === 'local'}
                      disabled={connecting !== null}
                      onClick={chooseLocal}
                      autoFocus={!status.googleConfigured}
                    />
                    <StartOption
                      icon={<GoogleMark size={22} />}
                      title="This PC and Google Drive"
                      body="Everything above, plus upload, pull files down, share links, and map your cloud storage."
                      busy={connecting === 'google'}
                      disabled={connecting !== null || !status.googleConfigured}
                      onClick={() => connect('google')}
                      footer={
                        connecting === 'google' ? (
                          <span className="flex items-center gap-3 text-fog-400">
                            Finish signing in in your browser.
                            <button onClick={() => void api().cancelGoogleSignIn()} className="font-medium text-fog-100 hover:underline hover:underline-offset-4">
                              Cancel
                            </button>
                          </span>
                        ) : !status.googleConfigured ? (
                          status.provider === 'google' ? (
                            <span className="text-fog-500">
                              Google client needs replacing.{' '}
                              <button onClick={disconnectGoogle} disabled={connecting !== null} className="font-medium text-amber hover:underline hover:underline-offset-4 disabled:opacity-50">
                                Disconnect to replace it
                              </button>
                            </span>
                          ) : (
                            <GoogleSetupNote disabled={connecting !== null} />
                          )
                        ) : null
                      }
                    />
                  </div>

                  {connectError && (
                    <p role="alert" className="mt-4 rounded-lg bg-rose/10 px-3 py-2 text-[13px] text-rose">
                      {connectError}
                    </p>
                  )}

                  <div className="mt-7 flex items-center gap-5 text-[13px]">
                    {!settings.onboarded && (
                      <button onClick={() => move(-1)} disabled={connecting !== null} className="flex items-center gap-1.5 text-fog-400 hover:text-fog-100 disabled:opacity-40">
                        <ArrowLeft size={14} /> Back
                      </button>
                    )}
                    <button
                      onClick={() => connect('demo')}
                      disabled={connecting !== null}
                      className="flex items-center gap-2 text-fog-400 hover:text-fog-100 disabled:opacity-40"
                    >
                      Try a demo drive {connecting === 'demo' && <Spinner size={13} />}
                    </button>
                    <span className="ml-auto flex items-center gap-1.5 text-fog-500">
                      <Lock size={12} /> Sign-ins stay encrypted on this PC
                    </span>
                  </div>
                </>
              )}

              {step === 'setup' && (
                <>
                  <h1 className="text-[34px] leading-tight font-semibold tracking-[-0.02em]">{mode === 'local' ? 'What should Sentry map?' : 'Two quick choices'}</h1>
                  <p className="mt-3 text-fog-400">
                    {mode === 'local' ? 'Your whole user folder is a good start. You can change it anytime.' : 'Both are easy to change later in Settings.'}
                  </p>
                  <dl className="mt-8 divide-y divide-white/[0.06] border-y border-white/[0.06]">
                    {mode === 'drive' && <FolderChoice title="Pulled files land in" path={downloadDir} onChange={() => pick(downloadDir, setDownloadDir)} />}
                    <FolderChoice title="Map this folder on your PC" path={scanRoot} onChange={() => pick(scanRoot, setScanRoot)} />
                  </dl>
                  <div className="mt-8 flex items-center gap-3">
                    <Button variant="ghost" size="lg" onClick={() => move(-1)} aria-label="Back">
                      <ArrowLeft size={17} />
                    </Button>
                    <Button variant="primary" size="lg" onClick={() => move(1)} autoFocus>
                      Looks good <ArrowRight size={17} />
                    </Button>
                  </div>
                </>
              )}

              {step === 'ready' && (
                <>
                  <motion.div
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.1 }}
                    className="grid size-14 place-items-center rounded-2xl bg-mint/15"
                  >
                    <Check size={28} className="text-mint" strokeWidth={2.5} />
                  </motion.div>
                  <h1 className="mt-6 text-[40px] leading-[1.08] font-semibold tracking-[-0.03em]">
                    You’re all set{firstName ? `, ${firstName}` : ''}.
                  </h1>
                  <p className="mt-4 text-[16px] leading-relaxed text-fog-300">
                    {mode === 'local'
                      ? 'Sentry will start mapping this PC right away. Add Google Drive whenever you like from the sidebar or Settings.'
                      : status.account?.provider === 'demo'
                        ? 'You’re on the demo drive. Uploads really work and stay on this PC until you connect Google.'
                        : `Connected as ${status.account?.email}. Your whole Drive is ready.`}
                  </p>
                  <Button variant="primary" size="lg" className="mt-9" onClick={finish} autoFocus>
                    {mode === 'local' ? 'Map this PC' : 'Open Sentry'} <ArrowRight size={17} />
                  </Button>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="text-[12px] text-fog-500">v{boot.version}</p>
      </section>

      {/* Right: the living map */}
      <section className="drag relative flex flex-col overflow-hidden bg-ink-900 p-8 pt-12">
        <div ref={visualRef} className="relative min-h-0 flex-1">
          {size.width > 0 && <Mosaic emphasis={EMPHASIS[step]} width={size.width} height={size.height} />}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mt-6 flex min-h-[64px] items-end justify-between gap-6"
          >
            <div>
              <p className="text-[18px] font-semibold tracking-tight">{CAPTION[step].title}</p>
              <p className="mt-1 text-[14px] text-fog-400">{CAPTION[step].body}</p>
            </div>
            <Legend emphasis={EMPHASIS[step]} />
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  )
}

function Legend({ emphasis }: { emphasis: MapCategory[] | 'all' }) {
  const items: Array<[MapCategory, string]> = [
    ['media', 'Media'],
    ['documents', 'Docs'],
    ['code', 'Projects'],
    ['archives', 'Backups'],
    ['cache', 'Clearable']
  ]
  return (
    <div className="flex shrink-0 gap-3.5 text-[12px] text-fog-400">
      {items.map(([c, label]) => (
        <span key={c} className={cx('flex items-center gap-1.5 transition-opacity', emphasis !== 'all' && !emphasis.includes(c) && 'opacity-40')}>
          <span className={cx('size-2.5 rounded-[2px]', c === 'cache' && 'hatch')} style={{ backgroundColor: `var(--color-cat-${c})` }} />
          {label}
        </span>
      ))}
    </div>
  )
}

/** One path at the start fork: the whole card is the action, with room for a note underneath. */
function StartOption({
  icon,
  title,
  body,
  busy,
  disabled,
  onClick,
  autoFocus,
  footer
}: {
  icon: ReactNode
  title: string
  body: string
  busy: boolean
  disabled: boolean
  onClick: () => void
  autoFocus?: boolean
  footer?: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-850 transition-colors has-[button:enabled:hover]:border-white/[0.14] has-[button:enabled:hover]:bg-ink-800">
      <button
        onClick={onClick}
        disabled={disabled}
        autoFocus={autoFocus}
        className="group flex w-full items-center gap-4 px-5 py-4.5 text-left disabled:cursor-default"
      >
        <span className="grid size-7 shrink-0 place-items-center transition-opacity group-disabled:opacity-40">{icon}</span>
        <span className="min-w-0 flex-1 transition-opacity group-disabled:opacity-40">
          <span className="block text-[15.5px] font-semibold tracking-tight text-fog-100">{title}</span>
          <span className="mt-1 block text-[13.5px] leading-snug text-fog-400">{body}</span>
        </span>
        {busy ? (
          <Spinner size={16} />
        ) : (
          <ArrowRight size={18} className="shrink-0 text-fog-500 transition-[color,transform] group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:text-fog-100 group-disabled:opacity-40" />
        )}
      </button>
      {footer && <div className="border-t border-white/[0.06] px-5 py-3 text-[12.5px]">{footer}</div>}
    </div>
  )
}

function FolderChoice({ title, path, onChange }: { title: string; path: string; onChange: () => void }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <dt className="text-[13px] text-fog-400">{title}</dt>
        <dd className="truncate text-[14.5px] font-medium" title={path} data-selectable>
          {path}
        </dd>
      </div>
      <button onClick={onChange} className="shrink-0 rounded-md px-1 text-[13.5px] font-medium text-amber hover:underline hover:underline-offset-4">
        Change
      </button>
    </div>
  )
}
