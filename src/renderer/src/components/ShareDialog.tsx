import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Copy, ExternalLink, Globe, Lock, X } from 'lucide-react'
import { create } from 'zustand'
import type { DriveFile, ShareLink } from '@shared/types'
import { api, fail, useApp } from '@/lib/store'
import { formatSize } from '@/lib/format'
import { Button, cx, FileBadge, Spinner } from './ui'

const useShare = create<{ file: DriveFile | null }>(() => ({ file: null }))

export function openShare(file: DriveFile): void {
  useShare.setState({ file })
}

const ROLES: Array<{ role: ShareLink['role']; label: string; verb: string; detail: string }> = [
  { role: 'reader', label: 'Can view', verb: 'view', detail: 'Open and download' },
  { role: 'commenter', label: 'Can comment', verb: 'comment on', detail: 'View and leave comments' },
  { role: 'writer', label: 'Can edit', verb: 'edit', detail: 'Change, rename, or delete it' }
]

export function ShareDialog() {
  const file = useShare((s) => s.file)
  const demo = useApp((s) => s.status?.provider === 'demo')
  const [current, setCurrent] = useState<DriveFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Plain-language confirmation of what the last change did. */
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setCurrent(file)
    setCopied(false)
    setNotice(null)
  }, [file])

  const close = (): void => useShare.setState({ file: null })

  const apply = async (role: ShareLink['role'] | null): Promise<DriveFile | null> => {
    if (!current) return null
    setBusy(true)
    try {
      const wasOn = Boolean(current.link)
      const next = await api().setLink(current.id, role)
      setCurrent(next)
      const verb = ROLES.find((r) => r.role === role)?.verb
      setNotice(
        !role
          ? 'Link turned off. Anyone who had it can’t open this anymore.'
          : wasOn
            ? `Updated. People with the link can now ${verb} it.`
            : `Link is live. Anyone who has it can ${verb} this.`
      )
      return next
    } catch (error) {
      fail(role ? 'Couldn’t create the link' : 'Couldn’t turn the link off', error)
      return null
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    let link = current?.link
    if (!link) link = (await apply('reader'))?.link ?? null
    if (!link) return
    await api().copyText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const on = Boolean(current?.link)

  return (
    <Dialog.Root open={Boolean(file)} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="rounded-2xl border border-white/[0.08] bg-ink-800 p-5 shadow-2xl shadow-black/60"
          >
            {current && (
              <>
                <div className="flex items-start gap-3">
                  <FileBadge file={current} size={40} />
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="truncate text-[16px] font-semibold">Share “{current.name}”</Dialog.Title>
                    <Dialog.Description className="text-[12.5px] text-fog-400">
                      {current.kind === 'folder' ? 'Folder' : formatSize(current.size)}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close className="grid size-8 place-items-center rounded-lg text-fog-400 hover:bg-white/5 hover:text-fog-100" aria-label="Close">
                    <X size={16} />
                  </Dialog.Close>
                </div>

                <p className="mt-5 mb-2 text-[11.5px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Who can open it</p>
                <div role="radiogroup" aria-label="Who can open it" className="overflow-hidden rounded-xl border border-white/[0.07]">
                  <AccessOption
                    selected={!on}
                    disabled={busy}
                    onSelect={() => on && apply(null)}
                    icon={<Lock size={14} />}
                    title="Restricted"
                    body="Only you. Nobody else can open it, even with an old link."
                  />
                  <AccessOption
                    selected={on}
                    disabled={busy}
                    onSelect={() => !on && apply('reader')}
                    icon={<Globe size={14} />}
                    title="Anyone with the link"
                    body={on ? 'No sign-in needed. Share the link below.' : 'Anyone you send the link to can open it, no sign-in needed.'}
                    trailing={on && current.link ? <RoleMenu role={current.link.role} disabled={busy} onChange={(r) => apply(r)} /> : null}
                  />
                </div>

                {on && current.link && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-ink-900 py-1 pr-1 pl-3">
                      <span className="flex-1 truncate font-mono text-[12px] text-fog-300" data-selectable>
                        {current.link.url}
                      </span>
                      <Button size="sm" variant="ghost" aria-label="Open link in browser" onClick={() => api().openExternal(current.link!.url)} disabled={demo}>
                        <ExternalLink size={14} />
                      </Button>
                    </div>
                  </motion.div>
                )}

                <p aria-live="polite" className={cx('mt-3 flex min-h-[18px] items-center gap-2 text-[12.5px]', notice ? 'text-fog-300' : 'text-fog-500')}>
                  {busy ? (
                    <>
                      <Spinner size={12} /> Saving…
                    </>
                  ) : (
                    (notice ?? (demo && on ? 'Demo drive links are placeholders until Google is connected.' : ''))
                  )}
                </p>

                <div className="mt-3 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <Button variant="ghost">Done</Button>
                  </Dialog.Close>
                  <Button variant="primary" onClick={copy} disabled={busy} icon={copied ? <Check size={15} /> : <Copy size={15} />}>
                    {copied ? 'Copied' : on ? 'Copy link' : 'Share with link'}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AccessOption({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  body,
  trailing
}: {
  selected: boolean
  disabled: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  body: string
  trailing?: React.ReactNode
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !disabled && (e.preventDefault(), onSelect())}
      className={cx(
        'flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors outline-none not-last:border-b not-last:border-white/[0.06] focus-visible:bg-white/[0.04]',
        selected ? 'bg-amber/[0.07]' : 'hover:bg-white/[0.03]',
        disabled && 'cursor-wait'
      )}
    >
      <span className={cx('grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors', selected ? 'border-amber' : 'border-fog-500')}>
        {selected && <motion.span layoutId="access-dot" className="size-2 rounded-full bg-amber" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('flex items-center gap-1.5 text-[13.5px] font-medium', !selected && 'text-fog-300')}>
          <span className={selected ? 'text-amber' : 'text-fog-500'}>{icon}</span>
          {title}
        </span>
        <span className="mt-0.5 block text-[12px] text-fog-400">{body}</span>
      </span>
      {trailing && <span onClick={(e) => e.stopPropagation()}>{trailing}</span>}
    </div>
  )
}

function RoleMenu({ role, disabled, onChange }: { role: ShareLink['role']; disabled: boolean; onChange: (r: ShareLink['role']) => void }) {
  const current = ROLES.find((r) => r.role === role)!
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-800 px-2.5 text-[12.5px] hover:bg-ink-750 data-[state=open]:border-amber/40"
      >
        {current.label}
        <ChevronDown size={13} className="text-fog-400" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-[60] w-60 rounded-xl border border-white/[0.08] bg-ink-750 p-1.5 shadow-2xl shadow-black/50">
          {ROLES.map((r) => (
            <DropdownMenu.Item
              key={r.role}
              onSelect={() => r.role !== role && onChange(r.role)}
              className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-white/[0.07]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{r.label}</span>
                <span className={cx('block text-[11.5px]', r.role === 'writer' ? 'text-amber/90' : 'text-fog-500')}>{r.detail}</span>
              </span>
              {r.role === role && <Check size={14} className="text-amber" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
