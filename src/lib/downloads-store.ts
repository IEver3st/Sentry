import { create } from 'zustand'

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed'

export interface DownloadItem {
  id: string
  fileName: string
  outputPath: string
  source: string
  downloaded: number
  total: number
  status: DownloadStatus
  startedAt: number
  completedAt?: number
  error?: string
}

interface DownloadStore {
  downloads: DownloadItem[]
  panelOpen: boolean
  startDownload: (payload: {
    fileName: string
    outputPath: string
    source: string
  }) => string
  updateProgressByPath: (outputPath: string, downloaded: number, total: number) => void
  completeByPath: (outputPath: string) => void
  failByPath: (outputPath: string, error?: string) => void
  removeDownload: (id: string) => void
  setPanelOpen: (open: boolean) => void
}

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `dl-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useDownloadStore = create<DownloadStore>((set) => ({
  downloads: [],
  panelOpen: false,

  startDownload: ({ fileName, outputPath, source }) => {
    const id = createId()
    const next = {
      id,
      fileName,
      outputPath,
      source,
      downloaded: 0,
      total: 0,
      status: 'pending' as DownloadStatus,
      startedAt: Date.now(),
    }

    set((state) => ({
      downloads: [...state.downloads, next],
      panelOpen: true,
    }))

    return id
  },

  updateProgressByPath: (outputPath, downloaded, total) => {
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.outputPath === outputPath
          ? {
              ...item,
              downloaded,
              total: total > 0 ? total : Math.max(item.total, downloaded),
              status: 'downloading',
            }
          : item
      ),
    }))
  },

  completeByPath: (outputPath) => {
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.outputPath === outputPath
          ? {
              ...item,
              downloaded: item.total || item.downloaded,
              status: 'completed',
              completedAt: Date.now(),
            }
          : item
      ),
    }))
  },

  failByPath: (outputPath, error) => {
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.outputPath === outputPath
          ? { ...item, status: 'failed', error }
          : item
      ),
    }))
  },

  removeDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.filter((item) => item.id !== id),
    }))
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
}))

