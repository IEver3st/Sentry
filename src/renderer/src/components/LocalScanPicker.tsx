import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FolderPlus, HardDrive, RefreshCw, X } from 'lucide-react'
import type { LocalDrive } from '@shared/types'
import { api, errorMessage, scanMap, useApp } from '@/lib/store'
import { formatSize } from '@/lib/format'
import { Button, Spinner } from './ui'

export function LocalScanPicker({ scanOnSave = true }: { scanOnSave?: boolean }) {
  const settings = useApp((s) => s.settings)
  const scanning = useApp((s) => s.scanning.local)
  const platform = useApp((s) => s.boot?.platform)
  const [open, setOpen] = useState(false)
  const [drives, setDrives] = useState<LocalDrive[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const key = (path: string): string => platform === 'win32' ? path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() : path.replace(/\/+$/, '')
  const same = (a: string, b: string): boolean => key(a) === key(b)
  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try { setDrives(await api().localDrives()) }
    catch (e) { setError(errorMessage(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!open || !settings) return
    setSelected(settings.scanRoots ?? [settings.scanRoot])
    setFolders(settings.scanRoots ?? [settings.scanRoot])
    void refresh()
  }, [open])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const next = await api().updateSettings({ scanRoots: selected })
      const previousKey = (settings?.scanRoots ?? [settings?.scanRoot ?? '']).map(key).sort().join('\n')
      const nextKey = (next.scanRoots ?? [next.scanRoot]).map(key).sort().join('\n')
      useApp.setState((s) => ({ settings: next, maps: { ...s.maps, local: previousKey === nextKey ? s.maps.local : null } }))
      setOpen(false)
      if (scanOnSave) void scanMap('local')
    } catch (e) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const addFolder = async (): Promise<void> => {
    try {
      const path = await api().pickDirectory()
      if (path) {
        setFolders((prev) => prev.some((p) => same(p, path)) ? prev : [...prev, path])
        setSelected((prev) => prev.some((p) => same(p, path)) ? prev : [...prev, path])
      }
    } catch (e) { setError(errorMessage(e)) }
  }
  const choices = [...drives, ...folders.filter((path) => !drives.some((d) => same(d.root, path))).map((root) => ({ root, label: 'Folder or unavailable drive', total: null, free: null }))]

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !saving && setOpen(value)}>
      <Dialog.Trigger asChild>
        <Button size="sm" icon={<HardDrive size={14} />} disabled={scanning}>Drives & folders</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-white/[0.08] bg-ink-800 p-5 shadow-2xl outline-none">
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-[18px] font-semibold">Choose what to scan</Dialog.Title>
            <Dialog.Close asChild><Button size="sm" variant="ghost" aria-label="Close drive selection" disabled={saving}><X size={16} /></Button></Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-[13px] text-fog-400">Select any number of drives or folders. Overlapping locations are counted once.</Dialog.Description>
          <div className="my-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSelected(drives.map((d) => d.root))} disabled={loading || saving || !drives.length}>Select all drives</Button>
            <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => void addFolder()} disabled={saving}>Add folder</Button>
            <Button size="sm" variant="ghost" aria-label="Refresh drives" icon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={loading || saving} />
          </div>
          {loading && <p role="status" className="mb-3 flex items-center gap-2 text-[13px] text-fog-400"><Spinner /> Finding drives…</p>}
          <div className="min-h-0 overflow-y-auto rounded-lg border border-white/[0.06]">
            {choices.map((drive) => (
              <label key={drive.root} className="flex cursor-pointer items-center gap-3 border-b border-white/[0.05] px-3 py-3 last:border-0 hover:bg-white/[0.03]">
                <input type="checkbox" className="size-4 shrink-0 accent-sky" checked={selected.some((p) => same(p, drive.root))} disabled={saving}
                  onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, drive.root] : prev.filter((p) => !same(p, drive.root)))} />
                <HardDrive size={19} className="shrink-0 text-fog-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium" title={drive.root}>{drive.root} <span className="ml-1 font-normal text-fog-400">{drive.label}</span></span>
                  <span className="mt-0.5 block text-[12px] text-fog-500">{drive.total !== null && drive.free !== null ? `${formatSize(drive.free)} free of ${formatSize(drive.total)}` : 'Availability checked when scanning'}</span>
                </span>
              </label>
            ))}
            {!loading && !choices.length && <p className="p-4 text-[13px] text-fog-400">No drives found. Add a folder or refresh the list.</p>}
          </div>
          {error && <p role="alert" className="mt-3 break-words text-[13px] text-rose">{error}</p>}
          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-[12px] text-fog-400">{selected.length} selected</span>
            <Button variant="primary" disabled={!selected.length || saving} onClick={() => void save()}>{saving ? 'Saving…' : scanOnSave ? 'Scan selected' : 'Save selection'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
