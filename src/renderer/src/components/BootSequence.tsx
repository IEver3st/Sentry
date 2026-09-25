import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/**
 * Sentry's boot: tiles fly in and lock into the mark, a scan sweeps across it,
 * then the mark zooms through the camera as midnight dissolves into the app.
 * It never waits on itself: the hand-off plays as soon as the app is ready and
 * the mark has assembled. Any key or click skips ahead.
 */

const SIZE = 132
const U = SIZE / 22
const TILES = [
  { x: 0, y: 0, w: 13, h: 22, c: 'var(--color-amber)', from: { x: -260, y: -140, r: -24 } },
  { x: 15, y: 0, w: 7, h: 11, c: '#6f95e0', from: { x: 240, y: -190, r: 18 } },
  { x: 15, y: 13, w: 7, h: 4, c: '#a57de0', from: { x: 280, y: 90, r: -30 } },
  { x: 15, y: 19, w: 7, h: 3, c: '#4fb3b3', from: { x: 60, y: 230, r: 26 } }
]
/** Assembly + scan. After this the sequence only waits for the app. */
const MIN_MS = 1250

type Phase = 'assemble' | 'hold' | 'exit' | 'done'

export function BootSequence({ ready, enabled, onDone }: { ready: boolean; enabled: boolean | null; onDone: () => void }) {
  const systemReduce = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('assemble')
  const [minElapsed, setMinElapsed] = useState(false)
  const skipped = useRef(false)
  const quick = systemReduce || enabled === false

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), quick ? 0 : MIN_MS)
    return () => clearTimeout(t)
  }, [quick])

  useEffect(() => {
    if (phase !== 'assemble' && phase !== 'hold') return
    if (ready && (minElapsed || skipped.current)) setPhase('exit')
    else if (minElapsed) setPhase('hold')
  }, [ready, minElapsed, phase])

  useEffect(() => {
    const skip = (): void => {
      skipped.current = true
      if (ready) setPhase('exit')
    }
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [ready])

  useEffect(() => {
    if (phase !== 'exit') return
    const t = setTimeout(() => {
      setPhase('done')
      onDone()
    }, quick ? 220 : 720)
    return () => clearTimeout(t)
  }, [phase, quick, onDone])

  if (phase === 'done') return null
  const exiting = phase === 'exit'

  return (
    <motion.div
      aria-hidden
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden"
      style={{ backgroundColor: 'var(--color-ink-900)' }}
      initial={false}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: quick ? 0.2 : 0.55, delay: exiting && !quick ? 0.16 : 0, ease: [0.4, 0, 0.2, 1] }}
    >
      {quick ? (
        <StaticMark />
      ) : (
        <motion.div
          className="relative flex items-center gap-7"
          animate={exiting ? { scale: 14, opacity: 0 } : { scale: 1, opacity: 1 }}
          transition={exiting ? { duration: 0.7, ease: [0.7, 0, 0.84, 0], opacity: { duration: 0.45, delay: 0.2 } } : { duration: 0 }}
          // Zoom through the heart of the amber tile.
          style={{ transformOrigin: `${6.5 * U}px ${SIZE / 2}px` }}
        >
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            {TILES.map((t, i) => (
              <motion.div
                key={i}
                className="absolute overflow-hidden"
                style={{ left: t.x * U, top: t.y * U, width: t.w * U, height: t.h * U, backgroundColor: t.c, borderRadius: Math.min(9, (t.h * U) / 2) }}
                initial={{ x: t.from.x, y: t.from.y, rotate: t.from.r, scale: 0.35, opacity: 0 }}
                animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, filter: ['brightness(1)', 'brightness(1)', 'brightness(1.3)', 'brightness(1)'] }}
                transition={{
                  default: { type: 'spring', stiffness: 230, damping: 19, delay: 0.08 + i * 0.07 },
                  opacity: { duration: 0.2, delay: 0.08 + i * 0.07 },
                  filter: { duration: 0.5, times: [0, 0.01, 0.4, 1], delay: 0.72 + i * 0.07 }
                }}
              >
                {/* top light, as on map tiles */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgb(255 255 255 / 0.22), transparent 45%, rgb(0 0 0 / 0.12))' }} />
              </motion.div>
            ))}
            {/* Scan sweep across the assembled mark */}
            <motion.div
              className="pointer-events-none absolute inset-y-[-12px] w-10"
              style={{ background: 'linear-gradient(90deg, transparent, rgb(255 255 255 / 0.55), transparent)', mixBlendMode: 'overlay' }}
              initial={{ x: -60, opacity: 0 }}
              animate={{ x: SIZE + 30, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 0.55, delay: 0.66, ease: [0.45, 0, 0.55, 1] }}
            />
          </div>

          <div className="overflow-hidden">
            <motion.p
              className="text-[54px] leading-none font-semibold tracking-[-0.035em] text-fog-100"
              initial={{ clipPath: 'inset(0 100% 0 0)', x: -12 }}
              animate={{ clipPath: 'inset(0 0% 0 0)', x: 0 }}
              transition={{ duration: 0.55, delay: 0.62, ease: [0.22, 1, 0.36, 1] }}
            >
              Sentry
            </motion.p>
            <motion.p
              className="mt-2.5 text-[15px] text-fog-400"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.88 }}
            >
              Your Drive, right here.
            </motion.p>
          </div>
        </motion.div>
      )}

      {/* Only appears if the app genuinely takes longer than the animation. */}
      <AnimatePresence>
        {phase === 'hold' && !quick && (
          <motion.div
            className="absolute bottom-[18%] h-[2px] w-40 overflow-hidden rounded-full bg-white/[0.06]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.4 }}
          >
            <div className="indeterminate h-full" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StaticMark() {
  return (
    <div className="flex items-center gap-7">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {TILES.map((t, i) => (
          <div
            key={i}
            className="absolute"
            style={{ left: t.x * U, top: t.y * U, width: t.w * U, height: t.h * U, backgroundColor: t.c, borderRadius: Math.min(9, (t.h * U) / 2) }}
          />
        ))}
      </div>
      <p className="text-[54px] leading-none font-semibold tracking-[-0.035em] text-fog-100">Sentry</p>
    </div>
  )
}
