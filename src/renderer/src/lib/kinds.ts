import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  type LucideIcon
} from 'lucide-react'
import type { FileKind, MapCategory, MapNode } from '@shared/types'

export const KIND: Record<FileKind, { icon: LucideIcon; color: string; label: string }> = {
  folder: { icon: Folder, color: '#8d93ab', label: 'Folder' },
  document: { icon: FileText, color: '#6f95e0', label: 'Document' },
  spreadsheet: { icon: FileSpreadsheet, color: '#55b07a', label: 'Spreadsheet' },
  presentation: { icon: Presentation, color: '#e3a24a', label: 'Slides' },
  pdf: { icon: FileText, color: '#e5736b', label: 'PDF' },
  image: { icon: FileImage, color: '#a57de0', label: 'Image' },
  video: { icon: FileVideo, color: '#c26bd6', label: 'Video' },
  audio: { icon: FileAudio, color: '#e07dab', label: 'Audio' },
  archive: { icon: FileArchive, color: '#4fb3b3', label: 'Archive' },
  code: { icon: FileCode2, color: '#d88a5a', label: 'Code' },
  other: { icon: File, color: '#8d93ab', label: 'File' }
}

export const CATEGORY: Record<MapCategory, { color: string; label: string }> = {
  documents: { color: 'var(--color-cat-documents)', label: 'Documents' },
  media: { color: 'var(--color-cat-media)', label: 'Media' },
  code: { color: 'var(--color-cat-code)', label: 'Code' },
  archives: { color: 'var(--color-cat-archives)', label: 'Archives' },
  apps: { color: 'var(--color-cat-apps)', label: 'Apps & tools' },
  games: { color: 'var(--color-cat-games)', label: 'Games' },
  synced: { color: 'var(--color-cat-synced)', label: 'Synced' },
  cache: { color: 'var(--color-cat-cache)', label: 'Cache' },
  system: { color: 'var(--color-cat-system)', label: 'System' },
  other: { color: 'var(--color-cat-other)', label: 'Other' }
}

/** Plural group names for legends ("Photos 11.7 GB"). */
export const KIND_GROUP: Record<FileKind, string> = {
  folder: 'Folders',
  document: 'Docs',
  spreadsheet: 'Sheets',
  presentation: 'Slides',
  pdf: 'PDFs',
  image: 'Photos',
  video: 'Videos',
  audio: 'Audio',
  archive: 'Archives',
  code: 'Code',
  other: 'Other'
}

/** One colour rule for map nodes everywhere: clearable stays in its cache colour, else the kind, else the category. */
export function nodeColor(n: Pick<MapNode, 'kind' | 'category' | 'reclaimable'>): string {
  if (n.reclaimable || !n.kind || n.kind === 'folder' || n.kind === 'other') return CATEGORY[n.category].color
  return KIND[n.kind].color
}

export function nodeGroup(n: Pick<MapNode, 'kind' | 'category' | 'reclaimable'>): { key: string; label: string; color: string } {
  if (n.reclaimable || !n.kind || n.kind === 'folder' || n.kind === 'other') return { key: n.category, label: CATEGORY[n.category].label, color: CATEGORY[n.category].color }
  return { key: n.kind, label: KIND_GROUP[n.kind], color: KIND[n.kind].color }
}
