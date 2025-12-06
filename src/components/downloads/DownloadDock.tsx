import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, CheckCircle2, AlertCircle, X, FolderOpen, File } from 'lucide-react'
import { open } from '@tauri-apps/plugin-shell'
import { dirname } from '@tauri-apps/api/path'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore, DownloadItem } from '@/lib/downloads-store'
import { events } from '@/lib/tauri'
import { formatBytes } from '@/lib/utils'

interface DownloadDockProps {
  sidebarOpen: boolean
}

const percent = (downloaded: number, total: number) => {
  if (!total) return 0
  return Math.min(100, Math.round((downloaded / total) * 100))
}

const toFileUrl = (path: string) => `file://${path.replace(/\\/g, '/')}`

const StatusIcon = ({ status }: { status: DownloadItem['status'] }) => {
  if (status === 'completed') {
    return <CheckCircle2 className="w-4 h-4 text-green-500" />
  }
  if (status === 'failed') {
    return <AlertCircle className="w-4 h-4 text-destructive" />
  }
  return <Download className="w-4 h-4 text-blue-500" />
}

const DownloadRow = ({
  item,
  onOpenFile,
  onOpenFolder,
}: {
  item: DownloadItem
  onOpenFile: (item: DownloadItem) => Promise<void>
  onOpenFolder: (item: DownloadItem) => Promise<void>
}) => {
  const progressValue = percent(item.downloaded, item.total)

  return (
    <div className="rounded-lg bg-muted/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={item.status} />
          <div className="text-sm font-medium leading-tight truncate max-w-[180px]">
            {item.fileName}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {item.status === 'completed'
            ? 'Ready'
            : `${formatBytes(item.downloaded)} / ${formatBytes(item.total || item.downloaded || 0)}`}
        </div>
      </div>
      <Progress value={progressValue} />
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" className="h-8 px-2" onClick={() => onOpenFile(item)}>
          <File className="w-4 h-4 mr-1" />
          Open
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onOpenFolder(item)}>
          <FolderOpen className="w-4 h-4 mr-1" />
          Folder
        </Button>
        {item.status === 'failed' && item.error && (
          <span className="text-[11px] text-destructive truncate">{item.error}</span>
        )}
      </div>
    </div>
  )
}

export function DownloadDock({ sidebarOpen }: DownloadDockProps) {
  const {
    downloads,
    panelOpen,
    setPanelOpen,
    updateProgressByPath,
    completeByPath,
    failByPath,
  } = useDownloadStore()

  useEffect(() => {
    let unlisten: (() => void) | null = null

    events.onDownloadProgress((payload) => {
      if (payload.targetPath) {
        updateProgressByPath(payload.targetPath, payload.downloaded, payload.total)

        if (payload.total > 0 && payload.downloaded >= payload.total) {
          completeByPath(payload.targetPath)
        }
      }
    })
      .then((stop) => {
        unlisten = stop
      })
      .catch((error) => {
        console.error('Failed to bind download progress listener:', error)
      })

    return () => {
      if (unlisten) unlisten()
    }
  }, [updateProgressByPath, completeByPath])

  const latest = useMemo(() => {
    if (!downloads.length) return null
    const active = downloads.filter((d) => d.status !== 'completed')
    return (active[active.length - 1] ?? downloads[downloads.length - 1]) || null
  }, [downloads])

  const miniProgress = latest ? percent(latest.downloaded, latest.total || latest.downloaded) : 0

  const handleOpenFile = async (item: DownloadItem) => {
    if (item.status !== 'completed') return
    try {
      await open(toFileUrl(item.outputPath))
    } catch (error) {
      console.error('Failed to open file', error)
      failByPath(item.outputPath, String(error))
    }
  }

  const handleOpenFolder = async (item: DownloadItem) => {
    if (item.status !== 'completed') return
    try {
      const folder = await dirname(item.outputPath)
      await open(toFileUrl(folder))
    } catch (error) {
      console.error('Failed to open folder', error)
      failByPath(item.outputPath, String(error))
    }
  }

  const panelLeft = sidebarOpen ? 256 : 86 // sidebar widths + padding gap

  return (
    <div className="relative px-2 pb-3">
      <AnimatePresence>
        {downloads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="space-y-2"
          >
            <button
              onClick={() => setPanelOpen(!panelOpen)}
              className={`w-full h-10 flex items-center rounded-lg bg-muted hover:bg-muted/80 text-foreground border transition ${
                sidebarOpen ? 'justify-between gap-2 px-3' : 'justify-center px-0'
              }`}
            >
              <Download className="w-4 h-4 text-primary" />
              {sidebarOpen && (
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-semibold">Downloads</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {downloads.length}
                  </span>
                </div>
              )}
            </button>

            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${miniProgress}%` }}
                className="h-full bg-primary"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {panelOpen && downloads.length > 0 &&
        createPortal(
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="fixed z-50 w-80 rounded-xl border bg-popover shadow-xl p-3 space-y-3"
              style={{ left: panelLeft, bottom: 16 }}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Download Manager</div>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="p-1 rounded-md hover:bg-muted transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {downloads.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    onOpenFile={handleOpenFile}
                    onOpenFolder={handleOpenFolder}
                  />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body
        )}
    </div>
  )
}

