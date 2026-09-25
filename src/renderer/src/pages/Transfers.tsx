import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowUp, CloudUpload, FolderOpen, X } from 'lucide-react'
import type { Transfer } from '@shared/types'
import { api, go, uploadPaths, useApp } from '@/lib/store'
import { formatSize, percent, plural, relativeTime } from '@/lib/format'
import { BigSize, Button, cx, FileBadge, IconButton, SectionLabel } from '@/components/ui'

export function Transfers() {
  const transfers = useApp((s) => s.transfers)
  const downloadDir = useApp((s) => s.settings?.downloadDir ?? '')
  const active = transfers.filter((t) => t.state === 'running' || t.state === 'queued')
  const finished = transfers.filter((t) => !(t.state === 'running' || t.state === 'queued'))
  const up = transfers.filter((t) => t.direction === 'up' && t.state === 'done').reduce((a, t) => a + t.total, 0)
  const down = transfers.filter((t) => t.direction === 'down' && t.state === 'done').reduce((a, t) => a + t.total, 0)
  const failed = transfers.filter((t) => t.state === 'failed').length
  const activeTotal = active.reduce((a, t) => a + t.total, 0)
  const activeDone = active.reduce((a, t) => a + t.done, 0)

  const send = async (mode: 'files' | 'folder'): Promise<void> => uploadPaths(await api().pickLocal(mode), null)
  const changeDir = async (): Promise<void> => {
    const dir = await api().pickDirectory(downloadDir)
    if (dir) useApp.setState({ settings: await api().updateSettings({ downloadDir: dir }) })
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5 [&>*]:shrink-0">
        <div className="mb-5 flex items-end justify-between gap-4 px-1">
          <div>
            <h2 className="text-[24px] font-semibold tracking-tight">Transfers</h2>
            <p className="mt-0.5 text-[13.5px] text-fog-400">
              {active.length ? `${plural(active.length, 'file')} moving · ${Math.round(percent(activeDone, activeTotal || 1))}% overall` : 'All quiet. Everything you sent has landed.'}
            </p>
          </div>
          {finished.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => api().clearTransfers()}>
              Clear finished
            </Button>
          )}
        </div>

        {active.length > 0 && (
          <div className="mb-6">
            <SectionLabel>Moving now</SectionLabel>
            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {active.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {finished.length > 0 && (
          <div>
            <SectionLabel>Earlier</SectionLabel>
            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {finished.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {transfers.length > 0 && (
          <button
            onClick={() => send('files')}
            className="mt-4 flex min-h-[110px] flex-1! shrink! items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.07] text-[13.5px] text-fog-500 transition-colors hover:border-amber/30 hover:text-fog-300"
          >
            <CloudUpload size={18} className="text-amber/80" />
            Drop more files anywhere, or click to choose
          </button>
        )}

        {transfers.length === 0 && (
          <div className="flex flex-1! flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/[0.08] py-16 text-center">
            <motion.span animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}>
              <CloudUpload size={40} strokeWidth={1.4} className="text-amber" />
            </motion.span>
            <p className="text-[17px] font-semibold">Nothing has moved yet</p>
            <p className="text-[13.5px] text-fog-400">Drop files on this window to send them up, or pull something from My Drive.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => send('files')}>
                Send files up
              </Button>
              <Button onClick={() => go('files', null)}>Open My Drive</Button>
            </div>
          </div>
        )}
      </div>

      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-white/[0.05] bg-ink-850 p-5">
        <SectionLabel>This session</SectionLabel>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] text-fog-500">
              <ArrowUp size={13} className="text-amber" /> Sent up
            </p>
            <BigSize bytes={up} className="mt-1 block text-[28px] leading-none" />
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[12px] text-fog-500">
              <ArrowDown size={13} className="text-sky" /> Pulled down
            </p>
            <BigSize bytes={down} className="mt-1 block text-[28px] leading-none" />
          </div>
        </div>
        {failed > 0 && <p className="mt-4 rounded-lg bg-rose/10 px-3 py-2 text-[12.5px] text-rose">{plural(failed, 'transfer')} didn’t finish. Details are on each row.</p>}

        <div className="mt-6 border-t border-white/[0.05] pt-5">
          <SectionLabel>Pulled files land in</SectionLabel>
          <p className="truncate text-[13.5px]" title={downloadDir} data-selectable>
            {downloadDir}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => api().revealLocal(downloadDir)}>
              Open
            </Button>
            <Button size="sm" variant="ghost" onClick={changeDir}>
              Change
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Row({ t }: { t: Transfer }) {
  const running = t.state === 'running'
  const queued = t.state === 'queued'
  const pct = percent(t.done, t.total || 1)
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-4 rounded-xl border border-white/[0.04] bg-ink-850 px-4 py-3"
    >
      <span className="relative">
        <FileBadge file={t} size={38} />
        <span
          className={cx(
            'absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full ring-2 ring-ink-850',
            t.direction === 'up' ? 'bg-amber text-ink-950' : 'bg-sky text-ink-950'
          )}
        >
          {t.direction === 'up' ? <ArrowUp size={11} strokeWidth={2.5} /> : <ArrowDown size={11} strokeWidth={2.5} />}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14px] font-medium">{t.name}</p>
          <p className="shrink-0 text-[12.5px] text-fog-400 tnum">
            {running ? `${formatSize(t.done)} / ${formatSize(t.total)}` : formatSize(t.total)}
          </p>
        </div>
        {running || queued ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
            <div
              className={cx('h-full rounded-full transition-[width] duration-200', t.direction === 'up' ? 'bg-amber' : 'bg-sky', queued && 'progress-live opacity-40')}
              style={{ width: queued ? '100%' : `${Math.max(2, pct)}%` }}
            />
          </div>
        ) : (
          <p className={cx('mt-0.5 truncate text-[12px]', t.state === 'failed' ? 'text-rose' : 'text-fog-500')}>
            {t.state === 'done' && (t.direction === 'up' ? `In Drive · ${t.remoteLabel}` : `Saved to this PC`)}
            {t.state === 'failed' && t.error}
            {t.state === 'cancelled' && 'Cancelled'}
            {t.finishedAt && t.state !== 'failed' && ` · ${relativeTime(t.finishedAt)}`}
          </p>
        )}
      </div>
      {running || queued ? (
        <IconButton label="Cancel" onClick={() => api().cancelTransfer(t.id)}>
          <X size={15} />
        </IconButton>
      ) : t.state === 'done' && t.direction === 'down' ? (
        <IconButton label="Show in folder" onClick={() => api().revealLocal(t.localPath)}>
          <FolderOpen size={15} />
        </IconButton>
      ) : (
        <span className="w-8" />
      )}
    </motion.li>
  )
}
