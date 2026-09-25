import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Search, Upload, X } from 'lucide-react'
import type { DriveFile } from '@shared/types'
import { api, go, isLocalOnly, uploadPaths, useApp } from '@/lib/store'
import { formatSize, relativeTime } from '@/lib/format'
import { Button, cx, FileBadge, Kbd, Spinner } from './ui'

const TITLES = {
  home: 'Home',
  files: 'My Drive',
  map: 'This PC',
  shared: 'Shared links',
  transfers: 'Transfers',
  settings: 'Settings'
} as const

export function TitleBar() {
  const route = useApp((s) => s.route)
  const platform = useApp((s) => s.boot?.platform)
  const folderId = useApp((s) => s.folderId)
  const localOnly = useApp(isLocalOnly)

  const addFiles = async (): Promise<void> => {
    const paths = await api().pickLocal('files')
    await uploadPaths(paths, route === 'files' ? folderId : null)
  }

  return (
    <header
      className="drag relative flex h-11 shrink-0 items-center gap-4 border-b border-white/[0.05] pl-5"
      style={{ paddingRight: platform === 'win32' ? 150 : 16 }}
    >
      <h1 className="w-40 shrink-0 text-[13.5px] font-medium text-fog-300">{localOnly && route !== 'map' ? 'Google Drive' : TITLES[route]}</h1>
      <div className="flex flex-1 justify-center">{!localOnly && <GlobalSearch />}</div>
      {!localOnly && (
        <Button variant="ghost" size="sm" icon={<Upload size={15} />} onClick={addFiles}>
          Add files
        </Button>
      )}
    </header>
  )
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<DriveFile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setResults(null)
      return
    }
    setLoading(true)
    let live = true
    const t = setTimeout(() => {
      api()
        .search(term)
        .then((r) => live && (setResults(r.slice(0, 8)), setCursor(0)))
        .catch(() => live && setResults([]))
        .finally(() => live && setLoading(false))
    }, 140)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const choose = (f: DriveFile): void => {
    if (f.kind === 'folder') go('files', f.id)
    else go('files', f.parentId, f.id)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className="no-drag relative w-full max-w-[440px]">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fog-500" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!results?.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(results.length - 1, c + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(0, c - 1))
          } else if (e.key === 'Enter') choose(results[cursor])
          else if (e.key === 'Escape') {
            setQ('')
            input.current?.blur()
          }
        }}
        placeholder="Search your Drive"
        aria-label="Search your Drive"
        role="combobox"
        aria-expanded={open && Boolean(results)}
        className="h-8 w-full rounded-lg border border-white/[0.06] bg-ink-800 pr-16 pl-9 text-[13px] text-fog-100 transition-colors outline-none placeholder:text-fog-500 focus:border-amber/40 focus:bg-ink-750"
      />
      <span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
        {loading ? <Spinner size={13} /> : q ? null : <Kbd>Ctrl K</Kbd>}
      </span>
      {q && (
        <button
          aria-label="Clear search"
          onClick={() => setQ('')}
          className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded text-fog-400 hover:text-fog-100"
        >
          <X size={13} />
        </button>
      )}
      <AnimatePresence>
        {open && results && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute top-10 right-0 left-0 z-40 overflow-hidden rounded-xl border border-white/[0.07] bg-ink-800 p-1.5 shadow-2xl shadow-black/50"
          >
            {results.length === 0 && <li className="px-3 py-3 text-[13px] text-fog-400">Nothing matches “{q.trim()}”.</li>}
            {results.map((f, i) => (
              <li key={f.id} role="option" aria-selected={i === cursor}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(f)}
                  onMouseEnter={() => setCursor(i)}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left', i === cursor && 'bg-white/[0.06]')}
                >
                  <FileBadge file={f} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{f.name}</span>
                    <span className="block text-[11.5px] text-fog-500">
                      {f.kind === 'folder' ? 'Folder' : formatSize(f.size)} · {relativeTime(f.modifiedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
