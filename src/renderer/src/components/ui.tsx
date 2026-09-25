import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { motion } from 'motion/react'
import type { DriveFile, FileKind } from '@shared/types'
import { KIND } from '@/lib/kinds'
import { sizeParts } from '@/lib/format'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cx(
        'no-drag inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-9 px-3.5 text-[13.5px]',
        size === 'lg' && 'h-11 px-5 text-[15px]',
        variant === 'primary' && 'bg-amber text-ink-950 hover:brightness-110 shadow-[0_1px_0_#ffffff40_inset]',
        variant === 'secondary' && 'bg-ink-700 text-fog-100 hover:bg-ink-600',
        variant === 'ghost' && 'text-fog-300 hover:bg-white/5 hover:text-fog-100',
        variant === 'danger' && 'bg-rose/15 text-rose hover:bg-rose/25',
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(
  function IconButton({ label, active, className, children, ...rest }, ref) {
    return (
      <Tip label={label}>
        <button
          ref={ref}
          aria-label={label}
          className={cx(
            'no-drag inline-grid size-8 place-items-center rounded-lg text-fog-400 transition-colors hover:bg-white/6 hover:text-fog-100 active:scale-95 disabled:opacity-40',
            active && 'bg-white/8 text-fog-100',
            className
          )}
          {...rest}
        >
          {children}
        </button>
      </Tip>
    )
  }
)

export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md bg-ink-600 px-2 py-1 text-[12px] text-fog-100 shadow-lg shadow-black/40"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-[5px] border border-white/10 bg-ink-800 px-1.5 font-mono text-[11px] text-fog-300 shadow-[0_1px_0_#ffffff10]">
      {children}
    </kbd>
  )
}

/** The Sentry mark: a four-tile treemap, echoing the storage map. */
export function Logo({ size = 22, animate = false }: { size?: number; animate?: boolean }) {
  const tiles = [
    { x: 0, y: 0, w: 13, h: 22, c: 'var(--color-amber)' },
    { x: 15, y: 0, w: 7, h: 11, c: '#6f95e0' },
    { x: 15, y: 13, w: 7, h: 4, c: '#a57de0' },
    { x: 15, y: 19, w: 7, h: 3, c: '#4fb3b3' }
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      {tiles.map((t, i) => (
        <motion.rect
          key={i}
          x={t.x}
          y={t.y}
          width={t.w}
          height={t.h}
          rx={1.6}
          fill={t.c}
          initial={animate ? { opacity: 0, scale: 0.4 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: animate ? 0.15 + i * 0.09 : 0, type: 'spring', stiffness: 380, damping: 22 }}
          style={{ transformOrigin: `${t.x + t.w / 2}px ${t.y + t.h / 2}px` }}
        />
      ))}
    </svg>
  )
}

export function FileGlyph({ kind, size = 18, className, color }: { kind: FileKind; size?: number; className?: string; color?: string }) {
  const { icon: Icon, color: base } = KIND[kind]
  return <Icon size={size} color={color ?? base} strokeWidth={1.75} className={className} aria-hidden />
}

/** A tinted square badge around a file glyph. `tint` lets folders wear their storage-map colour. */
export function FileBadge({ file, size = 36, tint }: { file: Pick<DriveFile, 'kind'>; size?: number; tint?: string }) {
  const color = tint ?? KIND[file.kind].color
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-[9px]"
      style={{ width: size, height: size, background: `color-mix(in oklab, ${color} 18%, transparent)` }}
    >
      <FileGlyph kind={file.kind} size={Math.round(size * 0.5)} color={tint} />
    </span>
  )
}

/** Big confident number with a quiet unit, the way the map shows sizes. */
export function BigSize({ bytes, className, unitClass }: { bytes: number; className?: string; unitClass?: string }) {
  const { value, unit } = sizeParts(bytes)
  return (
    <span className={cx('tnum font-semibold tracking-tight', className)}>
      {value}
      <span className={cx('ml-1 font-medium text-fog-400', unitClass ?? 'text-[0.45em]')}>{unit}</span>
    </span>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" fill="none" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-fog-500 uppercase">{children}</h2>
      {right}
    </div>
  )
}

/** Horizontal meter; the fill animates when the value changes. */
export function Meter({ value, color = 'var(--color-amber)', className, live }: { value: number; color?: string; className?: string; live?: boolean }) {
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-white/6', className)}>
      <motion.div
        className={cx('h-full rounded-full', live && 'progress-live')}
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 24 }}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  label?: string
}) {
  const group = options.map((x) => x.value).join()
  return (
    <div className="no-drag flex h-8 shrink-0 rounded-lg border border-white/[0.06] bg-ink-800 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('relative flex items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors', value === o.value ? 'text-fog-100' : 'text-fog-400 hover:text-fog-100')}
        >
          {value === o.value && <motion.span layoutId={`seg-${group}`} className="absolute inset-0 rounded-md bg-ink-600" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  )
}

/** A failed load, stated plainly with a way to try again (never an endless skeleton). */
export function LoadError({ message, onRetry, busy, className }: { message: string; onRetry: () => void; busy?: boolean; className?: string }) {
  return (
    <div role="alert" className={cx('flex flex-col items-start gap-2 px-5 py-3 text-[13px]', className)}>
      <span className="text-fog-300">{message}</span>
      <button onClick={onRetry} disabled={busy} className="flex items-center gap-2 font-medium text-amber hover:underline hover:underline-offset-4 disabled:opacity-50">
        {busy && <Spinner size={12} />} {busy ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  )
}
