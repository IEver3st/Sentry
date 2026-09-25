import type { FileKind, MapCategory } from './types'

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

const EXT: Record<string, FileKind> = {
  doc: 'document', docx: 'document', txt: 'document', md: 'document', rtf: 'document', odt: 'document', pages: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', ods: 'spreadsheet', numbers: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', key: 'presentation', odp: 'presentation',
  pdf: 'pdf',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', svg: 'image', bmp: 'image', tif: 'image', tiff: 'image', raw: 'image', dng: 'image', psd: 'image',
  mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio', aac: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', iso: 'archive', dmg: 'archive',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', lua: 'code', py: 'code', rs: 'code', go: 'code', json: 'code', html: 'code', css: 'code', cs: 'code', cpp: 'code', c: 'code', h: 'code', java: 'code', sh: 'code', ps1: 'code', yml: 'code', yaml: 'code', toml: 'code', sql: 'code'
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindFromName(name: string): FileKind {
  return EXT[extOf(name)] ?? 'other'
}

export function kindFromMime(mime: string, name: string): FileKind {
  if (mime === FOLDER_MIME) return 'folder'
  if (mime === 'application/vnd.google-apps.document') return 'document'
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet'
  if (mime === 'application/vnd.google-apps.presentation') return 'presentation'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return kindFromName(name)
}

const MIME: Partial<Record<string, string>> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown',
  csv: 'text/csv', json: 'application/json', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export function mimeFromName(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream'
}

export function categoryFromKind(kind: FileKind): MapCategory {
  switch (kind) {
    case 'document':
    case 'spreadsheet':
    case 'presentation':
    case 'pdf':
      return 'documents'
    case 'image':
    case 'video':
    case 'audio':
      return 'media'
    case 'archive':
      return 'archives'
    case 'code':
      return 'code'
    default:
      return 'other'
  }
}
