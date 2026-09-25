import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, FolderOpen, Globe, Link2, Share2, Unlink } from 'lucide-react'
import type { DriveFile } from '@shared/types'
import { api, fail, go, revealFile, toast, useApp } from '@/lib/store'
import { formatSize, plural, relativeTime } from '@/lib/format'
import { useLoad } from '@/lib/hooks'
import { BigSize, Button, cx, FileBadge, IconButton, SectionLabel } from '@/components/ui'
import { openShare } from '@/components/ShareDialog'

const ROLE = { reader: 'Can view', commenter: 'Can comment', writer: 'Can edit' } as const

export function Shared() {
  const driveVersion = useApp((s) => s.driveVersion)
  const demo = useApp((s) => s.status?.provider === 'demo')
  const shared = useLoad(() => api().shared(), [driveVersion])
  const recent = useLoad(() => api().recent(12), [driveVersion])
  const files = shared.data ?? []
  const editable = files.filter((f) => f.link?.role === 'writer').length
  const totalSize = files.reduce((a, f) => a + f.size, 0)
  const candidates = (recent.data ?? []).filter((f) => !f.link).slice(0, 6)

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-end justify-between gap-4 px-1">
          <div>
            <h2 className="text-[24px] font-semibold tracking-tight">Shared links</h2>
            <p className="mt-0.5 text-[13.5px] text-fog-400">Anything here opens for whoever has the link. Turn a link off and it stops working.</p>
          </div>
        </div>

        {shared.loading && !shared.data && (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        )}

        {shared.data && files.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-white/[0.08] py-14 text-center">
            <Link2 size={36} strokeWidth={1.5} className="text-mint" />
            <p className="text-[17px] font-semibold">No live links</p>
            <p className="text-[13.5px] text-fog-400">Right-click any file and choose “Get a link”. It lands here so you can keep track.</p>
            <Button onClick={() => go('files', null)}>Browse My Drive</Button>
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {files.map((f, i) => (
              <motion.li
                key={f.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.025 } }}
                exit={{ opacity: 0, x: -30, height: 0, marginTop: 0 }}
              >
                <LinkRow file={f} demo={demo} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-white/[0.05] bg-ink-850 p-5">
        <SectionLabel>At a glance</SectionLabel>
        <p className="text-[54px] leading-none font-semibold tracking-tight tnum">{files.length}</p>
        <p className="mt-1 text-[13px] text-fog-400">{files.length === 1 ? 'live link' : 'live links'}</p>
        <dl className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Editable</dt>
            <dd className={cx('mt-1 text-[17px] font-medium tnum', editable > 0 && 'text-amber')}>{editable}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.08em] text-fog-500 uppercase">Total size</dt>
            <dd className="mt-1 text-[17px] font-medium">
              <BigSize bytes={totalSize} className="font-medium" unitClass="text-[0.8em]" />
            </dd>
          </div>
        </dl>
        {editable > 0 && (
          <p className="mt-4 rounded-lg bg-amber/10 px-3 py-2 text-[12.5px] text-amber">
            {plural(editable, 'link')} let anyone edit. Worth a quick check.
          </p>
        )}

        <div className="mt-6 border-t border-white/[0.05] pt-5">
          <SectionLabel>Share something recent</SectionLabel>
          <ul className="-mx-2 flex flex-col">
            {candidates.map((f) => (
              <li key={f.id}>
                <button onClick={() => openShare(f)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]">
                  <FileBadge file={f} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{f.name}</span>
                    <span className="block text-[11.5px] text-fog-500">{relativeTime(f.modifiedAt)}</span>
                  </span>
                  <Share2 size={14} className="text-fog-500 opacity-0 group-hover:opacity-100" />
                </button>
              </li>
            ))}
            {recent.data && candidates.length === 0 && <li className="px-2 text-[12.5px] text-fog-500">Your recent files are all shared already.</li>}
          </ul>
        </div>
      </aside>
    </div>
  )
}

function LinkRow({ file, demo }: { file: DriveFile; demo: boolean }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const link = file.link!
  const copy = async (): Promise<void> => {
    await api().copyText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const revoke = async (): Promise<void> => {
    setBusy(true)
    try {
      await api().setLink(file.id, null)
      toast({ tone: 'success', title: 'Link turned off', detail: `“${file.name}” is private again.` }, 2600)
    } catch (error) {
      fail('Couldn’t turn the link off', error)
      setBusy(false)
    }
  }
  return (
    <div className="group flex items-center gap-4 rounded-xl border border-white/[0.04] bg-ink-850 px-4 py-3 transition-colors hover:border-white/[0.08]">
      <FileBadge file={file} size={38} />
      <div className="min-w-0 flex-1">
        <button onClick={() => revealFile(file.id)} className="block max-w-full truncate text-left text-[14px] font-medium hover:underline">
          {file.name}
        </button>
        <p className="mt-0.5 flex items-center gap-2 text-[12px] whitespace-nowrap text-fog-500">
          <Globe size={12} className={link.role === 'writer' ? 'text-amber' : 'text-mint'} />
          <span className={link.role === 'writer' ? 'text-amber' : ''}>{ROLE[link.role]}</span>
          <span>·</span>
          <span>{file.kind === 'folder' ? 'Folder' : file.size ? formatSize(file.size) : 'Google file'}</span>
          <span>·</span>
          <span>shared {relativeTime(link.createdAt)}</span>
        </p>
      </div>
      <span className="hidden max-w-[260px] truncate font-mono text-[11.5px] text-fog-500 2xl:block" data-selectable>
        {link.url.replace('https://', '')}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Show in My Drive" onClick={() => revealFile(file.id)}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton label="Sharing options" onClick={() => openShare(file)}>
          <Share2 size={15} />
        </IconButton>
        <IconButton label="Turn link off" onClick={revoke} disabled={busy} className="hover:text-rose">
          <Unlink size={15} />
        </IconButton>
        <Button size="sm" variant={copied ? 'secondary' : 'primary'} onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />} className="ml-1 w-[92px]" title={demo ? 'Demo links are placeholders' : undefined}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}
