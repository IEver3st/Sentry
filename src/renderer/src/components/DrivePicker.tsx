import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import { ChevronRight, Folder, FolderPlus } from 'lucide-react'
import { create } from 'zustand'
import type { DriveFile } from '@shared/types'
import { api, fail } from '@/lib/store'
import { Button, cx, Spinner } from './ui'

interface Ask {
  title: string
  action: string
  resolve: (target: { id: string | null; name: string } | null) => void
}

const usePicker = create<{ ask: Ask | null }>(() => ({ ask: null }))

/** Resolves with the chosen Drive folder (id null = My Drive), or null if cancelled. */
export function pickDriveFolder(title: string, action = 'Upload here'): Promise<{ id: string | null; name: string } | null> {
  return new Promise((resolve) => usePicker.setState({ ask: { title, action, resolve } }))
}

export function DrivePicker() {
  const ask = usePicker((s) => s.ask)
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([])
  const [folders, setFolders] = useState<DriveFile[] | null>(null)
  const [creating, setCreating] = useState(false)
  const current = path.at(-1) ?? null

  useEffect(() => {
    if (!ask) return
    setPath([])
  }, [ask])

  useEffect(() => {
    if (!ask) return
    let live = true
    setFolders(null)
    api()
      .list(current?.id ?? null)
      .then((l) => live && setFolders(l.items.filter((f) => f.kind === 'folder')))
      .catch((e: unknown) => live && (setFolders([]), fail('Couldn’t open that folder', e)))
    return () => {
      live = false
    }
  }, [ask, current?.id])

  const done = (target: { id: string | null; name: string } | null): void => {
    ask?.resolve(target)
    usePicker.setState({ ask: null })
  }

  const newFolder = async (): Promise<void> => {
    setCreating(true)
    try {
      const f = await api().createFolder(current?.id ?? null, 'New folder')
      setPath((p) => [...p, { id: f.id, name: f.name }])
    } catch (e) {
      fail('Couldn’t create the folder', e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog.Root open={Boolean(ask)} onOpenChange={(o) => !o && done(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[480px] -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="flex h-[440px] flex-col rounded-2xl border border-white/[0.08] bg-ink-800 shadow-2xl shadow-black/60"
          >
            <div className="px-5 pt-5">
              <Dialog.Title className="text-[16px] font-semibold">{ask?.title}</Dialog.Title>
              <nav className="mt-2 flex min-w-0 items-center gap-1 text-[13px]" aria-label="Drive folder path">
                <button onClick={() => setPath([])} className={cx('rounded px-1 hover:text-fog-100', path.length ? 'text-fog-400' : 'font-medium text-fog-100')}>
                  My Drive
                </button>
                {path.map((p, i) => (
                  <span key={p.id} className="flex min-w-0 items-center gap-1">
                    <ChevronRight size={13} className="shrink-0 text-fog-500" />
                    <button
                      onClick={() => setPath((x) => x.slice(0, i + 1))}
                      className={cx('truncate rounded px-1 hover:text-fog-100', i === path.length - 1 ? 'font-medium text-fog-100' : 'text-fog-400')}
                    >
                      {p.name}
                    </button>
                  </span>
                ))}
              </nav>
              <Dialog.Description className="sr-only">Choose a folder in your Google Drive.</Dialog.Description>
            </div>
            <ul className="mx-3 mt-3 min-h-0 flex-1 overflow-y-auto border-y border-white/[0.05] py-1.5">
              {folders === null && (
                <li className="grid h-24 place-items-center text-fog-400">
                  <Spinner />
                </li>
              )}
              {folders?.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fog-500">No folders in here. It can still go right here.</li>}
              {folders?.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => setPath((p) => [...p, { id: f.id, name: f.name }])}
                    className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px] hover:bg-white/[0.05]"
                  >
                    <Folder size={16} className="shrink-0 text-fog-400" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <ChevronRight size={14} className="text-fog-500" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 px-5 py-4">
              <Button variant="ghost" size="sm" icon={creating ? <Spinner size={13} /> : <FolderPlus size={14} />} onClick={newFolder} disabled={creating}>
                New folder
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => done(null)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => done({ id: current?.id ?? null, name: current?.name ?? 'My Drive' })}>
                  {ask?.action} {current ? `in ${current.name}` : ''}
                </Button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
